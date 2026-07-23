export const API_TIMEOUT_MS = 9_000;

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const callerSignal = init?.signal;
  const timeoutSignal = AbortSignal.timeout(API_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    if (!bodyText) {
      throw new Error("API request failed");
    }

    let parsed: { message?: string; error?: { code?: string; message?: string; issues?: Array<{ path: string; message: string }> }; issues?: Array<{ path: string; message: string }> };
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new Error(bodyText);
    }

    const issues = parsed.error?.issues ?? parsed.issues;
    if (issues?.length) {
      const issueSummary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      throw new Error(issueSummary);
    }

    throw new Error(parsed.error?.message ?? parsed.message ?? "API request failed");
  }

  return response.json() as Promise<T>;
}
