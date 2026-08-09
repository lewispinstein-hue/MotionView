export type MotionViewUnit = "in" | "cm" | "ft" | "tiles";

export type UnitListener = () => void;

let currentUnits: MotionViewUnit = "in";
let unitsToInchesFactor = 1;
const unitListeners = new Set<UnitListener>();

function parseNumeric(value: unknown): number | null {
  const numericValue = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatNumberString(value: number | null, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = Number(value).toFixed(decimals);
  return fixed.replace(/\.?0+$/, "");
}

export function normalizeUnits(value: unknown): MotionViewUnit {
  const unit = String(value ?? "in");
  if (unit === "cm" || unit === "ft" || unit === "tiles") return unit;
  return "in";
}

export function setCurrentUnits(unit: unknown): void {
  const nextUnits = normalizeUnits(unit);
  if (nextUnits === "cm") unitsToInchesFactor = 1 / 2.54;
  else if (nextUnits === "ft") unitsToInchesFactor = 12;
  else if (nextUnits === "tiles") unitsToInchesFactor = 24;
  else unitsToInchesFactor = 1;

  const changed = currentUnits !== nextUnits;
  currentUnits = nextUnits;
  if (!changed) return;
  for (const listener of unitListeners) listener();
}

export function getCurrentUnits(): MotionViewUnit {
  return currentUnits;
}

export function getUnitsToInchesFactor(): number {
  return unitsToInchesFactor;
}

export function currentUnitsToInches(value: unknown): number {
  const numericValue = parseNumeric(value);
  if (numericValue == null) return 0;
  return numericValue * (unitsToInchesFactor || 1);
}

export function inchesToCurrentUnits(value: unknown): number | null {
  const numericValue = parseNumeric(value);
  if (numericValue == null) return null;
  return numericValue / (unitsToInchesFactor || 1);
}

export function formatDistanceFromInches(value: unknown, decimals = 2): string {
  return formatNumberString(inchesToCurrentUnits(value), decimals);
}

export function subscribeUnits(listener: UnitListener): () => void {
  unitListeners.add(listener);
  return () => {
    unitListeners.delete(listener);
  };
}
