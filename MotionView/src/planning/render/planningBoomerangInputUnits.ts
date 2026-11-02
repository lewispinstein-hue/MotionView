import type { MotionViewUnit } from "../../shared/units";

export type BoomerangInputDimension = "distance" | "speed" | "weight";

/** Display conversion only; simulation/document values remain inches and pounds. */
export function boomerangInputUnit(dimension: BoomerangInputDimension, units: MotionViewUnit) {
  if (dimension === "weight") return units === "cm"
    ? { suffix: "kg", factor: 1 / 0.45359237 }
    : { suffix: "lb", factor: 1 };
  const factor = units === "cm" ? 1 / 2.54 : units === "ft" ? 12 : units === "tiles" ? 24 : 1;
  return { suffix: dimension === "speed" ? `${units}/s` : units, factor };
}

/** Avoid exposing conversion noise while retaining the original unedited value. */
export function boomerangInputNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}
