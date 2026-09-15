import type { ViewingAppendResult } from "../viewing/viewingTypes";

export type LiveConnectionState = "disconnected" | "connecting" | "connected" | "disconnecting";
export type LiveStreamState = "idle" | "starting" | "streaming" | "stopping";
export type LiveProjectStatusKind = "missing" | "checking" | "valid" | "invalid" | "unavailable";
export type LiveNoticeKind = "info" | "success" | "error";

export interface LiveProjectStatus {
  readonly kind: LiveProjectStatusKind;
  readonly message: string;
}

export interface LiveConnectionChangedEvent {
  readonly previous: LiveConnectionState;
  readonly current: LiveConnectionState;
}

export interface LiveStreamChangedEvent {
  readonly previous: LiveStreamState;
  readonly current: LiveStreamState;
}

export interface LiveProjectChangedEvent {
  readonly path: string;
  readonly valid: boolean;
  readonly status: LiveProjectStatus;
}

export interface LivePreferencesChangedEvent {
  readonly refreshIntervalMs: number;
}

export type LiveConsoleEvent =
  | { readonly kind: "append"; readonly line: string }
  | { readonly kind: "reset" };

export interface LiveBatchAcceptedEvent {
  readonly result: Readonly<ViewingAppendResult>;
  readonly pendingLineCount: number;
}

export interface LiveNoticeEvent {
  readonly kind: LiveNoticeKind;
  readonly message: string;
}

export interface ProsDirectoryResponse {
  readonly ok?: boolean;
  readonly dir?: string;
  readonly status?: string;
}

export interface ProsDiscoveryResponse {
  readonly ok?: boolean;
  readonly candidates?: readonly string[];
  readonly status?: string;
}

export interface LiveApiResponse {
  readonly ok?: boolean;
  readonly status?: string;
}
