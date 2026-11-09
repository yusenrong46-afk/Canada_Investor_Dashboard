export const API_TIMEOUT_MS = 9_000;
export const API_TIMEOUT_MESSAGE = "The API took too long to respond. Check your connection and try again.";

/** AbortSignal.any is missing on Safari before 17.4, so fall back to forwarding aborts by hand. */
export function anyAbortSignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }

  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const callerSignal = init?.signal ?? undefined;
  // A local controller (instead of AbortSignal.timeout) lets us tell our own timeout apart from a caller abort.
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), API_TIMEOUT_MS);
  const signal = callerSignal ? anyAbortSignal([callerSignal, timeoutController.signal]) : timeoutController.signal;

  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const response = await fetch(input, { ...init, headers, signal });
    return await readResponse<T>(response);
  } catch (error) {
    // Caller aborts keep their AbortError so pages can ignore superseded requests.
    if (timeoutController.signal.aborted && !callerSignal?.aborted) {
      throw new Error(API_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse<T>(response: Response): Promise<T> {
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
