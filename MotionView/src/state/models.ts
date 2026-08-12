export interface Pose {
  t: number | null;
  x: number;
  y: number;
  theta: number;
  l_vel: number | null;
  r_vel: number | null;
  speed_raw: number;
  speed_norm: number;
}

export interface WatchEntry {
  t: number;
  id: number | null;
  level: string;
  label: string;
  value: unknown;
  visible?: boolean;
}

export interface LogEntry {
  t: number;
  level: string;
  label: string;
  value: string;
  message: string;
  isSystem: boolean;
}

export type WaypointEventType = "CREATED" | "REACHED" | "TIMEDOUT";

interface WaypointEventBase {
  t: number;
  id: number;
  name: string;
}

export interface WaypointCreatedEvent extends WaypointEventBase {
  type: "CREATED";
  params: {
    tarX: number;
    tarY: number;
    tarT: number | null;
    timeoutMs: number | null;
    linearTol: number;
    thetaTol: number | null;
    retriggerable: boolean;
  };
}

export interface WaypointReachedEvent extends WaypointEventBase {
  type: "REACHED";
  params: {
    remainingTime?: number;
  };
}

export interface WaypointTimedOutEvent extends WaypointEventBase {
  type: "TIMEDOUT";
  params: Record<string, never>;
}

export type WaypointEvent = WaypointCreatedEvent | WaypointReachedEvent | WaypointTimedOutEvent;

export interface Waypoint {
  id: number;
  name: string;
  createdTime: number | null;
  createdEvent: WaypointCreatedEvent;
  target: {
    x: number;
    y: number;
    theta: number | null;
  };
  retriggerable: boolean;
  events: WaypointEvent[];
  active: boolean;
  terminalEvent: WaypointEvent | null;
  latestEvent: WaypointEvent;
  latestActiveEvent: WaypointEvent;
}

export interface PlanWaypoint {
  x: number;
  y: number;
  theta?: number;
  speed?: number;
}

export interface PlanObject {
  id: string;
  name: string;
  color?: string;
  methods?: PlanMethod[];
}

export interface PlanMethod {
  id: string;
  name: string;
  code?: string;
}

export interface PlanNode {
  id: string;
  objectId: string;
  methodId: string;
  beforeWaypoint: number;
  index: number;
  name?: string;
  code?: string;
}

export interface RouteData {
  poses: unknown;
  watches: WatchEntry[];
  logs: LogEntry[];
  waypoints: Waypoint[];
  meta: Record<string, unknown>;
}
