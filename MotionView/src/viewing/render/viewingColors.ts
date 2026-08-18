import { clamp } from "../viewingPresentation";

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
