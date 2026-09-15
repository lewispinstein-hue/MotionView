export interface FieldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  pad: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface FieldPose {
  x: number;
  y: number;
  theta?: number | null;
  speed_norm?: number | null;
}

export interface RobotDimensions {
  w: number;
  h: number;
}

export interface RobotImageTransform {
  scale: number;
  offXIn: number;
  offYIn: number;
  rotDeg: number;
  alpha: number;
}

export interface ViewingFieldLayer {
  currentPose(): FieldPose | null;
  drawPath(): void;
  drawOverlay(): void;
  drawWaypointOffset(pose: FieldPose): void;
}

export interface PlanningFieldLayer {
  readonly overlayVisible: boolean;
  currentPose(): FieldPose | null;
  drawOverlay(force?: boolean): void;
}
