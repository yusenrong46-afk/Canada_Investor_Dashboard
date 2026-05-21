# RAG Learning Plan

I want the AI part of this project to be useful, not just a buzzword. The current assistant is retrieval-first over local project docs. The next version should become a model coach that helps explain the deal analyzer.

## Goal

Build a small RAG system that can answer:

- Why did this deal get this label?
- What data trained the base model?
- Why is the uplift model less certain?
- Which metrics should I mention in an interview?
- What dataset would improve the model most?

## Manual Build Steps

1. **Collect documents**
   Use README, model card, portfolio case study, dataset notes, OpenAPI contract, and model summary JSON.

2. **Chunk documents**
   Split by sections and paragraphs. Keep chunks small enough to cite clearly.

3. **Create embeddings**
   Start with `sentence-transformers/all-MiniLM-L6-v2` locally.

4. **Store vectors**
   Start simple with local JSON or NumPy arrays. I do not need a vector database on day one.

5. **Retrieve top chunks**
   Use cosine similarity. Return the top 3-5 chunks.

6. **Generate a grounded answer**
   The answer should only use retrieved context. If the docs do not answer the question, it should say that.

7. **Show citations**
   Every answer should show source file and snippet.

8. **Add deal context**
   Later, pass the current deal-analysis response into the assistant so it can explain the actual deal label and risk flags.

## What This Teaches Me

- text chunking
- embeddings
- vector search
- grounded generation
- citations
- fallback behavior
- how to turn model output into human-readable explanations

## What I Would Avoid At First

- no autonomous agent that can modify files
- no hidden web search
- no giant framework before I understand the basics
- no answer without citations
