import { TypedEvent } from "../app/typedEvent";

export type PlanningDocumentChangeKind =
  | "imported"
  | "cleared"
  | "route"
  | "object"
  | "method"
  | "node"
  | "path"
  | "path-export"
  | "template"
  | "simulation-configuration"
  | "overlay"
  | "history";

export interface PlanningDocumentChangedEvent {
  readonly kind: PlanningDocumentChangeKind;
}

export interface PlanningSelectionChangedEvent {
  readonly kind: "waypoint" | "node" | "method" | "cleared";
}

export interface PlanningPlaybackChangedEvent {
  readonly kind: "started" | "paused" | "time" | "rate";
  readonly time: number;
  readonly distance: number;
}

export interface PlanningProjectionChangedEvent {
  readonly kind:
    | "route"
    | "configuration"
    | "route-edit"
    | "preview-pending"
    | "preview-ready"
    | "simulation-pending"
    | "simulation-ready";
}

export class PlanningEvents {
  readonly routeEditChanged = new TypedEvent<{ readonly active: boolean }>();
  readonly documentChanged = new TypedEvent<PlanningDocumentChangedEvent>();
  readonly documentPreviewChanged =
    new TypedEvent<PlanningDocumentChangedEvent>();
  readonly selectionChanged = new TypedEvent<PlanningSelectionChangedEvent>();
  readonly playbackChanged = new TypedEvent<PlanningPlaybackChangedEvent>();
  readonly projectionChanged = new TypedEvent<PlanningProjectionChangedEvent>();
}
