import { ZodError } from "zod/v4";

export class ResponseContractError extends Error {
  constructor(public readonly zodError: ZodError) {
    super("Response failed contract validation");
    this.name = "ResponseContractError";
  }
}

export function parseResponseOrThrow<T>(schema: { parse: (value: unknown) => T }, payload: unknown): T {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ResponseContractError(error);
    }
    throw error;
  }
}
