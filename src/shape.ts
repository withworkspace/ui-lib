// What the guards check a message's shape with. Not exported from the
// package.

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function isStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

// A list of protocol versions: whole numbers, 1 or above.
export function isVersions(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 1);
}
