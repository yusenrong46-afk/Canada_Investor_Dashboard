import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { AssistantQueryRequest } from "./schemas";

export interface AssistantCitation {
  title: string;
  source: string;
  snippet: string;
  score: number;
}

export interface AssistantQueryResponse {
  answer: string;
  confidence: "high" | "medium" | "low";
  citations: AssistantCitation[];
  suggestedQuestions: string[];
}

interface SourceChunk {
  title: string;
  source: string;
  text: string;
}

const repoRoot = path.resolve(process.cwd(), "../..");
const sourceFiles = [
  { title: "README", source: "README.md" },
  { title: "Model card", source: "docs/model-card.md" },
  { title: "Uplift dataset research", source: "docs/uplift-dataset-research.md" },
  { title: "Base model summary", source: "data/processed/vancouver_base_model_summary.json" },
  { title: "API contract", source: "artifacts/openapi/home-value-planner.openapi.yaml" },
];

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "should",
  "the",
  "this",
  "to",
  "what",
  "which",
  "why",
  "with",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function splitIntoChunks(title: string, source: string, text: string): SourceChunk[] {
  const paragraphs = text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks: SourceChunk[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (const paragraph of paragraphs) {
    const paragraphWords = paragraph.split(/\s+/).length;
    if (current.length && wordCount + paragraphWords > 130) {
      chunks.push({ title, source, text: current.join("\n\n") });
      current = [];
      wordCount = 0;
    }
    current.push(paragraph);
    wordCount += paragraphWords;
  }

  if (current.length) {
    chunks.push({ title, source, text: current.join("\n\n") });
  }

  return chunks;
}

function loadChunks(): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  for (const file of sourceFiles) {
    const fullPath = path.join(repoRoot, file.source);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    chunks.push(...splitIntoChunks(file.title, file.source, fs.readFileSync(fullPath, "utf8")));
  }
  return chunks;
}

const chunks = loadChunks();

function trySentenceBertAnswer(request: AssistantQueryRequest): AssistantQueryResponse | null {
  if (process.env.PROJECT_ASSISTANT_USE_SENTENCE_BERT !== "1") {
    return null;
  }

  const scriptPath = path.join(repoRoot, "scripts/query_project_assistant.py");
  const pythonPath = process.env.PROJECT_ASSISTANT_PYTHON ?? path.join(repoRoot, ".venv/bin/python");
  if (!fs.existsSync(scriptPath) || !fs.existsSync(pythonPath)) {
    return null;
  }

  const result = spawnSync(
    pythonPath,
    [scriptPath, "--question", request.question, "--top-k", String(request.topK ?? 4)],
    { encoding: "utf8", timeout: 20_000 },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }

  try {
    return JSON.parse(result.stdout) as AssistantQueryResponse;
  } catch {
    return null;
  }
}

function scoreChunk(questionTokens: string[], chunk: SourceChunk): number {
  const chunkTokens = tokenize(chunk.text);
  if (!questionTokens.length || !chunkTokens.length) {
    return 0;
  }

  const uniqueQuestionTokens = [...new Set(questionTokens)];
  const uniqueChunkTokens = new Set(chunkTokens);
  const matched = uniqueQuestionTokens.filter((token) => uniqueChunkTokens.has(token)).length;
  const coverage = matched / uniqueQuestionTokens.length;
  const density = matched / Math.sqrt(chunkTokens.length);
  return coverage * 0.85 + density * 0.15;
}

function sentenceScore(questionTokens: string[], sentence: string): number {
  const sentenceTokens = new Set(tokenize(sentence));
  return [...new Set(questionTokens)].filter((token) => sentenceTokens.has(token)).length;
}

function cleanSnippet(text: string, questionTokens: string[]): string {
  const sentences = text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+|;\s+|\s+-\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 20);
  const bestSentences = sentences
    .map((sentence, index) => ({ sentence, index, score: sentenceScore(questionTokens, sentence) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 2)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence);

  const snippetSource = bestSentences.length ? bestSentences.join(" ") : text;
  return snippetSource.replace(/\s+/g, " ").slice(0, 360).trim();
}

function confidenceFor(score: number): AssistantQueryResponse["confidence"] {
  if (score >= 0.42) {
    return "high";
  }
  if (score >= 0.28) {
    return "medium";
  }
  return "low";
}

export function answerProjectQuestion(request: AssistantQueryRequest): AssistantQueryResponse {
  const sentenceBertAnswer = trySentenceBertAnswer(request);
  if (sentenceBertAnswer) {
    return sentenceBertAnswer;
  }

  const questionTokens = tokenize(request.question);
  const topK = request.topK ?? 4;
  const ranked = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(questionTokens, chunk) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);

  const bestScore = ranked[0]?.score ?? 0;
  const confidence = confidenceFor(bestScore);
  const citations = ranked.map(({ chunk, score }) => ({
    title: chunk.title,
    source: chunk.source,
    snippet: cleanSnippet(chunk.text, questionTokens),
    score: Number(score.toFixed(3)),
  }));

  if (confidence === "low" || citations.length === 0) {
    return {
      answer:
        "I do not know from the indexed project docs. Try asking about the base price model, renovation uplift limits, validation metrics, API routes, or the investor deal workflow.",
      confidence: "low",
      citations,
      suggestedQuestions: suggestedQuestions(),
    };
  }

  const answer =
    "From the project docs: " +
    citations
      .slice(0, 2)
      .map((citation) => citation.snippet)
      .join(" ");

  return {
    answer,
    confidence,
    citations,
    suggestedQuestions: suggestedQuestions(),
  };
}

function suggestedQuestions(): string[] {
  return [
    "Why is the renovation uplift layer rule-based?",
    "What data does the base price model use?",
    "How should I interpret the model confidence range?",
    "What would make this a true uplift model?",
  ];
}
