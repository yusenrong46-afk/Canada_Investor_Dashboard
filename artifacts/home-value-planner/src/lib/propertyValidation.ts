import { propertyInputSchema, type PropertyInput } from "@vvl/shared";

export type PropertyFieldKey = keyof PropertyInput;
export type PropertyValidationErrors = Partial<Record<PropertyFieldKey, string>>;

export interface PropertyFormValidation {
  valid: boolean;
  errors: PropertyValidationErrors;
  message?: string;
}

export const validPropertyFormValidation: PropertyFormValidation = {
  valid: true,
  errors: {},
};

export function validatePropertyInput(property: PropertyInput): PropertyFormValidation {
  const parsed = propertyInputSchema.safeParse(property);

  if (parsed.success) {
    return validPropertyFormValidation;
  }

  const errors: PropertyValidationErrors = {};

  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as PropertyFieldKey | undefined;
    if (field && errors[field] == null) {
      errors[field] = issue.message;
    }
  }

  const message = Object.values(errors)[0] ?? "Fix the home details to update results.";

  return {
    valid: false,
    errors,
    message,
  };
}

export function firstPropertyValidationMessage(validation: PropertyFormValidation): string {
  return validation.message ?? Object.values(validation.errors)[0] ?? "Fix the home details to update results.";
}
