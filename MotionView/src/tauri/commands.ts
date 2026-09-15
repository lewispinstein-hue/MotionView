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

export function readSettings(): Promise<string | null> {
  return invokeCommand<string | null>("read_settings");
}

export function writeSettings(contents: string): Promise<void> {
  return invokeCommand<void>("write_settings", { contents });
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

export function readSavedPaths(): Promise<string | null> { return invokeCommand<string | null>("read_saved_paths"); }
export function writeSavedPaths(contents: string): Promise<void> { return invokeCommand<void>("write_saved_paths", { contents }); }

export interface MotionViewJsonExportRequest {
  readonly filenameBase: string;
  readonly location: string;
  readonly customPath: string | null;
  readonly jsonContents: string;
}
export function exportMotionViewJson(request: Readonly<MotionViewJsonExportRequest>): Promise<FileExportResult> {
  return invokeCommand<FileExportResult>("export_motionview_json", request);
}

export interface UpgradeState { readonly previousVersion: string | null; readonly currentVersion: string; readonly wasPreviousVersionOlder: boolean }
export function readUpgradeState(): Promise<UpgradeState> { return invokeCommand<UpgradeState>("was_previous_version_old"); }
export function getWindowFullscreenState(): Promise<boolean> { return invokeCommand<boolean>("get_window_fullscreen_state"); }
export function setWindowFullscreen(enable: boolean): Promise<boolean> { return invokeCommand<boolean>("set_windows_fullscreen", { enable }); }
