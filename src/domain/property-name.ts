export interface PropertyNameValidation {
  valid: boolean;
  normalizedForComparison: string;
  error?: string;
}

export function validatePropertyName(raw: string): PropertyNameValidation {
  const normalizedForComparison = raw.normalize("NFC").toLocaleLowerCase();
  if (raw.length === 0) return { valid: false, normalizedForComparison, error: "Property name is required." };
  if (raw.trim() !== raw) return { valid: false, normalizedForComparison, error: "Property names cannot start or end with whitespace." };
  if (/\p{Cc}/u.test(raw)) return { valid: false, normalizedForComparison, error: "Property names cannot contain control characters." };
  if (raw === "__proto__" || raw === "constructor" || raw === "prototype") {
    return { valid: false, normalizedForComparison, error: "This property name is reserved for safety." };
  }
  return { valid: true, normalizedForComparison };
}

export function validateRename(oldName: string, newName: string): string[] {
  const oldResult = validatePropertyName(oldName);
  const newResult = validatePropertyName(newName);
  const errors: string[] = [];
  if (!oldResult.valid) errors.push(`Old property: ${oldResult.error ?? "Invalid name."}`);
  if (!newResult.valid) errors.push(`New property: ${newResult.error ?? "Invalid name."}`);
  if (oldName === newName && oldName.length > 0) errors.push("Old and new property names must differ.");
  return errors;
}
