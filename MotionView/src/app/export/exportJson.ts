const EXPORT_DECIMAL_PLACES = 3;

export function roundExportNumber(
  value: number,
  decimals = EXPORT_DECIMAL_PLACES,
): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Serializes user-exported documents without leaking floating-point artifacts. */
export function stringifyExportJson(payload: unknown): string {
  return JSON.stringify(
    payload,
    (_key, value) =>
      typeof value === "number" ? roundExportNumber(value) : value,
    2,
  );
}
