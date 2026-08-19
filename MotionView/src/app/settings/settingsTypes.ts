import type { PlanningCodeExportSettings } from "../../planning/PlanningCodeExportDialog";

export interface PersistedRobotImage {
  readonly path?: string | null;
  readonly dataUrl?: string | null;
}

/** Backward-compatible shape of MotionView's persisted settings JSON. */
export interface MotionViewSettings {
  readonly prosDir?: string;
  readonly robotImageEnabled?: boolean;
  readonly units?: string;
  readonly robotW?: string;
  readonly robotH?: string;
  readonly offX?: string;
  readonly offY?: string;
  readonly offTheta?: string;
  readonly minSpeed?: string;
  readonly maxSpeed?: string;
  readonly planMoveStep?: string;
  readonly planSnapStep?: string;
  readonly planThetaSnapStep?: string;
  readonly planLimitBounds?: boolean;
  readonly planExportTemplate?: string;
  readonly planningCodeExport?: PlanningCodeExportSettings;
  readonly refreshIntervalMs?: string | number;
  readonly showPreviousYearFields?: boolean;
  readonly fieldCompetition?: string;
  readonly playbackSpeed?: string | number;
  readonly selectedField?: string;
  readonly robotImgScale?: string | number;
  readonly robotImgOffX?: string | number;
  readonly robotImgOffY?: string | number;
  readonly robotImgRot?: string | number;
  readonly robotImgAlpha?: string | number;
  readonly robotImage?: PersistedRobotImage;
  readonly fieldRotation?: string | number;
  readonly layoutLeftSidebarWidth?: number;
  readonly layoutRightSidebarWidthViewing?: number;
  readonly layoutRightSidebarWidthPlanning?: number;
  readonly layoutTimelineHeight?: number;
  readonly layoutPlanningWaypointHeight?: number;
  readonly layoutPlanningTimelineHeight?: number;
  readonly appState?: Readonly<Record<string, unknown>>;
}

export function isMotionViewSettings(value: unknown): value is MotionViewSettings {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
