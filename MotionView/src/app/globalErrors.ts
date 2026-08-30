import type { BridgeService } from "./BridgeService";
function format(values: readonly unknown[]): string { return values.map((value) => { if (typeof value === "string") return value; try { return JSON.stringify(value); } catch { return String(value); } }).join(" "); }
export function installGlobalErrorReporting(bridge: BridgeService): void {
  const error = console.error.bind(console); const warn = console.warn.bind(console);
  console.error = (...values: unknown[]) => { error(...values); void bridge.log("ERROR", format(values), "console"); };
  console.warn = (...values: unknown[]) => { warn(...values); void bridge.log("WARN", format(values), "console"); };
  window.addEventListener("error", (event) => void bridge.log("ERROR", `${event.message || "Script error"} @ ${event.filename || "unknown"}:${event.lineno || 0}:${event.colno || 0}`, "window"));
  window.addEventListener("unhandledrejection", (event) => { const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason); void bridge.log("ERROR", `Unhandled rejection: ${reason}`, "window"); });
}
