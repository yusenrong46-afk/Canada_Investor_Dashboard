export type ApiErrorCode =
  | "VALIDATION"
  | "RATE_LIMITED"
  | "NO_PORTFOLIO"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "RESPONSE_CONTRACT"
  | "NOT_FOUND"
  | "INTERNAL";

export interface ApiErrorBody {
  message: string;
  error: {
    code: ApiErrorCode;
    message: string;
    issues?: Array<{ path: string; message: string }>;
  };
}

export function buildErrorBody(
  code: ApiErrorCode,
  message: string,
  issues?: Array<{ path: string; message: string }>,
): ApiErrorBody & { issues?: Array<{ path: string; message: string }> } {
  return {
    message,
    ...(issues?.length ? { issues } : {}),
    error: {
      code,
      message,
      ...(issues?.length ? { issues } : {}),
    },
  };
}
