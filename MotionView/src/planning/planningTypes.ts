import type {
  PlanMethod,
  PlanNode,
  PlanObject,
  PlanWaypoint,
} from "../state/models";

export interface PlanningMethod extends PlanMethod {
  code: string;
}

export interface PlanningObject extends PlanObject {
  color: string;
  latestMethod: string;
  methods: PlanningMethod[];
}

export type PlanningNode = PlanNode;

export interface PlanningWaypoint extends PlanWaypoint {
  x: number;
  y: number;
  theta?: number;
  speed?: number;
}

export type PlanningCodeExportTarget =
  | "downloads"
  | "desktop"
  | "documents"
  | "project"
  | "custom";

/** Code-export fields that belong to one Planning path rather than the app. */
export interface PlanningCodeExportSettings {
  readonly header: string;
  readonly footer: string;
  readonly target: PlanningCodeExportTarget;
  readonly path: string;
}

/** A complete independently editable route that shares Planning Objects. */
export interface PlanningPath {
  id: string;
  name: string;
  waypoints: PlanningWaypoint[];
  nodes: PlanningNode[];
  codeExport: PlanningCodeExportSettings;
}

export type PlanningMethodView = Readonly<PlanningMethod>;
export type PlanningObjectView = Readonly<Omit<PlanningObject, "methods">> & {
  readonly methods: readonly PlanningMethodView[];
};
export type PlanningNodeView = Readonly<PlanningNode>;
export type PlanningWaypointView = Readonly<PlanningWaypoint>;
export type PlanningPathView = Readonly<
  Omit<PlanningPath, "waypoints" | "nodes">
> & {
  readonly waypoints: readonly PlanningWaypointView[];
  readonly nodes: readonly PlanningNodeView[];
};

export interface PlanningTelemetrySnapshot {
  plan_waypoints: number;
  plan_objects: number;
  plan_methods: number;
  plan_nodes: number;
  [key: string]: unknown;
}

export interface PlanningExportView {
  readonly waypoints: readonly PlanningWaypointView[];
  readonly objects: readonly PlanningObjectView[];
  readonly nodes: readonly PlanningNodeView[];
  readonly template: string;
}
