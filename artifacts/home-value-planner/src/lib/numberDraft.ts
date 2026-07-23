export function updateNumberDraft(
  value: string,
  setDraft: (value: string) => void,
  setNumber: (value: number) => void,
  min: number,
  max?: number,
): string | null {
  setDraft(value);

  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "Enter a valid number";
  }

  if (parsed < min || (max != null && parsed > max)) {
    return max != null ? `Enter a value between ${min.toLocaleString()} and ${max.toLocaleString()}` : `Enter a value of at least ${min.toLocaleString()}`;
  }

  setNumber(parsed);
  return null;
}
