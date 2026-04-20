export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    if (!bodyText) {
      throw new Error("API request failed");
    }

    try {
      const parsed = JSON.parse(bodyText) as { message?: string; issues?: Array<{ path: string; message: string }> };
      if (parsed.issues?.length) {
        const issueSummary = parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
        throw new Error(issueSummary);
      }
      throw new Error(parsed.message || "API request failed");
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(bodyText);
    }
  }

  return response.json() as Promise<T>;
}
