import type { MotionViewApp } from "../MotionViewApp";
import type { PlanningDialogs } from "../../planning";
import { buildWaypointState, normalizeLogs, normalizePoses, normalizeWatches } from "../../viewing";
import { viewingTelemetry } from "../../telemetry/createTelemetry";
import { isTauriRuntime, readUpgradeState } from "../../tauri/commands";
import { requestDrawAll } from "../../render/renderScheduler";
import type { TopBarView } from "../topBar";
import type { RouteImportResult } from "./importTypes";

function numberOrNull(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) ? number : null; }
function logLevel(value: unknown): "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" { const level = String(value ?? "INFO").toUpperCase(); return level === "DEBUG" || level === "WARN" || level === "ERROR" || level === "FATAL" ? level : "INFO"; }

export class RouteImportService {
  constructor(private readonly app: MotionViewApp, private readonly dialogs: PlanningDialogs, private readonly topBar: TopBarView, private readonly demoRouteUrl: string) {}

  async openFile(file: File | null, input?: HTMLInputElement | null): Promise<RouteImportResult | null> {
    if (!file) return null;
    const name = file.name.toLowerCase();
    if (![".json", ".txt", ".log"].some((extension) => name.endsWith(extension))) {
      window.alert("Invalid file type. Please select a .txt, .log, or .json file"); this.app.core.status.setStatus("Invalid file type."); input && (input.value = ""); return null;
    }
    try {
      const result = name.endsWith(".json") ? await this.loadJson(await file.text()) : this.loadCapture(await file.text());
      input && (input.value = "");
      if (result.loaded) this.app.core.status.setStatus(`Loaded ${file.name}`);
      await viewingTelemetry.fileLoaded({ file_name: name, file_type: result.type, file_size: file.size });
      return result;
    } catch (error) {
      input && (input.value = ""); console.error(error); this.app.core.status.setStatus(`Failed to load: ${error instanceof Error ? error.message : String(error)}`);
      await viewingTelemetry.failedFileLoad({ reason: error instanceof Error ? error.message : String(error) }); return null;
    }
  }

  async loadJson(text: string): Promise<RouteImportResult> {
    const document: unknown = JSON.parse(text); return this.loadDocument(document);
  }

  async loadDocument(document: unknown): Promise<RouteImportResult> {
    if (!document || typeof document !== "object") throw new Error("Invalid JSON: missing data object");
    const record = document as Record<string, unknown>;
    const planning = Array.isArray(record["planned-path"]) && record["planned-path"].length > 0;
    const viewing = this.hasViewing(record);
    if (planning && this.app.planning.hasData && !await this.dialogs.confirm({ title: "Replace Planning Route", message: "This import contains planning points and will replace the current planning route. Continue?", confirmLabel: "Replace" })) {
      this.app.core.status.setStatus("Import cancelled."); return { type: "json-cancelled", loaded: false };
    }
    if (planning) this.app.planning.load(document);
    if (viewing) this.app.viewing.load(document);
    if (!planning && !viewing) throw new Error("Invalid JSON: no viewing or planning route data found");
    this.finalize(); return { type: "json", loaded: true };
  }

  loadCapture(text: string): RouteImportResult {
    this.app.planning.clear(); this.app.live.loadCapture(text);
    if (!this.app.viewing.data.hasData) throw new Error("No poses, watches, logs, waypoints, or planning data found in file.");
    this.finalize(); return { type: "text", loaded: true };
  }

  async loadDemoIfUpgraded(): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    try {
      const state = await readUpgradeState();
      this.app.settings.updateAppState({ lastSeenAppVersion: state.currentVersion });
      if (state.previousVersion !== null && !(state.wasPreviousVersionOlder && !this.hasData)) return false;
      const response = await fetch(this.demoRouteUrl, { cache: "no-store" }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await this.loadDocument(await response.json());
      if (result.loaded) this.app.core.status.setStatus("Loaded getting started demo route.");
      return result.loaded;
    } catch (error) { console.warn("Failed to load getting started demo route:", error); return false; }
  }

  get hasData(): boolean { return this.app.viewing.data.hasData || this.app.planning.hasData; }

  private hasViewing(record: Record<string, unknown>): boolean {
    return normalizePoses(record.poses ?? record["robot-path"] ?? []).length > 0
      || normalizeWatches(record.watches ?? record.watch ?? [], numberOrNull).length > 0
      || normalizeLogs(record.logs ?? record.log ?? [], numberOrNull, logLevel).length > 0
      || buildWaypointState(record.waypoints ?? []).waypoints.length > 0;
  }
  private finalize(): void { this.topBar.setFieldEnabled(true); requestDrawAll(); }
}
