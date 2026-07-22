import type { AppMode } from "../app/modeController";
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

export interface PlanningTelemetrySnapshot {
  plan_waypoints: number;
  plan_objects: number;
  plan_methods: number;
  plan_nodes: number;
  template_chars: number;
  [key: string]: unknown;
}

export interface PlanningModeController {
  loadImportedData(data: unknown): void;
  clear(): void;
  render(): void;
  pause(): void;
  play(): void;
  togglePlayback(): void;
  setDistance(distanceInches: number): void;
  getExportData(): {
    waypoints: PlanningWaypoint[];
    objects: PlanningObject[];
    nodes: PlanningNode[];
    template: string;
  };
  hasData(): boolean;
  bindEvents(): void;
  handleKeydown(event: KeyboardEvent): boolean;
  drawOverlay(force?: boolean): void;
  drawTimeline(): void;
  hitTestField(x: number, y: number): number;
  getTelemetryProperties(extra?: Record<string, unknown>): PlanningTelemetrySnapshot;
}

export interface PlanningModeDependencies {
  getAppMode(): AppMode;
  requestDrawAll(): void;
  setStatus(message: string, log?: boolean): void;
  scheduleSavedPathsSave(): void;
}
