/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useLatestRequest } from "./useLatestRequest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useLatestRequest", () => {
  it("clears stale data immediately when visible inputs change", async () => {
    const fetcher = vi.fn(async () => ({ value: 1 }));

    const { result, rerender } = renderHook(
      ({ visibleKey, fetchKey }) =>
        useLatestRequest<{ value: number }>(visibleKey, fetchKey, true, fetcher),
      {
        initialProps: { visibleKey: "a", fetchKey: "a" },
      },
    );

    await waitFor(() => expect(result.current.isFresh).toBe(true));
    expect(result.current.data?.value).toBe(1);

    rerender({ visibleKey: "b", fetchKey: "a" });

    expect(result.current.isFresh).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.isDebouncing).toBe(true);
    expect(result.current.loading).toBe(true);
  });

  it("does not let an older response overwrite a newer result", async () => {
    const first = deferred<{ value: number }>();
    const second = deferred<{ value: number }>();
    const fetcher = vi
      .fn()
      .mockImplementationOnce((_signal: AbortSignal) => first.promise)
      .mockImplementationOnce((_signal: AbortSignal) => second.promise);

    const { result, rerender } = renderHook(
      ({ visibleKey, fetchKey }) =>
        useLatestRequest<{ value: number }>(visibleKey, fetchKey, true, fetcher),
      {
        initialProps: { visibleKey: "a", fetchKey: "a" },
      },
    );

    rerender({ visibleKey: "b", fetchKey: "b" });

    await act(async () => {
      second.resolve({ value: 2 });
    });
    await waitFor(() => expect(result.current.data?.value).toBe(2));

    await act(async () => {
      first.resolve({ value: 1 });
    });

    expect(result.current.data?.value).toBe(2);
    expect(result.current.isFresh).toBe(true);
  });

  it("does not clear loading when an older request finishes after a newer one", async () => {
    const first = deferred<{ value: number }>();
    const second = deferred<{ value: number }>();
    const fetcher = vi
      .fn()
      .mockImplementationOnce((_signal: AbortSignal) => first.promise)
      .mockImplementationOnce((_signal: AbortSignal) => second.promise);

    const { result, rerender } = renderHook(
      ({ visibleKey, fetchKey }) =>
        useLatestRequest<{ value: number }>(visibleKey, fetchKey, true, fetcher),
      {
        initialProps: { visibleKey: "a", fetchKey: "a" },
      },
    );

    expect(result.current.loading).toBe(true);

    rerender({ visibleKey: "b", fetchKey: "b" });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      first.resolve({ value: 1 });
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      second.resolve({ value: 2 });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.value).toBe(2);
  });
});
