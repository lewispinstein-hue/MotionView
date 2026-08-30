import type { MotionViewExportType } from "../persistence";
export type ExportLocation = "downloads" | "desktop" | "documents" | "project" | "custom";
export interface ExportDestination { readonly kind: ExportLocation; readonly customPath: string | null }
export interface ExportRequest { readonly exportType: MotionViewExportType; readonly filenameBase: string; readonly pathName: string; readonly destination: ExportDestination }
