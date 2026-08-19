import { TypedEvent } from "../app/typedEvent";

export type PlanningDocumentChangeKind =
  | "imported" | "cleared" | "route" | "object" | "method" | "node"
  | "template" | "overlay" | "history";

export interface PlanningDocumentChangedEvent {
  readonly kind: PlanningDocumentChangeKind;
}

export interface PlanningSelectionChangedEvent {
  readonly kind: "waypoint" | "node" | "cleared";
}

export interface PlanningPlaybackChangedEvent {
  readonly kind: "started" | "paused" | "distance" | "rate";
  readonly distance: number;
}

export interface PlanningProjectionChangedEvent {
  readonly kind: "route" | "configuration";
}

export class PlanningEvents {
  readonly documentChanged = new TypedEvent<PlanningDocumentChangedEvent>();
  readonly documentPreviewChanged = new TypedEvent<PlanningDocumentChangedEvent>();
  readonly selectionChanged = new TypedEvent<PlanningSelectionChangedEvent>();
  readonly playbackChanged = new TypedEvent<PlanningPlaybackChangedEvent>();
  readonly projectionChanged = new TypedEvent<PlanningProjectionChangedEvent>();
}
