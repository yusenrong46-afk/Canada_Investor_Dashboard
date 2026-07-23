export function buildRequestKey(input: unknown): string {
  return JSON.stringify(input);
}

export function isFreshResult<T extends { requestKey?: string }>(result: T | null, requestKey: string): result is T {
  return result != null && result.requestKey === requestKey;
}
