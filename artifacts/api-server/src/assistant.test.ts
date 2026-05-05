import { describe, expect, it } from "vitest";

import { answerProjectQuestion } from "./assistant";

describe("answerProjectQuestion", () => {
  it("answers project questions with citations", () => {
    const response = answerProjectQuestion({ question: "Why is renovation uplift rule based?", topK: 3 });

    expect(response.confidence).not.toBe("low");
    expect(response.citations.length).toBeGreaterThan(0);
    expect(response.answer).toContain("project docs");
  });

  it("uses a safe fallback when the docs do not contain the answer", () => {
    const response = answerProjectQuestion({ question: "Which coffee shop should I visit tomorrow?", topK: 2 });

    expect(response.confidence).toBe("low");
    expect(response.answer).toContain("I do not know");
  });
});
