import type { MotionViewApp } from "../MotionViewApp";
import { bindModalBackdropDismissal } from "../dialogs/modalDismissal";
import type { RouteInfoDom } from "./RouteInfoDom";

function escape(value: unknown): string { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!); }
function flatten(value: unknown, prefix = ""): { key: string; value: string }[] {
  if (value == null) return prefix ? [{ key: prefix, value: "null" }] : [];
  if (Array.isArray(value)) return value.length ? value.flatMap((item, index) => flatten(item, prefix ? `${prefix}[${index}]` : `[${index}]`)) : prefix ? [{ key: prefix, value: "[]" }] : [];
  if (typeof value === "object") { const entries = Object.entries(value as Record<string, unknown>); return entries.length ? entries.flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key)) : prefix ? [{ key: prefix, value: "{}" }] : []; }
  return prefix ? [{ key: prefix, value: String(value) }] : [];
}
function units(value: unknown): string { const text = String(value ?? "").toLowerCase(); if (text.includes("tile")) return "tiles"; if (text.includes("cm") || text.includes("cent")) return "cm"; if (text === "ft" || text.includes("foot") || text.includes("feet")) return "ft"; return "in"; }
function number(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

export class RouteInfoView {
  #bound = false;
  constructor(private readonly app: MotionViewApp, private readonly dom: RouteInfoDom) {}
  bind(): void {
    if (this.#bound) return; this.#bound = true;
    this.dom.open.addEventListener("click", () => this.open()); this.dom.close.addEventListener("click", () => this.close()); this.dom.apply.addEventListener("click", () => this.applySettings()); bindModalBackdropDismissal(this.dom.modal, () => this.close());
    window.addEventListener("keydown", (event) => { if (event.key === "Escape" && this.isOpen) { event.preventDefault(); event.stopImmediatePropagation(); this.close(); } }, true);
    this.app.viewing.events.dataChanged.subscribe((event) => { if (event.kind === "replaced" || event.kind === "cleared" || event.kind === "appended" && event.result.metadataChanged) this.render(); }); this.render();
  }
  get isOpen(): boolean { return !this.dom.modal.hasAttribute("hidden"); }
  open(): void { this.render(); this.dom.modal.removeAttribute("hidden"); this.dom.modal.style.display = "flex"; }
  close(): void { this.dom.modal.setAttribute("hidden", ""); this.dom.modal.style.display = "none"; }
  render(): void {
    const metadata = this.app.viewing.data.metadata; this.dom.open.disabled = !metadata; const viewing = metadata?.ViewingSettings; this.dom.apply.disabled = !viewing || typeof viewing !== "object";
    const entries = flatten(metadata); this.dom.list.innerHTML = entries.length ? entries.map((entry) => `<div class="routeInfoRow"><div class="routeInfoKey">${escape(entry.key)}</div><div class="routeInfoValue">${escape(entry.value)}</div></div>`).join("") : '<div class="routeInfoEmpty">No imported metadata is available for this route.</div>';
  }
  private applySettings(): void {
    const value = this.app.viewing.data.metadata?.ViewingSettings; if (!value || typeof value !== "object") { this.app.core.status.setStatus("No run settings were found in this route metadata."); return; }
    const record = value as Record<string, unknown>; const offsets = record.PathOffsets as Record<string, unknown> | undefined; const dimensions = record.RobotDimensions as Record<string, unknown> | undefined; const speed = record.SpeedNorm as Record<string, unknown> | undefined;
    this.app.settings.update({ units: units(record.Units), selectedField: record.SelectedField == null ? this.app.settings.current.selectedField : String(record.SelectedField), offX: String(number(offsets?.X, 0)), offY: String(number(offsets?.Y, 0)), offTheta: String(number(offsets?.Theta, 0)), robotW: dimensions?.Width == null ? this.app.settings.current.robotW : String(number(dimensions.Width, Number(this.app.settings.current.robotW ?? 12))), robotH: dimensions?.Height == null ? this.app.settings.current.robotH : String(number(dimensions.Height, Number(this.app.settings.current.robotH ?? 12))), minSpeed: speed?.Minimum == null ? this.app.settings.current.minSpeed : String(number(speed.Minimum, Number(this.app.settings.current.minSpeed ?? 0))), maxSpeed: speed?.Maximum == null ? this.app.settings.current.maxSpeed : String(number(speed.Maximum, Number(this.app.settings.current.maxSpeed ?? 127))) });
    this.app.core.status.setStatus("Applied imported run settings.");
  }
}
