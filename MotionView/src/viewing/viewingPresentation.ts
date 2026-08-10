import type { WatchEntry } from "../state/models";

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

export function formatNumber(value: unknown, decimals = 2, fallback = "—"): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "") : fallback;
}

export function normalizeLogLevel(value: unknown): "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" {
  const level = String(value ?? "INFO").trim().toUpperCase();
  return level === "DEBUG" || level === "WARN" || level === "ERROR" || level === "FATAL" ? level : "INFO";
}

export function levelStyle(value: unknown): Readonly<{ name: string; fill: string; text: string }> {
  const level = normalizeLogLevel(value);
  if (level === "FATAL") return { name: level, fill: "rgba(164, 0, 0, 1)", text: "#081018" };
  if (level === "ERROR") return { name: level, fill: "rgb(255,77,77)", text: "#081018" };
  if (level === "WARN") return { name: level, fill: "rgb(255,212,77)", text: "#081018" };
  if (level === "DEBUG") return { name: level, fill: "rgba(78, 246, 255, 1)", text: "#081018" };
  return { name: level, fill: "rgb(77,255,136)", text: "#081018" };
}

export function levelSortRank(value: unknown): number {
  return { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 }[normalizeLogLevel(value)];
}

export function levelFillWithAlpha(value: unknown, alpha: number): string {
  const level = normalizeLogLevel(value);
  const rgb = level === "FATAL" ? "164, 0, 0"
    : level === "ERROR" ? "255, 77, 77"
      : level === "WARN" ? "255, 212, 77"
        : level === "DEBUG" ? "78, 246, 255"
          : "77, 255, 136";
  return `rgba(${rgb}, ${alpha})`;
}

export function heatColorFromNorm(value: number): string {
  const normalized = clamp(value, 0, 1);
  const lowCut = 5 / 127;
  if (normalized <= lowCut) return "rgba(120, 10, 10, 0.95)";
  const inverse = 1 - ((normalized - lowCut) / (1 - lowCut));
  let red: number;
  let green: number;
  let blue: number;
  if (inverse <= 0.15) {
    const amount = inverse / 0.33;
    red = 40 + amount * 215;
    green = 220;
    blue = 80;
  } else if (inverse <= 0.66) {
    const amount = (inverse - 0.33) / 0.33;
    red = 255;
    green = 220 - amount * 140;
    blue = 80 - amount * 40;
  } else {
    const amount = (inverse - 0.66) / 0.34;
    red = 255;
    green = 80 - amount * 70;
    blue = 40 - amount * 30;
  }
  return `rgba(${Math.round(red)},${Math.round(green)},${Math.round(blue)},0.88)`;
}

export function watchKey(watch: Partial<WatchEntry> | null | undefined): string {
  const id = Number(watch?.id);
  return Number.isInteger(id) ? `id:${id}` : `entry:${Number(watch?.t)}`;
}

export function watchGraphKey(watch: Partial<WatchEntry> | null | undefined): string {
  const id = Number(watch?.id);
  return Number.isInteger(id) ? `id:${id}` : `label:${String(watch?.label ?? "").trim()}`;
}

export function isGraphableWatchValue(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "false" || (text !== "" && Number.isFinite(Number(text)));
}
