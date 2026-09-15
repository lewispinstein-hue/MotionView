import type { PlanningCodeExportSettings } from "../../planning/PlanningCodeExportDialog";
import type { FieldCompetition } from "../../render/field/fieldImages";

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

export interface SettingsChangedEvent {
  readonly settings: Readonly<MotionViewSettings>;
  readonly keys: readonly (keyof MotionViewSettings)[];
  readonly source: "load" | "user" | "system";
}

export const DEFAULT_SETTINGS: Readonly<MotionViewSettings> = {
  prosDir: "",
  robotImageEnabled: true,
  units: "in",
  robotW: "12",
  robotH: "12",
  offX: "0",
  offY: "0",
  offTheta: "0",
  minSpeed: "0",
  maxSpeed: "127",
  planMoveStep: "0.5",
  planSnapStep: "0",
  planThetaSnapStep: "0",
  planLimitBounds: true,
  planExportTemplate: "moveToPoint(${x}, ${y}, ${theta});",
  planningCodeExport: { header: "", footer: "", target: "downloads", path: "" },
  refreshIntervalMs: "500",
  showPreviousYearFields: true,
  fieldCompetition: "all" satisfies FieldCompetition,
  playbackSpeed: "1",
  robotImgScale: 1,
  robotImgOffX: 0,
  robotImgOffY: 0,
  robotImgRot: 0,
  robotImgAlpha: 100,
  fieldRotation: 0,
  robotImage: { path: null, dataUrl: null },
  layoutLeftSidebarWidth: 360,
  layoutRightSidebarWidthViewing: 370,
  layoutRightSidebarWidthPlanning: 370,
  layoutTimelineHeight: 180,
  layoutPlanningWaypointHeight: 240,
  layoutPlanningTimelineHeight: 144,
  appState: {},
};

export function isMotionViewSettings(value: unknown): value is MotionViewSettings {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
