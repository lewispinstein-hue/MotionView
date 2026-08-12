import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";

export function isTauriRuntime(): boolean {
  return typeof window === "object" && !!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export function resolveResourcePath(path: string): Promise<string> {
  return resolveResource(path);
}

export function readImageData(path: string): Promise<string> {
  return invokeCommand<string>("read_image_data", { path });
}

export function saveRobotImage(dataUrl: string): Promise<string | null> {
  return invokeCommand<string | null>("save_robot_image", { dataUrl });
}

export function finalizeAppQuit(): Promise<void> {
  return invokeCommand<void>("finalize_app_quit");
}

export interface FileExportResult {
  readonly path: string;
}

export function resolveExportDirectory(location: string, projectPath?: string): Promise<string> {
  return invokeCommand<string>("resolve_export_directory", {
    location,
    projectPath: projectPath || null,
  });
}

export function exportPlanningCode(path: string, contents: string): Promise<FileExportResult> {
  return invokeCommand<FileExportResult>("export_planning_code", { path, contents });
}
