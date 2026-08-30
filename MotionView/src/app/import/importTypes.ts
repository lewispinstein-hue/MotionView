export type ImportedFileType = "json" | "text" | "json-cancelled";
export interface RouteImportResult { readonly type: ImportedFileType; readonly loaded: boolean }
