from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
CHUNK_WORD_LIMIT = 130


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def source_files() -> list[tuple[str, str]]:
    return [
        ("README", "README.md"),
        ("Model card", "docs/model-card.md"),
        ("Uplift dataset research", "docs/uplift-dataset-research.md"),
        ("Base model summary", "data/processed/vancouver_base_model_summary.json"),
        ("API contract", "artifacts/openapi/home-value-planner.openapi.yaml"),
    ]


def split_into_chunks(title: str, source: str, text: str) -> list[dict[str, str]]:
    paragraphs = [item.strip() for item in text.replace("\r", "").split("\n\n") if item.strip()]
    chunks: list[dict[str, str]] = []
    current: list[str] = []
    word_count = 0

    for paragraph in paragraphs:
        paragraph_words = len(paragraph.split())
        if current and word_count + paragraph_words > CHUNK_WORD_LIMIT:
            chunks.append({"title": title, "source": source, "text": "\n\n".join(current)})
            current = []
            word_count = 0
        current.append(paragraph)
        word_count += paragraph_words

    if current:
        chunks.append({"title": title, "source": source, "text": "\n\n".join(current)})
    return chunks


def load_chunks() -> list[dict[str, str]]:
    root = repo_root()
    chunks: list[dict[str, str]] = []
    for title, source in source_files():
        path = root / source
        if path.exists():
            chunks.extend(split_into_chunks(title, source, path.read_text(encoding="utf-8")))
    return chunks


def confidence_for(score: float) -> str:
    if score >= 0.42:
        return "high"
    if score >= 0.18:
        return "medium"
    return "low"


def clean_snippet(text: str) -> str:
    return " ".join(text.split())[:360].strip()


def cosine_similarity(query: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    query_norm = np.linalg.norm(query)
    matrix_norm = np.linalg.norm(matrix, axis=1)
    denominator = np.maximum(query_norm * matrix_norm, 1e-12)
    return matrix.dot(query) / denominator


def answer_question(question: str, top_k: int) -> dict[str, Any]:
    try:
        from sentence_transformers import SentenceTransformer
    except Exception as exc:  # pragma: no cover - depends on optional local ML dependency
        raise RuntimeError(f"sentence-transformers is not available: {exc}") from exc

    chunks = load_chunks()
    if not chunks:
        raise RuntimeError("No project documents were found to index")

    model = SentenceTransformer(MODEL_NAME)
    texts = [chunk["text"] for chunk in chunks]
    document_embeddings = np.asarray(model.encode(texts, normalize_embeddings=True), dtype=float)
    query_embedding = np.asarray(model.encode([question], normalize_embeddings=True)[0], dtype=float)
    scores = cosine_similarity(query_embedding, document_embeddings)
    order = np.argsort(scores)[::-1][:top_k]

    citations = [
        {
            "title": chunks[index]["title"],
            "source": chunks[index]["source"],
            "snippet": clean_snippet(chunks[index]["text"]),
            "score": round(float(scores[index]), 3),
        }
        for index in order
        if math.isfinite(float(scores[index])) and float(scores[index]) > 0
    ]

    confidence = confidence_for(citations[0]["score"] if citations else 0.0)
    if confidence == "low" or not citations:
        answer = (
            "I do not know from the indexed project docs. Try asking about the base price model, "
            "renovation uplift limits, validation metrics, API routes, or the investor deal workflow."
        )
    else:
        answer = "From the project docs: " + " ".join(citation["snippet"] for citation in citations[:2])

    return {
        "answer": answer,
        "confidence": confidence,
        "citations": citations,
        "suggestedQuestions": [
            "How does Seattle uplift translate to Vancouver?",
            "What data does the base price model use?",
            "How should I interpret the model confidence range?",
            "What would make this a Vancouver-specific uplift model?",
        ],
        "retriever": MODEL_NAME,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Query the local project docs with Sentence-BERT retrieval.")
    parser.add_argument("--question", required=True)
    parser.add_argument("--top-k", type=int, default=4)
    args = parser.parse_args()
    print(json.dumps(answer_question(args.question, args.top_k), ensure_ascii=True))


if __name__ == "__main__":
    main()
