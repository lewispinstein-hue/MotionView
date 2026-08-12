import type { PlanMethod, PlanNode, PlanObject, PlanWaypoint } from "../state/models";

export interface PlanningMethod extends PlanMethod {
  code: string;
}

export interface PlanningObject extends PlanObject {
  color: string;
  latestMethod: string;
  methods: PlanningMethod[];
}

export interface PlanningNode extends PlanNode {
  name?: string;
  code?: string;
}

export interface PlanningWaypoint extends PlanWaypoint {
  x: number;
  y: number;
  theta?: number;
  speed?: number;
}

export type PlanningMethodView = Readonly<PlanningMethod>;
export type PlanningObjectView = Readonly<Omit<PlanningObject, "methods">> & {
  readonly methods: readonly PlanningMethodView[];
};
export type PlanningNodeView = Readonly<PlanningNode>;
export type PlanningWaypointView = Readonly<PlanningWaypoint>;

export interface PlanningTelemetrySnapshot {
  plan_waypoints: number;
  plan_objects: number;
  plan_methods: number;
  plan_nodes: number;
  template_chars: number;
  [key: string]: unknown;
}

export interface PlanningTemplateExportTelemetrySnapshot {
  readonly plan_waypoints: number;
  readonly template: string;
  readonly plan_objects: readonly Readonly<{
    name: string;
    methods: readonly Readonly<{
      name: string;
      code: string;
    }>[];
  }>[];
  readonly [key: string]: unknown;
}

export interface PlanningExportView {
  readonly waypoints: readonly PlanningWaypointView[];
  readonly objects: readonly PlanningObjectView[];
  readonly nodes: readonly PlanningNodeView[];
  readonly template: string;
}
