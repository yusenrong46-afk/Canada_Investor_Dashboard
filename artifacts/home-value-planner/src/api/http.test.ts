import { afterEach, describe, expect, it, vi } from "vitest";

import { anyAbortSignal, apiFetch, API_TIMEOUT_MESSAGE, API_TIMEOUT_MS } from "./http";

// A fetch stub that never resolves, only rejects with the signal's reason when aborted (like real fetch).
function hangingFetch() {
  return vi.fn((_input: unknown, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  });
}

describe("apiFetch", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("combines signals without AbortSignal.any (Safari < 17.4)", () => {
    // Same AbortSignal, but with the static `any` hidden.
    vi.stubGlobal("AbortSignal", Object.assign(Object.create(AbortSignal), { any: undefined }));

    const first = new AbortController();
    const second = new AbortController();
    const combined = anyAbortSignal([first.signal, second.signal]);

    expect(combined.aborted).toBe(false);
    second.abort();
    expect(combined.aborted).toBe(true);
  });

  it("reports a timeout with a friendly message", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    const request = apiFetch("/api/health");
    const assertion = expect(request).rejects.toThrow(API_TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await assertion;
  });

  it("keeps the AbortError when the caller aborts", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();

    const request = apiFetch("/api/plan", { method: "POST", body: "{}", signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("only sends a JSON content type when there is a body", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/health");
    await apiFetch("/api/plan", { method: "POST", body: "{}" });

    const headersFor = (call: number) => (fetchMock.mock.calls[call] as unknown as [unknown, RequestInit])[1].headers as Headers;
    expect(headersFor(0).has("Content-Type")).toBe(false);
    expect(headersFor(1).get("Content-Type")).toBe("application/json");
  });
});
