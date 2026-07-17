// @ts-nocheck
import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Chart from "chart.js/auto";
import fitIconUrl from "./assets/svg/common/fit.svg?url";
import demoRouteUrl from "./assets/demo/getting-started-route.json?url";
import changeObjectColorIconUrl from "./assets/svg/planning/changeObjectColor.svg?url";
import removePlanningObjectIconUrl from "./assets/svg/planning/removePlanningObject.svg?url";
import invisibleWatchIconUrl from "./assets/svg/viewing/invisibleWatch.svg?url";
import pinWatchIconUrl from "./assets/svg/viewing/pinWatch.svg?url";
import visibleWatchIconUrl from "./assets/svg/viewing/visibleWatch.svg?url";
import watchGraphIconUrl from "./assets/svg/viewing/watchGraph.svg?url";
import { createModeController } from "./app/modeController";
import { applyLiveButtonState } from "./live/liveDomAdapter";
import { LiveActionGate, LivePendingBuffer, LiveWebSocketClient, stripToTag } from "./live/liveCore";
import { LiveConsoleBuffer } from "./live/liveConsole";
import { createPoseStore } from "./state/poseStore";
import { appTelemetry, exportTelemetry, initTelemetry, liveTelemetry, planningTelemetry, telemetryClient, viewingTelemetry } from "./telemetry/createTelemetry";

const isWindowsPlatform = typeof navigator === "object" && /Windows/.test(navigator.userAgent);
const isTauriRuntime = typeof window === "object" && !!window.__TAURI_INTERNALS__;

let windowsFullscreenState = false;
async function refreshWindowsFullscreenState() {
  if (!isWindowsPlatform) return windowsFullscreenState;
  try {
    windowsFullscreenState = await invoke("get_window_fullscreen_state");
  } catch (err) {
    console.error("MotionView: could not query fullscreen state:", err);
  }
  return windowsFullscreenState;
}

async function setWindowsFullscreenState(enable) {
  if (!isWindowsPlatform) return windowsFullscreenState;
  try {
    windowsFullscreenState = await invoke("set_windows_fullscreen", { enable });
  } catch (err) {
    console.error("MotionView: failed to change fullscreen state:", err);
  }
  return windowsFullscreenState;
}

function toggleWindowsFullscreen() { setWindowsFullscreenState(!windowsFullscreenState); }

if (isWindowsPlatform) {
  refreshWindowsFullscreenState();
  window.addEventListener("keydown", (event) => {
    if (event.key === "F11") {
      event.preventDefault();
      toggleWindowsFullscreen();
    } else if (event.key === "Escape" && windowsFullscreenState) {
      event.preventDefault();
      setWindowsFullscreenState(false);
    }
  });
}

let ORIGIN = window.__BRIDGE_ORIGIN__ ?? null;
let WS_ORIGIN = ORIGIN ? ORIGIN.replace(/^http/, "ws") : null;

const root = document.documentElement;
let persistedAppState = null;

const APP_VERSION = await initTelemetry();
window.posthog = telemetryClient;
// Live streaming state shared across handlers (avoids TDZ issues)
window.__live = window.__live || { connected: false, streaming: false };

const canvas = document.getElementById("c");
// Track last mouse position (for small popups)
let lastMouseClient = { x: 20, y: 20 };
window.addEventListener("mousemove", (e) => { lastMouseClient = { x: e.clientX, y: e.clientY }; }, { passive: true });

const ctx = canvas.getContext("2d");
const timelineCanvas = document.getElementById("timelineCanvas");
const tctx = timelineCanvas.getContext("2d");
const planningTimelineCanvas = document.getElementById("planningTimelineCanvas");
const planningTimelineViewport = document.getElementById("planningTimelineViewport");
const planningTimelineContent = document.getElementById("planningTimelineContent");
const planningEventTimelineEl = document.getElementById("planningEventTimeline");
const planningEventTimelineInnerEl = document.getElementById("planningEventTimelineInner");
const planningEventTimelineHintEl = document.getElementById("planningEventTimelineHint");
const planningTimelineWaypointLayerEl = document.getElementById("planningTimelineWaypointLayer");
const planningTimelineNodeLayerEl = document.getElementById("planningTimelineNodeLayer");
const planningTimelineDropLineEl = document.getElementById("planningTimelineDropLine");
const planTimePill = document.getElementById("planTimePill");
const planPointPill = document.getElementById("planPointPill");
const planNodeTooltipEl = document.getElementById("planNodeTooltip");
const pctx = planningTimelineCanvas ? planningTimelineCanvas.getContext("2d") : null;

const topBarEl = document.getElementById("topBar");
const topBarContentEl = document.querySelector(".topBarContent");
const topBarLeftEl = document.querySelector(".topBarLeft");
const topBarCenterEl = document.querySelector(".topBarCenter");
const topBarRightEl = document.querySelector(".topBarRight");
const statusEl = document.getElementById("status");
const fileEl = document.getElementById("file");
const btnPlay = document.getElementById("btnPlay");
const btnFit = document.getElementById("btnFit");
const btnFile = document.getElementById("btnFile");
const btnHelp = document.getElementById("btnHelp");
const btnLeftStop = document.getElementById("btnLeftStop");
const btnLeftConnect = document.getElementById("btnLeftConnect");
const btnLeftRefresh = document.getElementById("btnLeftRefresh");
const btnTogglePlanOverlay = document.getElementById("btnTogglePlanOverlay");
const helpModal = document.getElementById("helpModal");
const btnHelpClose = document.getElementById("btnHelpClose");
const btnHelpKeybinds = document.getElementById("btnHelpKeybinds");
const keybindsModal = document.getElementById("keybindsModal");
const btnKeybindsClose = document.getElementById("btnKeybindsClose");
const speedSelect = document.getElementById("speedSelect");
const logSort = document.getElementById("logSort");
const waypointFilter = document.getElementById("waypointFilter");
const watchFilter = document.getElementById("watchFilter");
const watchSort = document.getElementById("watchSort");
const vSplit = document.getElementById("vSplit");
const hSplit = document.getElementById("hSplit");
const planningTimelineSplit = document.getElementById("planningTimelineSplit");
const timePill = document.getElementById("timePill");
const deltaPill = document.getElementById("deltaPill");
const pointPill = document.getElementById("pointPill");
const posePill = document.getElementById("posePill");
const cursorPill = document.getElementById("cursorPill");
const planCursorPill = document.getElementById("planCursorPill");

const rightViewingEl = document.getElementById("rightViewing");
const rightPlanningEl = document.getElementById("rightPlanning");
const leftEl = document.getElementById("left");
const vSplitL = document.getElementById("vSplitL");
const rowGrid = document.querySelector(".row");

const timelineBar = document.getElementById("timelineBar");
const timelineTop = document.getElementById("timelineTop");

const layoutState = {
  lastLeftSidebarW: 360,
  lastRightSidebarW: 360,
  lastTimelineH: 260,
  lastPlanningTimelineH: 144,
};

const TOP_BAR_CENTER_STATUS_GAP_PX = 16;  // Gap between status text and center control
const TOP_BAR_CENTER_RIGHT_SCROLL_GAP_PX = 0; // Enter scroll mode if shifted center would be closer than this to the right side
let topBarMaxObservedWidth = 0;
let topBarMaxCenteredStatusWidth = 0;
let topBarSavedScrollLeft = 0;

function updateTopBarStatusLayout() {
  if (!topBarEl || !topBarContentEl || !topBarLeftEl || !topBarCenterEl || !topBarRightEl || !statusEl) return;

  const fullText = statusEl.dataset.fullText ?? statusEl.textContent ?? "";
  const previousScrollLeft = Math.max(topBarSavedScrollLeft, topBarEl.scrollLeft || 0);
  topBarEl.classList.remove("isOverflowing");
  topBarCenterEl.style.left = "50%";
  topBarCenterEl.style.top = "50%";
  statusEl.style.maxWidth = "";
  statusEl.textContent = fullText;
  statusEl.title = "";

  const topBarRect = topBarEl.getBoundingClientRect();
  const centerRect = topBarCenterEl.getBoundingClientRect();
  const rightRect = topBarRightEl.getBoundingClientRect();
  const statusRect = statusEl.getBoundingClientRect();

  const centerWidth = Math.ceil(centerRect.width);
  const idealCenterX = Math.floor(topBarRect.width / 2);
  const idealCenterLeft = idealCenterX - centerWidth / 2;
  const statusStartX = Math.floor(statusRect.left - topBarRect.left);
  const statusNaturalWidth = Math.ceil(statusEl.scrollWidth);

  const centeredStatusMaxWidth = Math.max(0, Math.floor(idealCenterLeft - statusStartX - TOP_BAR_CENTER_STATUS_GAP_PX));
  const currentBarWidth = Math.ceil(topBarRect.width);
  if (currentBarWidth >= topBarMaxObservedWidth) {
    topBarMaxObservedWidth = currentBarWidth;
    topBarMaxCenteredStatusWidth = centeredStatusMaxWidth;
  }

  // First decide based on the current centered layout only. If the status does
  // not truncate while truly centered, keep the center truly centered.
  statusEl.style.maxWidth = `${Math.max(0, centeredStatusMaxWidth)}px`;
  const centeredCurrentlyTruncates = statusEl.scrollWidth > statusEl.clientWidth;
  const centeredCenterRight = idealCenterX + centerWidth / 2;
  const gapToRightWhileCentered = (rightRect.left - topBarRect.left) - centeredCenterRight;

  if (!centeredCurrentlyTruncates && gapToRightWhileCentered >= TOP_BAR_CENTER_RIGHT_SCROLL_GAP_PX) {
    topBarCenterEl.style.left = "50%";
    statusEl.title = "";
    topBarSavedScrollLeft = 0;
    return;
  }

  const preservedStatusWidth = Math.max(centeredStatusMaxWidth, topBarMaxCenteredStatusWidth);
  const desiredStatusWidth = Math.min(statusNaturalWidth, preservedStatusWidth);
  const centeredKeepsStatusUntruncated = centeredStatusMaxWidth >= desiredStatusWidth;

  const minCenterX = Math.ceil(statusStartX + desiredStatusWidth + TOP_BAR_CENTER_STATUS_GAP_PX + centerWidth / 2);
  const shiftedCenterX = Math.max(idealCenterX, minCenterX);
  const shiftedCenterRight = shiftedCenterX + centerWidth / 2;
  const gapToRightAfterShift = (rightRect.left - topBarRect.left) - shiftedCenterRight;

  if (centeredKeepsStatusUntruncated) {
    topBarCenterEl.style.left = "50%";
    statusEl.style.maxWidth = `${Math.max(0, desiredStatusWidth)}px`;
    statusEl.title = "";
    topBarSavedScrollLeft = 0;
    return;
  }

  if (gapToRightAfterShift >= TOP_BAR_CENTER_RIGHT_SCROLL_GAP_PX) {
    topBarCenterEl.style.left = `${shiftedCenterX}px`;
    statusEl.style.maxWidth = `${Math.max(0, desiredStatusWidth)}px`;
    statusEl.title = statusEl.scrollWidth > statusEl.clientWidth ? fullText : "";
    topBarSavedScrollLeft = 0;
    return;
  }

  topBarEl.classList.add("isOverflowing");
  topBarCenterEl.style.left = "";
  topBarCenterEl.style.top = "";
  statusEl.style.maxWidth = `${Math.max(0, desiredStatusWidth)}px`;
  statusEl.textContent = fullText;
  statusEl.title = statusEl.scrollWidth > statusEl.clientWidth ? fullText : "";
  requestAnimationFrame(() => {
    if (!topBarEl?.classList.contains("isOverflowing")) return;
    const maxScrollLeft = Math.max(0, topBarEl.scrollWidth - topBarEl.clientWidth);
    const restoredScrollLeft = Math.min(previousScrollLeft, maxScrollLeft);
    topBarEl.scrollLeft = restoredScrollLeft;
    topBarSavedScrollLeft = restoredScrollLeft;
  });
}

const scheduleTopBarStatusLayout = (() => {
  let rafId = 0;
  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      updateTopBarStatusLayout();
    });
  };
})();

function parseLayoutNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readRootCssNumber(prop, fallback = 0) {
  if (!root) return fallback;
  const raw = getComputedStyle(root).getPropertyValue(prop);
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num : fallback;
}

const watchList = document.getElementById("watchList");
const watchCount = document.getElementById("watchCount");
const logList = document.getElementById("logList");
const logCount = document.getElementById("logCount");
const waypointList = document.getElementById("waypointList");
const waypointCount = document.getElementById("waypointCount");
const fieldSelect = document.getElementById("fieldSelect");

const poseList = document.getElementById("poseList");
const poseCount = document.getElementById("poseCount");

const offXEl = document.getElementById("settingsOffX");
const offYEl = document.getElementById("settingsOffY");
const offThetaEl = document.getElementById("settingsOffTheta");
const unitsSelect = document.getElementById("unitsSelect");
const robotWEl = document.getElementById("settingsRobotW");
const robotHEl = document.getElementById("settingsRobotH");
const robotImgControlsEl = document.getElementById("robotImgControls");
const robotImgScaleEl = document.getElementById("robotImgScale");
const robotImgOffXEl = document.getElementById("robotImgOffX");
const robotImgOffYEl = document.getElementById("robotImgOffY");
const robotImgRotEl = document.getElementById("robotImgRot");
const robotImgAlphaEl = document.getElementById("robotImgAlpha");
const minSpeedEl = document.getElementById("settingsMinSpeed");
const maxSpeedEl = document.getElementById("settingsMaxSpeed");
const btnExport = document.getElementById("btnExport");
const btnRouteInfo = document.getElementById("btnRouteInfo");
const exportModal = document.getElementById("exportModal");
const btnExportClose = document.getElementById("btnExportClose");
const exportPathNameInput = document.getElementById("exportPathName");
const exportFilenameInput = document.getElementById("exportFilename");
const exportFilenameHint = document.getElementById("exportFilenameHint");
const exportLocationSelect = document.getElementById("exportLocation");
const exportTypesSelect = document.getElementById("exportTypes");
const exportCustomPathWrap = document.getElementById("exportCustomPathWrap");
const exportCustomPathInput = document.getElementById("exportCustomPath");
const exportCustomPathHint = document.getElementById("exportCustomPathHint");
const exportValidationMessage = document.getElementById("exportValidationMessage");
const exportSuccessMessage = document.getElementById("exportSuccessMessage");
const btnExportCancel = document.getElementById("btnExportCancel");
const btnExportConfirm = document.getElementById("btnExportConfirm");
const routeInfoModal = document.getElementById("routeInfoModal");
const btnRouteInfoClose = document.getElementById("btnRouteInfoClose");
const routeInfoList = document.getElementById("routeInfoList");
const btnApplyRunSettings = document.getElementById("btnApplyRunSettings");
const btnPlanCopyCode = document.getElementById("btnPlanCopyCode");
const btnPlanEditTemplate = document.getElementById("btnPlanEditTemplate");
const btnPlanExport = document.getElementById("btnPlanExport");
const planTemplateModal = document.getElementById("planTemplateModal");
const planTemplateTitleEl = document.getElementById("planTemplateTitle");
const planTemplateSubtitleEl = document.getElementById("planTemplateSubtitle");
const planTemplateGroupTitleEl = document.getElementById("planTemplateGroupTitle");
const planTemplateDescriptionEl = document.getElementById("planTemplateDescription");
const planTemplateNameFieldEl = document.getElementById("planTemplateNameField");
const planTemplateNameDescriptionEl = document.getElementById("planTemplateNameDescription");
const planTemplateNameInput = document.getElementById("planTemplateNameInput");
const planTemplateValidationEl = document.getElementById("planTemplateValidation");
const btnPlanTemplateClose = document.getElementById("btnPlanTemplateClose");
const btnPlanTemplateCancel = document.getElementById("btnPlanTemplateCancel");
const btnPlanTemplateConfirm = document.getElementById("btnPlanTemplateConfirm");
const planTemplateInput = document.getElementById("planTemplateInput");
const btnPlanAddObject = document.getElementById("btnPlanAddObject");
const planObjectListEl = document.getElementById("planObjectList");
const planEventsHintEl = document.querySelector(".planEventsHint");
const planObjectDeleteModal = document.getElementById("planObjectDeleteModal");
const planObjectDeleteTitleEl = document.getElementById("planObjectDeleteTitle");
const planObjectDeleteMessageEl = document.getElementById("planObjectDeleteMessage");
const btnPlanObjectDeleteClose = document.getElementById("btnPlanObjectDeleteClose");
const btnPlanObjectDeleteCancel = document.getElementById("btnPlanObjectDeleteCancel");
const btnPlanObjectDeleteConfirm = document.getElementById("btnPlanObjectDeleteConfirm");
const watchGraphPanel = document.getElementById("watchGraphPanel");
const btnCloseWatchGraph = document.getElementById("btnCloseWatchGraph");
const watchGraphHeader = document.getElementById("watchGraphHeader");
const watchGraphResizer = document.getElementById("watchGraphResizer");
const watchGraphSubtitle = document.getElementById("watchGraphSubtitle");
const watchGraphTitle = document.getElementById("watchGraphTitle");
const watchGraphCompareSelect = document.getElementById("watchGraphCompareSelect");
const watchGraphLatest = document.getElementById("watchGraphLatest");
const watchGraphCompareLatest = document.getElementById("watchGraphCompareLatest");
const watchGraphCount = document.getElementById("watchGraphCount");
const watchGraphAvg = document.getElementById("watchGraphAvg");
const watchGraphMin = document.getElementById("watchGraphMin");
const watchGraphMax = document.getElementById("watchGraphMax");
const watchGraphCompareCount = document.getElementById("watchGraphCompareCount");
const watchGraphCompareAvg = document.getElementById("watchGraphCompareAvg");
const watchGraphCompareMin = document.getElementById("watchGraphCompareMin");
const watchGraphCompareMax = document.getElementById("watchGraphCompareMax");
const watchGraphCanvas = document.getElementById("watchGraphCanvas");
const watchGraphEmpty = document.getElementById("watchGraphEmpty");
const pinnedWatchHost = document.getElementById("pinnedWatchHost");
const pinnedWatchTemplate = document.getElementById("pinnedWatchTemplate");

// Settings modal elements
const btnSettings = document.getElementById("btnSettings");
const settingsModal = document.getElementById("settingsModal");
const btnSettingsClose = document.getElementById("btnSettingsClose");
const modeViewingBtn = document.getElementById("modeViewing");
const modePlanningBtn = document.getElementById("modePlanning");
const prosDirInput = document.getElementById("prosDirInput");
const btnProsDirAuto = document.getElementById("btnProsDirAuto");
const btnUploadRobotImage = document.getElementById("btnUploadRobotImage");
const robotImageFile = document.getElementById("robotImageFile");
const robotImageToggle = document.getElementById("robotImageToggle");
const settingsRobotImgControls = document.getElementById("settingsRobotImgControls");
const settingsRobotImgScale = document.getElementById("settingsRobotImgScale");
const settingsRobotImgOffX = document.getElementById("settingsRobotImgOffX");
const settingsRobotImgOffY = document.getElementById("settingsRobotImgOffY");
const settingsRobotImgRot = document.getElementById("settingsRobotImgRot");
const settingsRobotImgAlpha = document.getElementById("settingsRobotImgAlpha");
const settingsFieldCompetition = document.getElementById("settingsFieldCompetition");
const settingsShowPreviousYearFields = document.getElementById("settingsShowPreviousYearFields");
const settingsFieldRotation = document.getElementById("settingsFieldRotation");
const settingsUnitsSelect = document.getElementById("settingsUnitsSelect");
const settingsRobotW = document.getElementById("settingsRobotW");
const settingsRobotH = document.getElementById("settingsRobotH");
const settingsOffX = document.getElementById("settingsOffX");
const settingsOffY = document.getElementById("settingsOffY");
const settingsOffTheta = document.getElementById("settingsOffTheta");
const settingsMinSpeed = document.getElementById("settingsMinSpeed");
const settingsMaxSpeed = document.getElementById("settingsMaxSpeed");
const settingsLiveDebug = document.getElementById("settingsLiveDebug");
const settingsPlanMoveStep = document.getElementById("settingsPlanMoveStep");
const settingsPlanSnapStep = document.getElementById("settingsPlanSnapStep");
const settingsPlanThetaSnapStep = document.getElementById("settingsPlanThetaSnapStep");
const settingsPlanLimitBounds = document.getElementById("settingsPlanLimitBounds");
const planSplit = document.getElementById("planSplit");
const planListEl = document.getElementById("planList");
const planCountEl = document.getElementById("planCount");
const planSelIndexEl = document.getElementById("planSelIndex");
const planSelXEl = document.getElementById("planSelX");
const planSelYEl = document.getElementById("planSelY");
const planSelThetaEl = document.getElementById("planSelTheta");
const planSelSpeedEl = document.getElementById("planSelSpeed");
document.getElementById("versionDisplay").innerHTML = APP_VERSION;

const prosDirStatusEl = document.getElementById("prosDirStatus");
const prosDirAutoStatusEl = document.getElementById("prosDirAutoStatus");
const prosDirAutoResultsEl = document.getElementById("prosDirAutoResults");
let prosDirValid = false;
let prosDirRetryTimer = null;
let prosDirRetryAttempts = 0;
let prosDirFromSettings = false;
let backendReady = false;
let backendReadyAt = 0;
let backendReadyProbeInFlight = null;
let backendReadyLastCheckAt = 0;

// --- FIELD IMAGES ---
const CURRENT_GAME_YEAR = "2026-2027";
const DEFAULT_PLAN_EXPORT_TEMPLATE = "moveToPoint(${x}, ${y}, ${theta});";
const FIELD_IMAGES = [
  { key: "./assets/fields/v5/match_field_2026-2027_override.png", label: "Match Field (V5 Override)", comp: "v5" },
  { key: "./assets/fields/v5/skills_field_2026-2027_override.png", label: "Skills Field (V5 Override)", comp: "v5" },
  { key: "./assets/fields/IQ/head-to-head_field_2026-2027_level_up.png", label: "Head-to-Head Field (IQ Level Up)", comp: "iq" },
  { key: "./assets/fields/IQ/skills_field_2026-2027_level_up.png", label: "Skills Field (IQ Level Up)", comp: "iq" },
  { key: "./assets/fields/vU/match_field_2026-2027_override.png", label: "Match Field (VU Override)", comp: "vU" },
  { key: "./assets/fields/vU/skills_field_2026-2027_override.png", label: "Skills Field (VU Override)", comp: "vU" },
  { key: "./assets/fields/v5/match_field_2025-2026_pushback.png", label: "Match Field (V5 Pushback)", comp: "v5" },
  { key: "./assets/fields/v5/skills_field_2025-2026_pushback.png", label: "Skills Field (V5 Pushback)", comp: "v5" },
  { key: "./assets/fields/vU/field_2025-2026_pushback.png", label: "VexU Field (VU Pushback)", comp: "vU" },
  { key: "./assets/fields/v5/field_perimeter.png", label: "Field Perimeter" },
];

// Default field image
const DEFAULT_FIELD_KEY = FIELD_IMAGES[0].key;

// Field bounds in INCHES (default view when no Fit)
const FIELD_BOUNDS_IN = { minX: -72, maxX: 72, minY: -72, maxY: 72, pad: 30 };

const MAX_OFFSET_THETA = 359;

const WATCH_TOL_MS = 60; // Controls the ± time that determines which pose a watch attaches to
const COLLAPSE_PX_TIMELINE = 130; // When the timeline collapses away
const COLLAPSE_PX_SIDEBAR = 282;  // When the right sidebar collapses away
const COLLAPSE_WAYPOINTLIST_PX = 5;
const COLLAPSE_PX_PLANNING_TIMELINE = 24;

const COLLAPSE_PX_LEFTSIDEBAR = 210; // When the left sidebar collapses away
const MAX_PX_LIVEWIN = 800; // Max width for left live window panel

const MAX_TIMELINE_H_PX = 350; // Height at which timeline stops growing
const MAX_SIDEBAR_W_PX = 550;  // Width at which sidebar stops growing
const MAX_PLAN_UNDO = 50;      // Max number of undo steps

const HOVER_PIXEL_TOL = 14;
const TRACK_HOVER_PAD_PX = 12; // How close to the track before snapping on

const WAYPOINT_OFFSET_PILL_MAX_W_PX = 150;

const CANVAS_ZOOM_MAX = 15; // Max zoom in
const CANVAS_ZOOM_MIN = 0.15; // Max zoom out

// FLOATING INFO WINDOW SIZE
const floatingWindowBounds = {
  minWidth: 30,
  minHeight: 49,
  maxWidth: 400,
  maxHeight: 600
}

const WATCH_GRAPH_MIN_W = 420;
const WATCH_GRAPH_MAX_W = 1600;
const WATCH_GRAPH_MIN_H = 170;
const WATCH_GRAPH_MARGIN = 16;
let data = null;
let showPreviousYearFields = true;
let fieldCompetition = "all";
let planExportTemplate = DEFAULT_PLAN_EXPORT_TEMPLATE;

function readPlanSpeed(value, fallback = 127) {
  const num = Number(value);
  return Number.isFinite(num) ? clampPlanSpeed(num) : fallback;
}

function isFieldCurrentYear(field) {
  return String(field?.key || "").includes(CURRENT_GAME_YEAR);
}

function normalizeFieldCompetition(value) {
  return (value === "vU" || value === "v5" || value === "iq") ? value : "all";
}

function fieldMatchesCompetition(field) {
  if (fieldCompetition === "all") return true;
  return field?.comp === fieldCompetition;
}

function getVisibleFieldImages() {
  return FIELD_IMAGES.filter((field) => {
    if (!fieldMatchesCompetition(field)) return false;
    if (showPreviousYearFields) return true;
    return isFieldCurrentYear(field) || field.label.includes("Field Perimeter");
  });
}

function getValidFieldKey(fieldKey) {
  const visibleFields = getVisibleFieldImages();
  if (!visibleFields.length) return "";
  if (visibleFields.some((field) => field.key === fieldKey)) return fieldKey;
  return visibleFields[0]?.key || DEFAULT_FIELD_KEY;
}

// Raw poses are stored in FILE units; we convert to inches for rendering.
// Fields: t, x, y, theta, l_vel, r_vel, speed_raw, speed_norm
let rawPoses = createPoseStore();

// Watches: normalized
let watches = [];
let logs = [];
let waypoints = [];
let waypointsById = new Map();
let watchMarkers = []; // {watch, t, pose(in), ok, idx, dt}

let selectedWatch = null;       // { marker }
let selectedLogTime = null;
let selectedWaypointId = null;
let selectedWaypointEventTime = null;
let selectedIndex = 0;          // nearest pose index for "locked" selection
let hoverTimelineTime = null;   // preview time on timeline (ms)
let timelineHoverSaved = null;  // { index, lockActive, lockPose, lockIndex }

let hoverWatch = null;

// Track preview + lock
let trackHover = null;          // { pose, idxNearest }
let trackHoverSavedIndex = null;
let trackLockActive = false;
let trackLockPose = null;       // pose in inches
let trackLockIndex = null;

const telemetryMetrics = {
  totalPosesReceived: 0,
  totalLogsReceived: 0,
  totalWatchesReceived: 0,
  totalWaypointsReceived: 0,
};
let pendingExportRequest = null;
let importedRouteMeta = null;

// playback
let playing = false;
let raf = null;
let playTimeMs = null;
let lastWall = null;
let playRate = 1;

// world->screen
let bounds = { ...FIELD_BOUNDS_IN };
let scale = 1;
let offsetXpx = 0;
let offsetYpx = 0;

// field image
let fieldImg = null;

let robotImg = null;
let robotImgOk = false;
let robotImgLoadTried = false;
let robotImageEnabled = true; // toggle for showing/hiding robot image
let robotImagePath = null;
let robotImageDataUrl = null;

const robotImgTx = { scale: 1, offXIn: 0, offYIn: 0, rotDeg: 0, alpha: 1 };
let fieldRotationDeg = 0;
let fieldRotationRad = 0;
let fieldRotationCos = 1;
let fieldRotationSin = 0;

// view controls (pan/zoom) + square maximize mode
let squareMode = true;
let viewZoom = 1;
let viewPanXpx = 0;
let viewPanYpx = 0;
let baseScale = 1;
let baseOffsetXpx = 0;
let baseOffsetYpx = 0;

let isPanning = false;
let panArmed = false;
let panPointerId = null;
let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
let suppressNextClick = false;
let panDelta = 0;

const modeController = createModeController({
  initialMode: "viewing",
  onModeChange: (mode) => {
    document.body.classList.toggle("mode-planning", mode === "planning");
    if (mode === "planning" && playing) pause();
    if (mode === "viewing" && planPlaying) planPause();
    planSetSelection([]);
    if (modeViewingBtn) {
      const active = mode === "viewing";
      modeViewingBtn.classList.toggle("isActive", active);
      modeViewingBtn.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (modePlanningBtn) {
      const active = mode === "planning";
      modePlanningBtn.classList.toggle("isActive", active);
      modePlanningBtn.setAttribute("aria-selected", active ? "true" : "false");
    }
    updateFieldLayout(true);
    resizeTimeline();
    resizePlanningTimeline();
    renderPlanList();
    updatePlanControls();
    setPlanDist(planPlayDist);
    void appTelemetry.modeChanged({
      mode,
    });
  },
});

function getAppMode() {
  return modeController.getMode();
}

// -------- planning --------
let planWaypoints = []; // {x,y} in inches
let planSelected = -1;
let planDragging = false;
let planPointerId = null;
let planSelectedSet = new Set();
let pendingPlanCanvasClick = null; // { world, clearMultiSelection }
let planDragStart = { x: 0, y: 0 };
let planDragOrig = [];
let planSelecting = false;
let planSelectRect = null; // {x0,y0,x1,y1} in screen px
let planThetaDragging = false;
let planThetaDragIdx = -1;
let planThetaDragBase = null;
let planThetaDragStart = 0;
let planPlaying = false;
let planRaf = null;
let planPlayDist = 0;
let planLastWall = null;
const PLAN_POINT_R = 11; // Size of waypoint in planning mode
const PLAN_OVERLAY_POINT_R = 7; // Size of waypoint in overlay (viewing) mode
const PLAN_FIELD_NODE_TICK_LEN = 14; // Length of node tick
const PLAN_FIELD_NODE_MARKER_LONG = 22; // Length of node marker
const PLAN_FIELD_NODE_MARKER_THICK = 4; 
const PLAN_FIELD_NODE_HIT_R = 10; // How close cursor is to highlight
const PLAN_FIELD_NODE_TICK_MAX_IN = 0.7;
const PLAN_FIELD_NODE_MARKER_LONG_MAX_IN = 2.15;
const PLAN_FIELD_NODE_MARKER_THICK_MAX_IN = 0.28;
const PLAN_FIELD_NODE_VIEWING_MAX_IN = 2.12;
const PLAN_FIELD_NODE_BORDER_PX = 1.5;
const PLAN_THETA_HANDLE_R = 6; // Radius of theta handle
const PLAN_THETA_HANDLE_OFFSET = 25;
let PLAN_MARKER_MAX_IN = 3; // Max size of waypoint marker
let PLAN_MARKER_MAX_IN_VIEWING = 1; // Max size of waypoint marker in viewing mode
let planScrubbing = false;
let planOverlayVisible = false;
let savedPathsSaveTimer = null;
let planObjects = [];
let planNodes = [];
let planSelectedNodeId = null;
let planFieldHoverNodeId = null;
let planEditingObjectId = null;
let planEditingObjectOriginalName = "";
let planObjectEditSelectAll = false;
let planTemplateModalState = null;
let pendingPlanObjectRemovalId = null;
let pendingPlanObjectDeleteAction = null;
let pendingPlanObjectDeleteCancelAction = null;
let planOpenColorPickerObjectId = null;
let planTimelineLayout = null;
let planTimelineDropTarget = null;
let planPointerDragState = null;
let planNodeTooltipTimer = null;
let planNodeTooltipVisible = false;
let planNodeTooltipPointer = null;

const PLAN_NODE_TOOLTIP_DELAY_MS = 90;

const DEFAULT_PLAN_OBJECT_COLORS = [
  "#6d8fb3",
  "#8b7ab8",
  "#739d87",
  "#b38a6d",
  "#a06f87",
];
const PLAN_TIMELINE_PAD_X = 6;
const PLAN_TIMELINE_NODE_W = 18;
const PLAN_TIMELINE_NODE_H = 24;
const PLAN_TIMELINE_NODE_GAP = 8;
const PLAN_TIMELINE_NODE_SLOT = PLAN_TIMELINE_NODE_W + PLAN_TIMELINE_NODE_GAP;
const PLAN_TIMELINE_INSERT_HALF = (PLAN_TIMELINE_NODE_W * 0.5) + (PLAN_TIMELINE_NODE_GAP * 0.5);
const PLAN_TIMELINE_EDGE_INSET = 14;
const PLAN_TIMELINE_NODE_START_OFFSET = 18;
const PLAN_TIMELINE_NODE_END_OFFSET = 18;
const MIN_PLANNING_TIMELINE_H_PX = 144;
const DEFAULT_PLANNING_TIMELINE_H_PX = 144;
const LEGACY_PLANNING_TIMELINE_H_PX = 156;
const PLAN_POINTER_DRAG_THRESHOLD_PX = 4;

function createPlanObjectId() {
  return `plan-object-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPlanMethodId() {
  return `plan-method-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPlanNodeId() {
  return `plan-node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultPlanObjectColor(index = planObjects.length) {
  return DEFAULT_PLAN_OBJECT_COLORS[index % DEFAULT_PLAN_OBJECT_COLORS.length];
}

function getDefaultPlanObjectName(index = planObjects.length) {
  return `Object ${index + 1}`;
}

function getContrastTextColor(hexcolor) {
  const normalized = String(hexcolor || "").replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

function normalizePlanObjects(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((obj, index) => {
    const rawMethods = Array.isArray(obj?.methods) ? obj.methods : [];
    return {
      id: (typeof obj?.id === "string" && obj.id.trim()) ? obj.id.trim() : createPlanObjectId(),
      name: typeof obj?.name === "string" ? obj.name : "",
      color: (typeof obj?.color === "string" && obj.color.trim()) ? obj.color.trim() : getDefaultPlanObjectColor(index),
      latestMethod: typeof obj?.latestMethod === "string" ? obj.latestMethod : "",
      methods: rawMethods.map((method, methodIndex) => ({
        id: (typeof method?.id === "string" && method.id.trim()) ? method.id.trim() : `plan-method-${index + 1}-${methodIndex + 1}`,
        name: typeof method?.name === "string" ? method.name : "",
        code: typeof method?.code === "string" ? method.code : "",
      })),
    };
  });
}

function normalizePlanNodes(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((node) => {
    const normalized = {
      id: (typeof node?.id === "string" && node.id.trim()) ? node.id.trim() : createPlanNodeId(),
      objectId: typeof node?.objectId === "string" ? node.objectId : "",
      methodId: typeof node?.methodId === "string" ? node.methodId : "",
      beforeWaypoint: Math.max(0, Number(node?.beforeWaypoint) || 0),
      index: Math.max(0, Number(node?.index) || 0),
    };
    if (Object.prototype.hasOwnProperty.call(node || {}, "name")) normalized.name = typeof node.name === "string" ? node.name : "";
    if (Object.prototype.hasOwnProperty.call(node || {}, "code")) normalized.code = typeof node.code === "string" ? node.code : "";
    return normalized;
  });
}

function getPlanObjectById(objectId) {
  return planObjects.find((entry) => entry.id === objectId) || null;
}

function getPlanMethodById(objectId, methodId) {
  return getPlanObjectById(objectId)?.methods?.find((entry) => entry.id === methodId) || null;
}

function hasPlanNodeMethodOverride(node) {
  return !!node && (
    Object.prototype.hasOwnProperty.call(node, "name") ||
    Object.prototype.hasOwnProperty.call(node, "code")
  );
}

function getPlanNodeEffectiveMethod(node) {
  if (!node) return null;
  const method = getPlanMethodById(node.objectId, node.methodId);
  if (!method) return null;
  return {
    name: Object.prototype.hasOwnProperty.call(node, "name") ? node.name : method.name,
    code: Object.prototype.hasOwnProperty.call(node, "code") ? node.code : method.code,
    hostName: method.name,
    hostCode: method.code,
    hasOverride: hasPlanNodeMethodOverride(node),
  };
}

function setPlanNodeCodeOverride(node, codeValue) {
  if (!node) return false;
  const method = getPlanMethodById(node.objectId, node.methodId);
  if (!method) return false;
  const nextCode = String(codeValue || "");
  const hadNameOverride = Object.prototype.hasOwnProperty.call(node, "name");
  const hadCodeOverride = Object.prototype.hasOwnProperty.call(node, "code");
  const currentCode = hadCodeOverride ? node.code : method.code;
  const matchesHost = nextCode === String(method.code || "");
  const changed = hadNameOverride || nextCode !== String(currentCode || "") || (hadCodeOverride && matchesHost);
  if (!changed) return false;
  delete node.name;
  if (matchesHost) delete node.code;
  else node.code = nextCode;
  return true;
}

function serializePlanNode(node) {
  const serialized = {
    id: node.id,
    objectId: node.objectId,
    methodId: node.methodId,
    beforeWaypoint: node.beforeWaypoint,
    index: node.index,
  };
  if (Object.prototype.hasOwnProperty.call(node, "name")) serialized.name = node.name;
  if (Object.prototype.hasOwnProperty.call(node, "code")) serialized.code = node.code;
  return serialized;
}

function getPlanMethodNumber(objectId, methodId) {
  const methods = getPlanObjectById(objectId)?.methods || [];
  const index = methods.findIndex((entry) => entry.id === methodId);
  return index >= 0 ? index + 1 : null;
}

function getPlanMethodTooltipName(name) {
  const value = String(name || "").trim();
  if (!value) return "Method";
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

function getPlanNodeById(nodeId) {
  return planNodes.find((entry) => entry.id === nodeId) || null;
}

function clearPlanNodeSelection() {
  planSelectedNodeId = null;
}

function getSortedPlanNodes() {
  return [...planNodes].sort((a, b) => {
    if (a.beforeWaypoint !== b.beforeWaypoint) return a.beforeWaypoint - b.beforeWaypoint;
    if (a.index !== b.index) return a.index - b.index;
    return String(a.id).localeCompare(String(b.id));
  });
}

function normalizePlanNodeOrdering() {
  const maxBucket = Math.max(0, planWaypoints.length);
  const buckets = Array.from({ length: maxBucket + 1 }, () => []);
  for (const node of planNodes) {
    node.beforeWaypoint = clamp(Math.round(Number(node.beforeWaypoint) || 0), 0, maxBucket);
    node.index = Math.max(0, Math.round(Number(node.index) || 0));
    buckets[node.beforeWaypoint].push(node);
  }
  for (const bucket of buckets) {
    bucket.sort((a, b) => a.index - b.index || String(a.id).localeCompare(String(b.id)));
    bucket.forEach((node, index) => {
      node.index = index;
    });
  }
}

function pruneInvalidPlanNodes() {
  if (planWaypoints.length === 0) {
    const hadNodes = planNodes.length > 0;
    planNodes = [];
    if (planSelectedNodeId) {
      clearPlanNodeSelection();
      return true;
    }
    return hadNodes;
  }
  const objectIds = new Set(planObjects.map((entry) => entry.id));
  const methodsByObject = new Map(planObjects.map((entry) => [entry.id, new Set(entry.methods.map((method) => method.id))]));
  const maxBucket = Math.max(0, planWaypoints.length);
  let changed = false;
  planNodes = planNodes.filter((node) => {
    if (!objectIds.has(node.objectId)) {
      changed = true;
      return false;
    }
    if (!methodsByObject.get(node.objectId)?.has(node.methodId)) {
      changed = true;
      return false;
    }
    const nextBucket = clamp(Math.round(Number(node.beforeWaypoint) || 0), 0, maxBucket);
    const nextIndex = Math.max(0, Math.round(Number(node.index) || 0));
    if (node.beforeWaypoint !== nextBucket || node.index !== nextIndex) {
      node.beforeWaypoint = nextBucket;
      node.index = nextIndex;
      changed = true;
    }
    return true;
  });
  normalizePlanNodeOrdering();
  if (planSelectedNodeId && !getPlanNodeById(planSelectedNodeId)) {
    clearPlanNodeSelection();
    changed = true;
  }
  return changed;
}

function getPlanMoveStepIn() {
  const v = Number(settingsPlanMoveStep?.value || 0.5);
  return (isFinite(v) && v > 0) ? v : 0.5;
}

function getPlanSnapStepIn() {
  const v = Number(settingsPlanSnapStep?.value || 0);
  return (isFinite(v) && v > 0) ? v : 0;
}

function getPlanThetaSnapStepDeg() {
  const v = Number(settingsPlanThetaSnapStep?.value || 0);
  return (isFinite(v) && v > 0) ? v : 0;
}

function planLimitBoundsEnabled() {
  return settingsPlanLimitBounds ? settingsPlanLimitBounds.checked : true;
}

function applyPlanSnap(v) {
  const step = getPlanSnapStepIn();
  if (!step) return v;
  return Math.round(v / step) * step;
}

function applyPlanThetaSnapDeg(v) {
  const step = getPlanThetaSnapStepDeg();
  if (!step) return v;
  return Math.round(v / step) * step;
}

function clampPlanSpeed(v) {
  return clamp(v, 1, 127);
}

function getPlanSegmentIndexAtDist(d) {
  if (planWaypoints.length < 2) return -1;
  let rem = clamp(d, 0, planTotalLength());
  for (let i = 0; i < planWaypoints.length - 1; i += 1) {
    const a = planWaypoints[i];
    const b = planWaypoints[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg <= 0.0001) continue;
    if (rem <= seg) return i;
    rem -= seg;
  }
  return Math.max(0, planWaypoints.length - 2);
}

function getPlanSpeedUnitsPerSecAtDist(d) {
  const segIdx = getPlanSegmentIndexAtDist(d);
  if (segIdx < 0) return Math.abs(readPlanSpeed(planWaypoints[0]?.speed, 127));
  return Math.abs(readPlanSpeed(planWaypoints[segIdx]?.speed, 127));
}

function clampPlanCoordX(v) {
  const next = applyPlanSnap(v);
  if (!planLimitBoundsEnabled() || fieldImg == "None" || !fieldImg) return next;
  return clamp(next, FIELD_BOUNDS_IN.minX, FIELD_BOUNDS_IN.maxX);
}

function clampPlanCoordY(v) {
  const next = applyPlanSnap(v);
  if (!planLimitBoundsEnabled() || fieldImg == "None" || !fieldImg) return next;
  return clamp(next, FIELD_BOUNDS_IN.minY, FIELD_BOUNDS_IN.maxY);
}

let planUndoStack = [];
let planRedoStack = [];
let planUndoApplying = false;

function clonePlanState() {
  return {
    waypoints: planWaypoints.map((p) => ({ x: p.x, y: p.y, theta: p.theta ?? 0, speed: readPlanSpeed(p.speed, 127) })),
    selected: Array.from(planSelectedSet),
    selectedIndex: planSelected,
    playDist: planPlayDist,
  };
}

function planStatesEqual(a, b) {
  if (!a || !b) return false;
  if ((a.playDist ?? 0) !== (b.playDist ?? 0)) return false;
  if (a.selectedIndex !== b.selectedIndex) return false;
  if ((a.selected?.length || 0) !== (b.selected?.length || 0)) return false;
  for (let i = 0; i < (a.selected?.length || 0); i++) {
    if (a.selected[i] !== b.selected[i]) return false;
  }
  if ((a.waypoints?.length || 0) !== (b.waypoints?.length || 0)) return false;
  for (let i = 0; i < a.waypoints.length; i++) {
    const ap = a.waypoints[i];
    const bp = b.waypoints[i];
    if (!bp) return false;
    if (ap.x !== bp.x || ap.y !== bp.y || (ap.theta ?? 0) !== (bp.theta ?? 0) || readPlanSpeed(ap.speed, 127) !== readPlanSpeed(bp.speed, 127)) return false;
  }
  return true;
}

function pushPlanUndo() {
  if (getAppMode() !== "planning" || planUndoApplying) return;
  const snap = clonePlanState();
  const last = planUndoStack[planUndoStack.length - 1];
  if (last && planStatesEqual(last, snap)) return;
  planUndoStack.push(snap);
  if (planUndoStack.length > MAX_PLAN_UNDO) planUndoStack.shift();
  planRedoStack.length = 0;
}

function applyPlanState(state) {
  if (!state) return;
  planUndoApplying = true;
  planWaypoints = state.waypoints.map((p) => ({ x: p.x, y: p.y, theta: p.theta ?? 0, speed: readPlanSpeed(p.speed, 127) }));
  planSetSelection(state.selected || []);
  planPlayDist = clamp(state.playDist ?? 0, 0, planTotalLength());
  planPause();
  planChanged();
  requestDrawAll();
  planUndoApplying = false;
}

function planUndo() {
  if (getAppMode() !== "planning") return;
  if (!planUndoStack.length) return;
  planRedoStack.push(clonePlanState());
  const prev = planUndoStack.pop();
  applyPlanState(prev);
}

function planRedo() {
  if (getAppMode() !== "planning") return;
  if (!planRedoStack.length) return;
  planUndoStack.push(clonePlanState());
  const next = planRedoStack.pop();
  applyPlanState(next);
}

function planSetSelection(indices) {
  planSelectedSet = new Set(indices);
  planSelected = indices.length ? indices[0] : -1;
}

function planSelectSingle(idx) {
  if (idx < 0) {
    planSetSelection([]);
    return;
  }
  planSetSelection([idx]);
}

function planToggleSelection(idx) {
  if (idx < 0) return;
  const next = new Set(planSelectedSet);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  const indices = Array.from(next).sort((a, b) => a - b);
  planSetSelection(indices);
  planSelected = next.has(idx) ? idx : (indices.length ? indices[0] : -1);
}

function planRectSelect() {
  if (!planSelectRect) return;
  const x0 = Math.min(planSelectRect.x0, planSelectRect.x1);
  const x1 = Math.max(planSelectRect.x0, planSelectRect.x1);
  const y0 = Math.min(planSelectRect.y0, planSelectRect.y1);
  const y1 = Math.max(planSelectRect.y0, planSelectRect.y1);
  const picked = [];
  for (let i = 0; i < planWaypoints.length; i++) {
    const p = planWaypoints[i];
    const sp = worldToScreen(p.x, p.y);
    if (sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1) {
      picked.push(i);
    }
  }
  planSetSelection(picked);
}

function planThetaDegAt(i) {
  if (i < 0 || i >= planWaypoints.length) return 0;
  const cur = planWaypoints[i];
  const theta = (typeof cur.theta === "number") ? cur.theta : 0;
  return normalizeDeg(theta + offsetsIn.theta);
}

function planThetaDisplayToRaw(thetaDisplay) {
  return normalizeDeg(thetaDisplay - offsetsIn.theta);
}

function fieldHeadingToScreenDeg(thetaField) {
  return normalizeDeg(thetaField + fieldRotationDeg);
}

function fieldHeadingToCanvasRotationDeg(thetaField) {
  return normalizeDeg(fieldHeadingToScreenDeg(thetaField) - 90);
}

function planTotalLength() {
  let total = 0;
  for (let i = 0; i < planWaypoints.length - 1; i++) {
    const a = planWaypoints[i], b = planWaypoints[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

function planDistFromX(x) {
  if (!planningTimelineCanvas) return 0;
  const rect = planningTimelineCanvas.getBoundingClientRect();
  const W = rect.width || 1;
  const layout = getCurrentPlanTimelineLayout();
  const track = getPlanningTimelineTrackMetrics(W);
  const total = planTotalLength();
  if (layout?.waypointX?.length >= 2) {
    const clampedX = clamp(x, layout.waypointX[0], layout.waypointX[layout.waypointX.length - 1]);
    const distances = getPlanTimelineWaypointDistances();
    if (clampedX <= layout.waypointX[0]) return 0;
    if (clampedX >= layout.waypointX[layout.waypointX.length - 1]) return total;
    for (let i = 1; i < layout.waypointX.length; i += 1) {
      const endX = layout.waypointX[i];
      if (clampedX > endX) continue;
      const startX = layout.waypointX[i - 1];
      const span = Math.max(0, endX - startX);
      const startDist = distances[i - 1] ?? 0;
      const endDist = distances[i] ?? startDist;
      if (span <= 0.0001) return endDist;
      const t = clamp((clampedX - startX) / span, 0, 1);
      return startDist + (endDist - startDist) * t;
    }
  }
  const t = clamp((x - track.startX) / track.innerWidth, 0, 1);
  return total * t;
}

function planSampleAtDist(d) {
  if (planWaypoints.length === 0) return null;
  if (planWaypoints.length === 1) {
    const p = planWaypoints[0];
    const thetaPlan = planThetaDegAt(0);
    return { x: p.x, y: p.y, theta: thetaPlan };
  }
  let rem = d;
  for (let i = 0; i < planWaypoints.length - 1; i++) {
    const a = planWaypoints[i], b = planWaypoints[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg <= 0.0001) continue;
    if (rem <= seg) {
      const t = clamp(rem / seg, 0, 1);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const theta0 = planThetaDegAt(i);
      const theta1 = planThetaDegAt(i + 1);
      const diff = ((theta1 - theta0 + 540) % 360) - 180;
      const thetaPlan = theta0 + diff * t;
      return { x, y, theta: normalizeDeg(thetaPlan) };
    }
    rem -= seg;
  }
  const last = planWaypoints[planWaypoints.length - 1];
  const thetaPlan = planThetaDegAt(planWaypoints.length - 1);
  return { x: last.x, y: last.y, theta: thetaPlan };
}

function setPlanDist(d) {
  const total = planTotalLength();
  planPlayDist = clamp(d, 0, total);
  if (planTimePill) {
    planTimePill.textContent = `Plan: ${fmtNum(planPlayDist, 2)} / ${fmtNum(total, 2)} in`;
  }
  if (planPointPill) {
    planPointPill.textContent = `Points: ${planWaypoints.length}`;
  }
  drawPlanningTimeline();
  syncPlanObjectLatestValues();
  requestDrawAll();
}

function updatePlanControls() {
  if (btnPlay) {
    if (getAppMode() === "planning") btnPlay.disabled = planWaypoints.length < 2;
    else btnPlay.disabled = rawPoses.length < 2;
  }
  if (btnPlanCopyCode) btnPlanCopyCode.disabled = planWaypoints.length === 0;
}

function getUtf8ByteLength(value) {
  const text = String(value ?? "");
  if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
  return text.length;
}

function getPlanningTelemetryProperties(extra = {}) {
  const methodCount = planObjects.reduce((sum, obj) => sum + (Array.isArray(obj.methods) ? obj.methods.length : 0), 0);
  return {
    plan_waypoints: planWaypoints.length,
    plan_objects: planObjects.length,
    plan_methods: methodCount,
    plan_nodes: planNodes.length,
    template_chars: String(planExportTemplate || "").length,
    ...extra,
  };
}

function buildPlanExportCode(template = planExportTemplate) {
  const rawTemplate = String(template ?? "");
  if (!rawTemplate.trim()) return "";
  const renderWaypointBlock = (point, index) => {
    const prev = planWaypoints[index - 1];
    const distance = prev ? Math.hypot(point.x - prev.x, point.y - prev.y) : 0;
    const replacements = {
      x: formatTemplateNumber(point.x),
      y: formatTemplateNumber(point.y),
      theta: formatTemplateNumber(planThetaDegAt(index)),
      distance: formatTemplateNumber(distance),
      iteration: String(index),
      speed: formatTemplateNumber(readPlanSpeed(point.speed, 127), 0),
    };
    return rawTemplate.replace(/\$\{(x|y|theta|distance|iteration|speed)\}/g, (_, token) => replacements[token] ?? "");
  };

  const nodesByBucket = new Map();
  for (const node of getSortedPlanNodes()) {
    const arr = nodesByBucket.get(node.beforeWaypoint) || [];
    arr.push(node);
    nodesByBucket.set(node.beforeWaypoint, arr);
  }

  const blocks = [];
  const appendBucketMethods = (beforeWaypoint) => {
    const bucketNodes = nodesByBucket.get(beforeWaypoint) || [];
    for (const node of bucketNodes) {
      const method = getPlanNodeEffectiveMethod(node);
      if (!method) continue;
      blocks.push(String(method.code || ""));
    }
  };

  appendBucketMethods(0);
  for (let i = 0; i < planWaypoints.length; i += 1) {
    blocks.push(renderWaypointBlock(planWaypoints[i], i));
    appendBucketMethods(i + 1);
  }

  return blocks.join("\n");
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.appendChild(fallback);
  fallback.focus();
  fallback.select();
  const succeeded = document.execCommand("copy");
  document.body.removeChild(fallback);
  if (!succeeded) throw new Error("Clipboard API unavailable");
}

function openPlanTemplateModal() {
  openSharedPlanTemplateModal({
    title: "Edit Template",
    subtitle: "One template block is generated for each waypoint.",
    groupTitle: "Planning Export Template",
    description: "Available placeholders: ${x}, ${y}, ${theta}, ${distance}, ${iteration}, and ${speed}.",
    placeholder: "moveToPoint(${x}, ${y}, ${theta});",
    codeValue: planExportTemplate,
    showName: false,
    confirmLabel: "Confirm",
    onConfirm: ({ codeValue }) => {
      const previousTemplate = planExportTemplate;
      planExportTemplate = codeValue.trim() ? codeValue : DEFAULT_PLAN_EXPORT_TEMPLATE;
      saveSettings();
      void planningTelemetry.templateUpdated(getPlanningTelemetryProperties({
        template_changed: previousTemplate !== planExportTemplate,
        template_bytes: getUtf8ByteLength(planExportTemplate),
      }));
    },
  });
}

function closePlanTemplateModal() {
  if (!planTemplateModal) return;
  planTemplateModal.setAttribute("hidden", "");
  planTemplateModal.style.display = "none";
  if (planTemplateInput) planTemplateInput.value = planExportTemplate;
  if (planTemplateNameInput) planTemplateNameInput.value = "";
  if (planTemplateValidationEl) {
    planTemplateValidationEl.hidden = true;
    planTemplateValidationEl.textContent = "";
  }
  planTemplateModalState = null;
}

function confirmPlanTemplateModal() {
  if (!planTemplateModalState) return;
  const nameValue = String(planTemplateNameInput?.value || "").trim().slice(0, 25);
  const codeValue = String(planTemplateInput?.value || "");
  if (planTemplateModalState.showName && !nameValue) {
    if (planTemplateValidationEl) {
      planTemplateValidationEl.textContent = "Enter a name to continue.";
      planTemplateValidationEl.hidden = false;
    }
    planTemplateNameInput?.focus();
    return;
  }
  planTemplateModalState.onConfirm?.({ nameValue, codeValue });
  closePlanTemplateModal();
}

function openSharedPlanTemplateModal({
  title = "Edit Template",
  subtitle = "",
  groupTitle = "Editor",
  description = "",
  placeholder = "",
  codeValue = "",
  showName = false,
  nameValue = "",
  nameDescription = "Name",
  confirmLabel = "Confirm",
  onConfirm = null,
} = {}) {
  if (!planTemplateModal) return;
  planTemplateModalState = {
    showName,
    onConfirm,
  };
  if (planTemplateTitleEl) planTemplateTitleEl.textContent = title;
  if (planTemplateSubtitleEl) planTemplateSubtitleEl.textContent = subtitle;
  if (planTemplateGroupTitleEl) planTemplateGroupTitleEl.textContent = groupTitle;
  if (planTemplateDescriptionEl) planTemplateDescriptionEl.textContent = description;
  if (planTemplateInput) {
    planTemplateInput.value = codeValue;
    planTemplateInput.placeholder = placeholder;
  }
  if (planTemplateNameFieldEl) planTemplateNameFieldEl.hidden = !showName;
  if (planTemplateNameInput) planTemplateNameInput.value = nameValue;
  if (planTemplateNameDescriptionEl) planTemplateNameDescriptionEl.textContent = nameDescription;
  if (btnPlanTemplateConfirm) btnPlanTemplateConfirm.textContent = confirmLabel;
  if (planTemplateValidationEl) {
    planTemplateValidationEl.hidden = true;
    planTemplateValidationEl.textContent = "";
  }
  planTemplateModal.removeAttribute("hidden");
  planTemplateModal.style.display = "flex";
  requestAnimationFrame(() => {
    if (showName && planTemplateNameInput) {
      planTemplateNameInput.focus();
      planTemplateNameInput.select();
    } else if (planTemplateInput) {
      planTemplateInput.focus();
      planTemplateInput.setSelectionRange(planTemplateInput.value.length, planTemplateInput.value.length);
    } else {
      const modalCard = planTemplateModal.querySelector(".modalCard");
      if (modalCard) modalCard.focus();
    }
  });
}

function openPlanMethodCreateModal(objectId) {
  const object = planObjects.find((entry) => entry.id === objectId);
  if (!object) return;
  cancelPlanObjectNameEdit();
  openSharedPlanTemplateModal({
    title: "Add Method",
    subtitle: `Create a new method for ${object.name || "this object"}.`,
    groupTitle: "Method",
    description: "Enter a method name and optional code. The name is required.",
    placeholder: "",
    codeValue: "",
    showName: true,
    nameValue: "",
    nameDescription: "Method name",
    confirmLabel: "Confirm",
    onConfirm: ({ nameValue, codeValue }) => {
      const target = planObjects.find((entry) => entry.id === objectId);
      if (!target) return;
      target.methods.unshift({
        id: createPlanMethodId(),
        name: nameValue.slice(0, 25),
        code: codeValue,
      });
      savePlanObjectsUi();
      void planningTelemetry.methodCreated(getPlanningTelemetryProperties({
        method_code_chars: String(codeValue || "").length,
        method_code_bytes: getUtf8ByteLength(codeValue),
      }));
    },
  });
}

function openPlanMethodEditModal(objectId, methodId) {
  const object = planObjects.find((entry) => entry.id === objectId);
  const method = object?.methods?.find((entry) => entry.id === methodId);
  if (!object || !method) return;
  cancelPlanObjectNameEdit();
  openSharedPlanTemplateModal({
    title: "Edit Method",
    subtitle: `Update ${method.name || "method"} in ${object.name || "this object"}.`,
    groupTitle: "Method",
    description: "Update the method name and code. The name is required.",
    placeholder: "",
    codeValue: method.code || "",
    showName: true,
    nameValue: method.name || "",
    nameDescription: "Method name",
    confirmLabel: "Confirm",
    onConfirm: ({ nameValue, codeValue }) => {
      const targetObject = planObjects.find((entry) => entry.id === objectId);
      const targetMethod = targetObject?.methods?.find((entry) => entry.id === methodId);
      if (!targetMethod) return;
      const previousName = targetMethod.name || "";
      const previousCode = targetMethod.code || "";
      targetMethod.name = nameValue.slice(0, 25);
      targetMethod.code = codeValue;
      savePlanObjectsUi();
      void planningTelemetry.methodUpdated(getPlanningTelemetryProperties({
        method_name_changed: previousName !== targetMethod.name,
        method_code_changed: previousCode !== targetMethod.code,
        method_code_chars: String(codeValue || "").length,
        method_code_bytes: getUtf8ByteLength(codeValue),
      }));
    },
  });
}

function openPlanNodeEditModal(nodeId) {
  const node = getPlanNodeById(nodeId);
  const object = node ? getPlanObjectById(node.objectId) : null;
  const method = getPlanNodeEffectiveMethod(node);
  if (!node || !object || !method) return;
  cancelPlanObjectNameEdit();
  openSharedPlanTemplateModal({
    title: "Edit Placed Node",
    subtitle: `Update this placed node from ${object.name || "this object"}.`,
    groupTitle: "Node Code",
    description: "These code changes only apply to this placed node. Matching the host code again clears the override.",
    placeholder: "",
    codeValue: method.code || "",
    showName: false,
    confirmLabel: "Confirm",
    onConfirm: ({ codeValue }) => {
      const targetNode = getPlanNodeById(nodeId);
      const beforeOverride = hasPlanNodeMethodOverride(targetNode);
      if (!setPlanNodeCodeOverride(targetNode, codeValue)) return;
      savePlanTimelineUi();
      renderPlanObjects();
      requestDrawAll();
      const effective = getPlanNodeEffectiveMethod(targetNode);
      void planningTelemetry.timelineNodeUpdated(getPlanningTelemetryProperties({
        node_override_created: !beforeOverride && !!effective?.hasOverride,
        node_override_cleared: beforeOverride && !effective?.hasOverride,
        node_code_chars: String(codeValue || "").length,
        node_code_bytes: getUtf8ByteLength(codeValue),
      }));
    },
  });
}

function getPlanTimelineWaypointDistances() {
  const distances = [];
  let acc = 0;
  for (let i = 0; i < planWaypoints.length; i += 1) {
    if (i > 0) {
      const prev = planWaypoints[i - 1];
      const cur = planWaypoints[i];
      acc += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    }
    distances.push(acc);
  }
  return distances;
}

function getPlanningTimelineTrackMetrics(width) {
  const safeWidth = Math.max(1, width || 0);
  const startX = PLAN_TIMELINE_PAD_X + PLAN_TIMELINE_EDGE_INSET;
  const endX = Math.max(startX, safeWidth - PLAN_TIMELINE_PAD_X - PLAN_TIMELINE_EDGE_INSET);
  return {
    startX,
    endX,
    innerWidth: Math.max(1, endX - startX),
  };
}

function getCurrentPlanTimelineLayout() {
  return planTimelineLayout || buildPlanTimelineLayout();
}

function getPlanTimelineXFromDistance(distance) {
  const layout = getCurrentPlanTimelineLayout();
  if (!layout || !layout.waypointX.length) return PLAN_TIMELINE_PAD_X + PLAN_TIMELINE_EDGE_INSET;
  if (layout.waypointX.length === 1) return layout.waypointX[0];

  const total = planTotalLength();
  const clampedDistance = clamp(distance, 0, total);
  const distances = getPlanTimelineWaypointDistances();
  if (clampedDistance <= 0) return layout.waypointX[0];
  if (clampedDistance >= total) return layout.waypointX[layout.waypointX.length - 1];

  for (let i = 1; i < distances.length; i += 1) {
    const endDist = distances[i];
    if (clampedDistance > endDist) continue;
    const startDist = distances[i - 1] ?? 0;
    const segLen = Math.max(0, endDist - startDist);
    if (segLen <= 0.0001) return layout.waypointX[i];
    const t = clamp((clampedDistance - startDist) / segLen, 0, 1);
    return layout.waypointX[i - 1] + (layout.waypointX[i] - layout.waypointX[i - 1]) * t;
  }

  return layout.waypointX[layout.waypointX.length - 1];
}

function buildPlanTimelineLayout() {
  if (!planningTimelineViewport || !planningEventTimelineInnerEl) return null;
  const waypointCount = planWaypoints.length;
  const viewportWidth = Math.max(1, planningTimelineViewport.clientWidth || planningTimelineViewport.getBoundingClientRect().width || 1);
  const totalLength = planTotalLength();
  const baseContentWidth = Math.max(viewportWidth, PLAN_TIMELINE_PAD_X * 2 + 120);
  const buckets = Array.from({ length: waypointCount + 1 }, (_, beforeWaypoint) => ({
    beforeWaypoint,
    nodes: [],
  }));
  for (const node of getSortedPlanNodes()) {
    if (buckets[node.beforeWaypoint]) buckets[node.beforeWaypoint].nodes.push(node);
  }

  const baseWaypointX = [];
  if (waypointCount > 0) {
    if (waypointCount === 1) {
      baseWaypointX.push(PLAN_TIMELINE_PAD_X + PLAN_TIMELINE_EDGE_INSET);
    } else if (totalLength <= 0) {
      for (let i = 0; i < waypointCount; i += 1) {
        const ratio = i / Math.max(1, waypointCount - 1);
        baseWaypointX.push(
          PLAN_TIMELINE_PAD_X + PLAN_TIMELINE_EDGE_INSET
          + (baseContentWidth - PLAN_TIMELINE_PAD_X * 2 - PLAN_TIMELINE_EDGE_INSET * 2) * ratio
        );
      }
    } else {
      const distances = getPlanTimelineWaypointDistances();
      for (let i = 0; i < waypointCount; i += 1) {
        const ratio = distances[i] / totalLength;
        baseWaypointX.push(
          PLAN_TIMELINE_PAD_X + PLAN_TIMELINE_EDGE_INSET
          + (baseContentWidth - PLAN_TIMELINE_PAD_X * 2 - PLAN_TIMELINE_EDGE_INSET * 2) * ratio
        );
      }
    }
  }

  const baseBucketWidths = [];
  if (waypointCount > 0) {
    baseBucketWidths.push(Math.max(0, baseWaypointX[0] - PLAN_TIMELINE_PAD_X));
    for (let i = 1; i < waypointCount; i += 1) {
      baseBucketWidths.push(Math.max(0, baseWaypointX[i] - baseWaypointX[i - 1]));
    }
    baseBucketWidths.push(Math.max(0, baseContentWidth - PLAN_TIMELINE_PAD_X - baseWaypointX[waypointCount - 1]));
  } else {
    baseBucketWidths.push(baseContentWidth - PLAN_TIMELINE_PAD_X * 2);
  }

  const bucketWidths = baseBucketWidths.map((width, beforeWaypoint) => {
    const count = buckets[beforeWaypoint]?.nodes?.length || 0;
    if (!waypointCount) return width;
    if (beforeWaypoint === 0 || beforeWaypoint === waypointCount) {
      const needed = count > 0 ? PLAN_TIMELINE_NODE_START_OFFSET + PLAN_TIMELINE_NODE_W + (count - 1) * PLAN_TIMELINE_NODE_SLOT : width;
      return Math.max(width, needed);
    }
    const needed = count > 0
      ? PLAN_TIMELINE_NODE_START_OFFSET + PLAN_TIMELINE_NODE_W + (count - 1) * PLAN_TIMELINE_NODE_SLOT + PLAN_TIMELINE_NODE_END_OFFSET
      : width;
    return Math.max(width, needed);
  });

  const waypointX = [];
  let cursor = PLAN_TIMELINE_PAD_X;
  if (waypointCount > 0) {
    for (let i = 0; i < waypointCount; i += 1) {
      cursor += bucketWidths[i];
      waypointX.push(cursor);
    }
    cursor += bucketWidths[waypointCount];
  } else {
    cursor = PLAN_TIMELINE_PAD_X + bucketWidths[0];
  }

  const contentWidth = Math.max(viewportWidth, cursor + PLAN_TIMELINE_PAD_X);
  const bucketLayouts = buckets.map((bucket, beforeWaypoint) => {
    const start = beforeWaypoint === 0 ? PLAN_TIMELINE_PAD_X : waypointX[beforeWaypoint - 1];
    const width = bucketWidths[beforeWaypoint] ?? 0;
    const end = start + width;
    const nodeStart = beforeWaypoint === 0 ? start + 10 : start + PLAN_TIMELINE_NODE_START_OFFSET;
    return {
      beforeWaypoint,
      start,
      end,
      width,
      nodeStart,
      nodes: bucket.nodes,
    };
  });

  return {
    waypointCount,
    contentWidth,
    waypointX,
    buckets: bucketLayouts,
  };
}

function getPlanTimelinePointerContentX(clientX) {
  if (!planningEventTimelineInnerEl) return 0;
  const rect = planningEventTimelineInnerEl.getBoundingClientRect();
  return clientX - rect.left;
}

function getPlanTimelineDropTargetFromClientX(clientX) {
  const layout = planTimelineLayout || buildPlanTimelineLayout();
  if (!layout || planWaypoints.length < 2) return null;
  const x = clamp(getPlanTimelinePointerContentX(clientX), PLAN_TIMELINE_PAD_X, layout.contentWidth - PLAN_TIMELINE_PAD_X);
  let bucket = null;
  if (layout.waypointCount > 0 && x < layout.waypointX[0]) {
    bucket = layout.buckets[0] || null;
  } else if (layout.waypointCount > 0 && x > layout.waypointX[layout.waypointX.length - 1]) {
    bucket = layout.buckets[layout.buckets.length - 1] || null;
  } else {
    for (let i = 1; i < layout.buckets.length - 1; i += 1) {
      const candidate = layout.buckets[i];
      if (x <= candidate.end) {
        bucket = candidate;
        break;
      }
    }
  }
  if (!bucket) bucket = layout.buckets[Math.min(1, layout.buckets.length - 1)] || layout.buckets[0] || null;
  if (!bucket) return null;
  const local = x - bucket.nodeStart;
  const count = bucket.nodes.length;
  const rawIndex = count <= 0 ? 0 : Math.floor((local + PLAN_TIMELINE_NODE_SLOT * 0.5) / PLAN_TIMELINE_NODE_SLOT);
  const index = clamp(rawIndex, 0, count);
  const lineX = count <= 0
    ? clamp(x, bucket.start + 8, bucket.end - 8)
    : clamp(
      bucket.nodeStart + index * PLAN_TIMELINE_NODE_SLOT - PLAN_TIMELINE_INSERT_HALF,
      PLAN_TIMELINE_PAD_X + 2,
      layout.contentWidth - PLAN_TIMELINE_PAD_X - 2,
    );
  return {
    beforeWaypoint: bucket.beforeWaypoint,
    index,
    lineX,
  };
}

function getPlanNodeThresholdDistance(node, bucketNodes) {
  const bucketIndex = clamp(node.beforeWaypoint, 0, planWaypoints.length);
  if (bucketIndex <= 0) return 0;
  if (bucketIndex >= planWaypoints.length) return planTotalLength();
  const distances = getPlanTimelineWaypointDistances();
  const start = distances[bucketIndex - 1] ?? 0;
  const end = distances[bucketIndex] ?? start;
  const segLen = Math.max(0, end - start);
  const count = Math.max(1, bucketNodes.length);
  return start + segLen * (node.index / count);
}

function getLatestPlanMethodNameForObject(objectId) {
  if (planWaypoints.length < 2) return "\u2014";
  const nodes = getSortedPlanNodes().filter((node) => node.objectId === objectId);
  if (!nodes.length) return "\u2014";
  const buckets = new Map();
  for (const node of getSortedPlanNodes()) {
    const key = String(node.beforeWaypoint);
    const arr = buckets.get(key) || [];
    arr.push(node);
    buckets.set(key, arr);
  }
  let latest = null;
  for (const node of nodes) {
    const bucketNodes = buckets.get(String(node.beforeWaypoint)) || [];
    const threshold = getPlanNodeThresholdDistance(node, bucketNodes);
    if (threshold <= planPlayDist + 0.0001) latest = node;
  }
  if (!latest) return "\u2014";
  return getPlanNodeEffectiveMethod(latest)?.name || "\u2014";
}

function syncPlanObjectLatestValues() {
  if (!planObjectListEl) return;
  for (const card of planObjectListEl.querySelectorAll(".planObjectCard")) {
    const objectId = card.getAttribute("data-object-id") || "";
    const valueEl = card.querySelector(".planObjectLatestValue");
    if (!valueEl) continue;
    valueEl.textContent = getLatestPlanMethodNameForObject(objectId);
  }
}

function savePlanTimelineUi() {
  pruneInvalidPlanNodes();
  renderPlanningEventTimeline();
  syncPlanObjectLatestValues();
  scheduleSavedPathsSave();
}

function normalizePlanningTimelineHeightForContent() {
  if (planNodes.length > 0) return;
  const current = getPlanningTimelineH();
  if (current > DEFAULT_PLANNING_TIMELINE_H_PX) {
    root.style.setProperty("--planningTimelineH", `${DEFAULT_PLANNING_TIMELINE_H_PX}px`);
    layoutState.lastPlanningTimelineH = DEFAULT_PLANNING_TIMELINE_H_PX;
    resizePlanningTimeline();
    void saveSettings();
  }
}

function scrollPlanMethodIntoView(objectId, methodId) {
  const esc = (value) => (globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));
  const methodEl = planObjectListEl?.querySelector(`.planMethodCard[data-object-id="${esc(objectId)}"][data-method-id="${esc(methodId)}"]`);
  const objectEl = planObjectListEl?.querySelector(`.planObjectCard[data-object-id="${esc(objectId)}"]`);
  objectEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  methodEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function selectPlanNode(nodeId, { scrollSidebar = false } = {}) {
  planSelectedNodeId = nodeId || null;
  renderPlanningEventTimeline();
  renderPlanObjects();
  syncPlanObjectLatestValues();
  requestDrawAll();
  if (scrollSidebar && nodeId) {
    const node = getPlanNodeById(nodeId);
    if (node) scrollPlanMethodIntoView(node.objectId, node.methodId);
  }
}

function buildFieldPlanNodeMarkers() {
  if (planWaypoints.length < 2 || !planNodes.length) return [];

  const markers = [];
  const sortedNodes = getSortedPlanNodes();
  const nodesByBucket = new Map();
  const distances = getPlanTimelineWaypointDistances();
  for (const node of sortedNodes) {
    if (!nodesByBucket.has(node.beforeWaypoint)) nodesByBucket.set(node.beforeWaypoint, []);
    nodesByBucket.get(node.beforeWaypoint).push(node);
  }

  for (const [bucketIndex, bucketNodes] of nodesByBucket.entries()) {
    if (!Array.isArray(bucketNodes) || !bucketNodes.length) continue;
    if (bucketIndex <= 0 || bucketIndex >= planWaypoints.length) continue;

    const start = planWaypoints[bucketIndex - 1];
    const end = planWaypoints[bucketIndex];
    if (!start || !end) continue;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;

    const tx = dx / len;
    const ty = dy / len;
    const nx = -ty;
    const ny = tx;
    const segStartDist = distances[bucketIndex - 1] ?? 0;
    const markerLongPx = getAppMode() === "planning"
      ? Math.max(8, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_MARKER_LONG, PLAN_FIELD_NODE_MARKER_LONG_MAX_IN))
      : Math.min(
        PLAN_FIELD_NODE_VIEWING_MAX_IN * scale,
        Math.max(8, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_MARKER_LONG, PLAN_FIELD_NODE_MARKER_LONG_MAX_IN)),
      );
    const waypointRadiusPx = getAppMode() === "planning"
      ? Math.min(PLAN_POINT_R, PLAN_MARKER_MAX_IN * scale)
      : Math.min(PLAN_OVERLAY_POINT_R, PLAN_MARKER_MAX_IN_VIEWING * scale);
    const startClearanceDist = Math.min(len, (waypointRadiusPx + markerLongPx * 0.3 + 1.5) / Math.max(scale, 0.0001));

    for (const node of bucketNodes) {
      const object = getPlanObjectById(node.objectId);
      if (!object) continue;
      const method = getPlanNodeEffectiveMethod(node);
      if (!method) continue;
      const threshold = getPlanNodeThresholdDistance(node, bucketNodes);
      const rawDist = clamp(threshold - segStartDist, 0, len);
      const usableLen = Math.max(0, len - startClearanceDist);
      const alongDist = usableLen <= 0
        ? len
        : startClearanceDist + (rawDist / len) * usableLen;
      const frac = clamp(alongDist / len, 0, 1);
      markers.push({
        node,
        object,
        method,
        tooltipText: `${object.name || "Object"} · ${getPlanMethodTooltipName(method?.name)}`,
        x: start.x + dx * frac,
        y: start.y + dy * frac,
        tx,
        ty,
        nx,
        ny,
      });
    }
  }

  return markers;
}

function hitTestPlanFieldNodeAtClient(clientX, clientY) {
  const markers = buildFieldPlanNodeMarkers();
  if (!markers.length) return null;
  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  let best = null;
  let bestD2 = Infinity;

  for (const marker of markers) {
    const sp = worldToScreen(marker.x, marker.y);
    const dx = sp.x - mx;
    const dy = sp.y - my;
    const d2 = dx * dx + dy * dy;
    if (d2 <= PLAN_FIELD_NODE_HIT_R * PLAN_FIELD_NODE_HIT_R && d2 < bestD2) {
      best = marker;
      bestD2 = d2;
    }
  }

  return best;
}

function createPlanMethodDragGhostCard({ objectId, methodId }) {
  const object = getPlanObjectById(objectId);
  const method = getPlanMethodById(objectId, methodId);
  const ghost = document.createElement("div");
  ghost.className = "planMethodCard planMethodDragGhost";
  ghost.innerHTML = `
    <div class="planMethodGrip" aria-hidden="true">⋮⋮</div>
    <div class="planMethodIndex">${escapeHtml(String(getPlanMethodNumber(objectId, methodId) || ""))}</div>
    <div class="planMethodContent">
      <div class="planMethodName">${escapeHtml(method?.name || "")}</div>
      <div class="planMethodCode">${escapeHtml(method?.code || "")}</div>
    </div>
    <button class="iconBtn planMethodRemoveBtn" type="button" aria-hidden="true" tabindex="-1">
      <svg width="30" height="30" aria-hidden="true">
        <use href="${svgIconHref("icon-removePlanningObject")}"></use>
      </svg>
    </button>
  `;
  if (object?.color) {
    ghost.style.setProperty("--plan-drag-color", object.color);
  }
  document.body.appendChild(ghost);
  return ghost;
}

function clearPlanTimelineDropTarget() {
  planTimelineDropTarget = null;
  planningEventTimelineEl?.classList?.remove("isDropActive");
  if (planningTimelineDropLineEl) planningTimelineDropLineEl.hidden = true;
}

function updatePlanTimelineDropTarget(clientX) {
  const next = getPlanTimelineDropTargetFromClientX(clientX);
  planTimelineDropTarget = next;
  if (planningEventTimelineEl) planningEventTimelineEl.classList.toggle("isDropActive", !!next);
  if (!planningTimelineDropLineEl || !next) {
    if (planningTimelineDropLineEl) planningTimelineDropLineEl.hidden = true;
    return;
  }
  planningTimelineDropLineEl.hidden = false;
  planningTimelineDropLineEl.style.left = `${next.lineX}px`;
}

function clearPlanNodeTooltipTimer() {
  if (planNodeTooltipTimer) {
    clearTimeout(planNodeTooltipTimer);
    planNodeTooltipTimer = null;
  }
}

function positionPlanNodeTooltip(clientX, clientY) {
  if (!planNodeTooltipEl) return;
  const offsetX = 12;
  const offsetY = 14;
  const maxX = window.innerWidth - planNodeTooltipEl.offsetWidth - 8;
  const maxY = window.innerHeight - planNodeTooltipEl.offsetHeight - 8;
  const left = clamp(clientX + offsetX, 8, Math.max(8, maxX));
  const top = clamp(clientY + offsetY, 8, Math.max(8, maxY));
  planNodeTooltipEl.style.left = `${left}px`;
  planNodeTooltipEl.style.top = `${top}px`;
}

function hidePlanNodeTooltip({ immediate = false } = {}) {
  clearPlanNodeTooltipTimer();
  planNodeTooltipPointer = null;
  if (!planNodeTooltipEl) return;
  planNodeTooltipVisible = false;
  planNodeTooltipEl.classList.remove("isVisible");
  planNodeTooltipEl.setAttribute("aria-hidden", "true");
  if (immediate) {
    planNodeTooltipEl.hidden = true;
    return;
  }
  window.setTimeout(() => {
    if (!planNodeTooltipVisible && planNodeTooltipEl) planNodeTooltipEl.hidden = true;
  }, 100);
}

function showPlanNodeTooltip(text, clientX, clientY) {
  if (!planNodeTooltipEl || !text) return;
  clearPlanNodeTooltipTimer();
  planNodeTooltipPointer = { clientX, clientY };
  planNodeTooltipTimer = window.setTimeout(() => {
    if (!planNodeTooltipEl || !planNodeTooltipPointer) return;
    planNodeTooltipEl.textContent = text;
    planNodeTooltipEl.hidden = false;
    positionPlanNodeTooltip(planNodeTooltipPointer.clientX, planNodeTooltipPointer.clientY);
    planNodeTooltipVisible = true;
    planNodeTooltipEl.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      if (planNodeTooltipVisible) planNodeTooltipEl.classList.add("isVisible");
    });
  }, PLAN_NODE_TOOLTIP_DELAY_MS);
}

function updatePlanNodeTooltip(text, clientX, clientY) {
  planNodeTooltipPointer = { clientX, clientY };
  if (!planNodeTooltipVisible) {
    showPlanNodeTooltip(text, clientX, clientY);
    return;
  }
  if (!planNodeTooltipEl) return;
  if (planNodeTooltipEl.textContent !== text) planNodeTooltipEl.textContent = text;
  positionPlanNodeTooltip(clientX, clientY);
}

function renderPlanningEventTimeline() {
  if (!planningEventTimelineInnerEl || !planningTimelineWaypointLayerEl || !planningTimelineNodeLayerEl || !planningTimelineContent) return;
  hidePlanNodeTooltip({ immediate: true });
  pruneInvalidPlanNodes();
  planTimelineLayout = buildPlanTimelineLayout();
  const layout = planTimelineLayout;
  if (!layout) return;

  planningTimelineContent.style.width = `${Math.ceil(layout.contentWidth)}px`;
  planningEventTimelineInnerEl.style.width = `${Math.ceil(layout.contentWidth)}px`;

  const canPlace = planWaypoints.length >= 2;
  if (planningEventTimelineHintEl) {
    planningEventTimelineHintEl.hidden = canPlace;
  }

  planningTimelineWaypointLayerEl.innerHTML = "";
  planningTimelineNodeLayerEl.innerHTML = "";
  if (!canPlace) {
    syncPlanningTimelineCanvasSize();
    clearPlanTimelineDropTarget();
    drawPlanningTimeline();
    return;
  }

  for (const x of layout.waypointX) {
    const connector = document.createElement("div");
    connector.className = "planningTimelineWaypointConnector";
    connector.style.left = `${x}px`;
    planningTimelineWaypointLayerEl.appendChild(connector);
  }

  for (const node of getSortedPlanNodes()) {
    const object = getPlanObjectById(node.objectId);
    const methodNumber = getPlanMethodNumber(node.objectId, node.methodId);
    const method = getPlanNodeEffectiveMethod(node);
    const bucket = layout.buckets[node.beforeWaypoint];
    if (!object || !methodNumber || !method || !bucket) continue;
    const nodeEl = document.createElement("button");
    nodeEl.type = "button";
    nodeEl.className = "planningTimelineNode";
    if (method.hasOverride) nodeEl.classList.add("hasOverride");
    if (planSelectedNodeId === node.id) nodeEl.classList.add("isSelected");
    nodeEl.draggable = false;
    nodeEl.dataset.nodeId = node.id;
    nodeEl.dataset.objectId = node.objectId;
    nodeEl.dataset.methodId = node.methodId;
    nodeEl.style.left = `${bucket.nodeStart + node.index * PLAN_TIMELINE_NODE_SLOT}px`;
    nodeEl.style.background = object.color || getDefaultPlanObjectColor();
    nodeEl.style.color = getContrastTextColor(object.color || getDefaultPlanObjectColor());
    const tooltipText = `${object.name || "Object"} · ${getPlanMethodTooltipName(method.name)}`;
    nodeEl.setAttribute("aria-label", tooltipText);
    nodeEl.textContent = String(methodNumber);
    nodeEl.addEventListener("click", (e) => {
      e.preventDefault();
      selectPlanNode(node.id, { scrollSidebar: true });
    });
    nodeEl.addEventListener("dblclick", (e) => {
      e.preventDefault();
      openPlanNodeEditModal(node.id);
    });
    nodeEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      hidePlanNodeTooltip({ immediate: true });
      beginPlanPointerDrag({
        source: "node",
        objectId: node.objectId,
        methodId: node.methodId,
        nodeId: node.id,
        sourceEl: nodeEl,
        startX: e.clientX,
        startY: e.clientY,
      });
    });
    nodeEl.addEventListener("pointerenter", (e) => {
      updatePlanNodeTooltip(tooltipText, e.clientX, e.clientY);
    });
    nodeEl.addEventListener("pointermove", (e) => {
      updatePlanNodeTooltip(tooltipText, e.clientX, e.clientY);
    });
    nodeEl.addEventListener("pointerleave", () => {
      hidePlanNodeTooltip();
    });
    nodeEl.addEventListener("focus", () => {
      const rect = nodeEl.getBoundingClientRect();
      updatePlanNodeTooltip(tooltipText, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
    nodeEl.addEventListener("blur", () => {
      hidePlanNodeTooltip({ immediate: true });
    });
    planningTimelineNodeLayerEl.appendChild(nodeEl);
  }

  if (planTimelineDropTarget) {
    updatePlanTimelineDropTarget((planningEventTimelineInnerEl.getBoundingClientRect().left || 0) + planTimelineDropTarget.lineX);
  } else {
    clearPlanTimelineDropTarget();
  }
  syncPlanningTimelineCanvasSize();
  drawPlanningTimeline();
}

function renderPlanObjects() {
  if (!planObjectListEl) return;
  planObjectListEl.innerHTML = "";
  const selectedNode = getPlanNodeById(planSelectedNodeId);
  const highlightedObjectId = selectedNode?.objectId || "";
  const highlightedMethodId = selectedNode?.methodId || "";

  if (planEventsHintEl) {
    planEventsHintEl.textContent = planObjects.length
      ? "Double-click an object name to rename it."
      : "Add an object to define reusable method groups for this route.";
  }

  for (let i = 0; i < planObjects.length; i += 1) {
    const obj = planObjects[i];
    const card = document.createElement("article");
    card.className = "planObjectCard";
    card.dataset.objectId = obj.id;
    if (obj.id === highlightedObjectId) card.classList.add("isHighlighted");

    const header = document.createElement("div");
    header.className = "planObjectHeader";

    const meta = document.createElement("div");
    meta.className = "planObjectMeta";

    if (planEditingObjectId === obj.id) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "planObjectNameEditor";
      input.value = obj.name;
      input.placeholder = "Object name";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.dataset.objectId = obj.id;

      input.addEventListener("blur", () => {
        commitPlanObjectNameEdit(obj.id, input.value);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitPlanObjectNameEdit(obj.id, input.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelPlanObjectNameEdit();
        }
      });
      meta.appendChild(input);
    } else {
      const name = document.createElement("div");
      name.className = "planObjectName";
      name.textContent = obj.name || getDefaultPlanObjectName(i);
      name.addEventListener("dblclick", () => {
        startPlanObjectNameEdit(obj.id, true);
      });
      meta.appendChild(name);
    }

    const subtle = document.createElement("div");
    subtle.className = "planObjectSubtle";
    subtle.textContent = `${obj.methods.length} method${obj.methods.length === 1 ? "" : "s"}`;
    meta.appendChild(subtle);
    header.appendChild(meta);

    const latest = document.createElement("div");
    latest.className = "planObjectLatest";
    latest.innerHTML = `
      <span class="planObjectLatestLabel">Latest</span>
      <span class="planObjectLatestValue">${escapeHtml(getPlanObjectLatestValue(obj))}</span>
    `;
    header.appendChild(latest);
    card.appendChild(header);

    const methodList = document.createElement("div");
    methodList.className = "planMethodList";
    if (!obj.methods.length) {
      const empty = document.createElement("div");
      empty.className = "planMethodEmpty";
      empty.textContent = "No methods yet.";
      methodList.appendChild(empty);
    } else {
      for (const [methodIndex, method] of obj.methods.entries()) {
        const methodCard = document.createElement("div");
        methodCard.className = "planMethodCard";
        if (obj.id === highlightedObjectId && method.id === highlightedMethodId) methodCard.classList.add("isHighlighted");
        methodCard.draggable = false;
        methodCard.dataset.objectId = obj.id;
        methodCard.dataset.methodId = method.id;
        methodCard.innerHTML = `
          <div class="planMethodGrip" aria-hidden="true">⋮⋮</div>
          <div class="planMethodIndex">${methodIndex + 1}</div>
          <div class="planMethodContent">
            <div class="planMethodName">${escapeHtml(method.name || "")}</div>
            <div class="planMethodCode">${escapeHtml(method.code || "")}</div>
          </div>
          <button class="iconBtn planMethodRemoveBtn" type="button" title="Remove Method" aria-label="Remove Method" data-object-id="${escapeHtml(obj.id)}" data-method-id="${escapeHtml(method.id)}">
            <svg width="30" height="30" aria-hidden="true">
              <use href="${svgIconHref("icon-removePlanningObject")}"></use>
            </svg>
          </button>
        `;
        attachPlanMethodCardDragHandlers(methodCard);
        methodCard.addEventListener("dblclick", (e) => {
          const removeBtn = e.target instanceof Element ? e.target.closest(".planMethodRemoveBtn") : null;
          if (removeBtn) return;
          openPlanMethodEditModal(obj.id, method.id);
        });
        methodList.appendChild(methodCard);
      }
    }
    card.appendChild(methodList);

    const actions = document.createElement("div");
    actions.className = "planObjectActions";
    actions.innerHTML = `
      <button class="iconBtn secondaryBtn planMethodAddBtn" type="button" title="Add Method" aria-label="Add Method" data-object-id="${escapeHtml(obj.id)}">Add Method</button>
      <div class="planObjectActionTools">
        <div class="planObjectColorWrap">
          <button class="iconBtn secondaryBtn planObjectColorBtn" type="button" title="Change Object Color" aria-label="Change Object Color" data-object-id="${escapeHtml(obj.id)}" style="color:${escapeHtml(obj.color || getDefaultPlanObjectColor(i))}">
            <svg width="30" height="30" aria-hidden="true">
              <use href="${svgIconHref("icon-planningChangeObjectColor")}"></use>
            </svg>
          </button>
          <div class="planObjectColorPopover"${planOpenColorPickerObjectId === obj.id ? "" : " hidden"}>
            <input class="planObjectColorInput" type="color" value="${escapeHtml(obj.color || getDefaultPlanObjectColor(i))}" aria-label="Object color" data-object-id="${escapeHtml(obj.id)}" />
          </div>
        </div>
      </div>
      <button class="iconBtn secondaryBtn planObjectRemoveActionBtn" type="button" title="Remove Object" aria-label="Remove Object" data-object-id="${escapeHtml(obj.id)}">
        <svg width="30" height="30" aria-hidden="true">
          <use href="${svgIconHref("icon-removePlanningObject")}"></use>
        </svg>
      </button>
    `;
    card.appendChild(actions);
    planObjectListEl.appendChild(card);

    if (planEditingObjectId === obj.id) {
      const input = card.querySelector(".planObjectNameEditor");
      if (input) {
        requestAnimationFrame(() => {
          input.focus();
          if (planObjectEditSelectAll) input.select();
          else input.setSelectionRange(input.value.length, input.value.length);
        });
      }
    }
  }
}

function startPlanObjectNameEdit(objectId, selectAll = false) {
  const object = planObjects.find((entry) => entry.id === objectId);
  if (!object) return;
  planEditingObjectId = objectId;
  planEditingObjectOriginalName = object.name || "";
  planObjectEditSelectAll = !!selectAll;
  renderPlanObjects();
}

function clearPlanObjectEditState() {
  planEditingObjectId = null;
  planEditingObjectOriginalName = "";
  planObjectEditSelectAll = false;
}

function savePlanObjectsUi() {
  renderPlanObjects();
  renderPlanningEventTimeline();
  syncPlanObjectLatestValues();
  requestDrawAll();
  scheduleSavedPathsSave();
}

function cancelPlanObjectNameEdit() {
  clearPlanObjectEditState();
  renderPlanObjects();
}

function commitActivePlanObjectEdit() {
  if (!planEditingObjectId) return;
  const activeInput = planObjectListEl?.querySelector?.(".planObjectNameEditor");
  const nextValue = activeInput ? activeInput.value : planEditingObjectOriginalName;
  commitPlanObjectNameEdit(planEditingObjectId, nextValue);
}

function commitPlanObjectNameEdit(objectId, nextNameRaw) {
  const object = planObjects.find((entry) => entry.id === objectId);
  if (!object) {
    cancelPlanObjectNameEdit();
    return;
  }
  const nextName = String(nextNameRaw || "").trim();
  const objectIndex = planObjects.findIndex((entry) => entry.id === objectId);
  object.name = nextName || planEditingObjectOriginalName || getDefaultPlanObjectName(objectIndex);
  clearPlanObjectEditState();
  savePlanObjectsUi();
}

function getPlanObjectLatestValue(object) {
  if (!object) return "\u2014";
  return getLatestPlanMethodNameForObject(object.id);
}

function setPlanObjectColor(objectId, color) {
  const object = planObjects.find((entry) => entry.id === objectId);
  if (!object) return;
  const nextColor = String(color || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(nextColor)) return;
  object.color = nextColor;
  savePlanObjectsUi();
}

function addPlanObject() {
  const next = {
    id: createPlanObjectId(),
    name: "",
    color: getDefaultPlanObjectColor(planObjects.length),
    latestMethod: "",
    methods: [],
  };
  planObjects.push(next);
  planEditingObjectId = next.id;
  planEditingObjectOriginalName = "";
  planObjectEditSelectAll = false;
  savePlanObjectsUi();
  void planningTelemetry.objectCreated(getPlanningTelemetryProperties({
    object_methods: next.methods.length,
  }));
}

function removePlanObject(objectId) {
  const idx = planObjects.findIndex((entry) => entry.id === objectId);
  if (idx < 0) return;
  const removedObject = planObjects[idx];
  const removedMethodIds = new Set((removedObject.methods || []).map((method) => method.id));
  const removedNodeCount = planNodes.filter((entry) => entry.objectId === objectId || removedMethodIds.has(entry.methodId)).length;
  planObjects.splice(idx, 1);
  planNodes = planNodes.filter((entry) => entry.objectId !== objectId);
  if (planSelectedNodeId && !getPlanNodeById(planSelectedNodeId)) clearPlanNodeSelection();
  if (planEditingObjectId === objectId) clearPlanObjectEditState();
  savePlanObjectsUi();
  void planningTelemetry.objectRemoved(getPlanningTelemetryProperties({
    removed_methods: removedMethodIds.size,
    removed_nodes: removedNodeCount,
  }));
}

function hasAnyPlanMethods() {
  return planObjects.some((entry) => Array.isArray(entry.methods) && entry.methods.length > 0);
}

function clearPlanningModeData() {
  planWaypoints = [];
  planObjects = [];
  planNodes = [];
  planSetSelection([]);
  clearPlanNodeSelection();
  planPlayDist = 0;
  planPause();
  planChanged();
  renderPlanObjects();
  renderPlanningEventTimeline();
  normalizePlanningTimelineHeightForContent();
}

function openPlanDangerConfirmModal(message, action) {
  return openPlanDangerConfirmModalWithOptions({ message, onConfirm: action });
}

function openPlanDangerConfirmModalWithOptions({
  title = "Confirm",
  message = "Are you sure?",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm = null,
  onCancel = null,
} = {}) {
  cancelPlanObjectNameEdit();
  pendingPlanObjectRemovalId = null;
  pendingPlanObjectDeleteAction = typeof onConfirm === "function" ? onConfirm : null;
  pendingPlanObjectDeleteCancelAction = typeof onCancel === "function" ? onCancel : null;
  if (planObjectDeleteTitleEl) {
    planObjectDeleteTitleEl.textContent = title;
  }
  if (planObjectDeleteMessageEl) {
    planObjectDeleteMessageEl.textContent = message;
  }
  if (btnPlanObjectDeleteConfirm) btnPlanObjectDeleteConfirm.textContent = confirmLabel;
  if (btnPlanObjectDeleteCancel) btnPlanObjectDeleteCancel.textContent = cancelLabel;
  if (planObjectDeleteModal) {
    planObjectDeleteModal.removeAttribute("hidden");
    planObjectDeleteModal.style.display = "flex";
    requestAnimationFrame(() => {
      const modalCard = planObjectDeleteModal.querySelector(".modalCard");
      if (modalCard) modalCard.focus();
    });
  }
}

function requestPlanObjectRemoval(objectId) {
  const object = planObjects.find((entry) => entry.id === objectId);
  if (!object) return;
  cancelPlanObjectNameEdit();
  if (!object.methods.length) {
    removePlanObject(objectId);
    return;
  }
  pendingPlanObjectRemovalId = objectId;
  openPlanDangerConfirmModal(`Are you sure you want to remove Object ${object.name}?`, () => removePlanObject(objectId));
}

function closePlanObjectDeleteModal() {
  pendingPlanObjectRemovalId = null;
  pendingPlanObjectDeleteAction = null;
  pendingPlanObjectDeleteCancelAction = null;
  if (!planObjectDeleteModal) return;
  planObjectDeleteModal.setAttribute("hidden", "");
  planObjectDeleteModal.style.display = "none";
}

function cancelPlanObjectDeleteModal() {
  const cancelAction = pendingPlanObjectDeleteCancelAction;
  closePlanObjectDeleteModal();
  if (cancelAction) cancelAction();
}

function confirmPlanObjectRemoval() {
  if (pendingPlanObjectDeleteAction) pendingPlanObjectDeleteAction();
  else if (pendingPlanObjectRemovalId) removePlanObject(pendingPlanObjectRemovalId);
  closePlanObjectDeleteModal();
}

function hasImportedPlanningWaypoints(obj) {
  return Array.isArray(obj?.["planned-path"]) && obj["planned-path"].length > 0;
}

function hasImportedViewingData(obj) {
  return normalizePoseArray(obj?.poses || obj?.["robot-path"] || []).length > 0
    || normalizeWatches(obj?.watches || obj?.watch || []).length > 0
    || normalizeLogs(obj?.logs || obj?.log || []).length > 0
    || normalizeWaypoints(obj?.waypoints || []).length > 0;
}

function applyImportedPlanningData(obj) {
  if (Array.isArray(obj["planned-path"])) {
    planWaypoints = obj["planned-path"].map((p) => ({
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      theta: Number(p.theta) || 0,
      speed: readPlanSpeed(p.speed, 127),
    }));
  } else {
    planWaypoints = [];
  }
  if (obj["planned-export-template"] !== undefined) {
    const savedTemplate = String(obj["planned-export-template"] || "");
    planExportTemplate = savedTemplate.trim() ? savedTemplate : DEFAULT_PLAN_EXPORT_TEMPLATE;
  }
  planSetSelection([]);
  planPlayDist = 0;
  planObjects = normalizePlanObjects(obj["planned-objects"] || []);
  planNodes = normalizePlanNodes(obj["planned-nodes"] || []);
  pruneInvalidPlanNodes();
  clearPlanNodeSelection();
  renderPlanObjects();
  renderPlanningEventTimeline();
  normalizePlanningTimelineHeightForContent();
}

function applyImportedViewingData(obj) {
  rawPoses = normalizePoseArray(obj.poses || obj["robot-path"] || []);
  watches = normalizeWatches(obj.watches || obj.watch || []);
  logs = normalizeLogs(obj.logs || obj.log || []);
  waypoints = normalizeWaypoints(obj.waypoints || []);
  setImportedRouteMeta(obj.meta);
}

function confirmPlanningImportOverride() {
  return new Promise((resolve) => {
    openPlanDangerConfirmModalWithOptions({
      title: "Replace Planning Route",
      message: "This import contains planning points and will replace the current planning route. Continue?",
      confirmLabel: "Replace",
      cancelLabel: "Cancel",
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function removePlanMethod(objectId, methodId) {
  const object = planObjects.find((entry) => entry.id === objectId);
  if (!object) return;
  const idx = object.methods.findIndex((entry) => entry.id === methodId);
  if (idx < 0) return;
  const removedNodeCount = planNodes.filter((entry) => entry.objectId === objectId && entry.methodId === methodId).length;
  object.methods.splice(idx, 1);
  planNodes = planNodes.filter((entry) => !(entry.objectId === objectId && entry.methodId === methodId));
  if (planSelectedNodeId && !getPlanNodeById(planSelectedNodeId)) clearPlanNodeSelection();
  savePlanObjectsUi();
  void planningTelemetry.methodRemoved(getPlanningTelemetryProperties({
    removed_nodes: removedNodeCount,
  }));
}

function insertPlanNode(objectId, methodId, beforeWaypoint, index) {
  const object = getPlanObjectById(objectId);
  const method = getPlanMethodById(objectId, methodId);
  if (!object || !method || planWaypoints.length < 2) return null;
  const node = {
    id: createPlanNodeId(),
    objectId,
    methodId,
    beforeWaypoint: clamp(Math.round(beforeWaypoint || 0), 0, planWaypoints.length),
    index: Math.max(0, Math.round(index || 0)),
  };
  const bucketNodes = planNodes
    .filter((entry) => entry.beforeWaypoint === node.beforeWaypoint)
    .sort((a, b) => a.index - b.index);
  for (const entry of bucketNodes) {
    if (entry.index >= node.index) entry.index += 1;
  }
  planNodes.push(node);
  normalizePlanNodeOrdering();
  return node;
}

function movePlanNode(nodeId, beforeWaypoint, index) {
  const node = getPlanNodeById(nodeId);
  if (!node) return null;
  const originalBucket = node.beforeWaypoint;
  const originalIndex = node.index;
  const targetBucket = clamp(Math.round(beforeWaypoint || 0), 0, planWaypoints.length);
  let targetIndex = Math.max(0, Math.round(index || 0));

  if (originalBucket === targetBucket && targetIndex > originalIndex) targetIndex -= 1;
  planNodes = planNodes.filter((entry) => entry.id !== nodeId);
  normalizePlanNodeOrdering();
  node.beforeWaypoint = targetBucket;
  node.index = targetIndex;
  const bucketNodes = planNodes
    .filter((entry) => entry.beforeWaypoint === targetBucket)
    .sort((a, b) => a.index - b.index);
  for (const entry of bucketNodes) {
    if (entry.index >= targetIndex) entry.index += 1;
  }
  planNodes.push(node);
  normalizePlanNodeOrdering();
  return node;
}

function removePlanNode(nodeId) {
  const idx = planNodes.findIndex((entry) => entry.id === nodeId);
  if (idx < 0) return;
  const removedNode = planNodes[idx];
  planNodes.splice(idx, 1);
  normalizePlanNodeOrdering();
  if (planSelectedNodeId === nodeId) clearPlanNodeSelection();
  savePlanTimelineUi();
  normalizePlanningTimelineHeightForContent();
  renderPlanObjects();
  void planningTelemetry.timelineNodeRemoved(getPlanningTelemetryProperties({
    before_waypoint: removedNode.beforeWaypoint,
  }));
}

function attachPlanMethodCardDragHandlers(card) {
  if (!card || card.dataset.dragBound === "1") return;
  card.dataset.dragBound = "1";
  card.draggable = false;
  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest(".planMethodRemoveBtn")) return;
    beginPlanPointerDrag({
      source: "sidebar",
      objectId: card.dataset.objectId || "",
      methodId: card.dataset.methodId || "",
      sourceEl: card,
      startX: e.clientX,
      startY: e.clientY,
    });
  });
}

function renderPlanList() {
  if (!planListEl) return;
  planListEl.innerHTML = "";
  if (planCountEl) planCountEl.textContent = `${planWaypoints.length}`;
  for (let i = 0; i < planWaypoints.length; i++) {
    const p = planWaypoints[i];
    const item = document.createElement("div");
    item.className = "planItem" + (planSelectedSet.has(i) ? " selected" : "");
    item.dataset.idx = String(i);
    const theta = planThetaDegAt(i);
    item.innerHTML = `
      <div class="muted">#${i + 1}</div>
      <div>X: ${fmtNum(p.x, 2)}  Y: ${fmtNum(p.y, 2)}  θ: ${fmtNum(theta, 1)}°  S: ${fmtNum(readPlanSpeed(p.speed, 127), 0)}</div>
    `;
    item.addEventListener("click", (e) => {
      if (e.shiftKey) planToggleSelection(i);
      else planSelectSingle(i);
      requestDrawAll();
      renderPlanList();
      updatePlanSelectionPanel();
    });
    planListEl.appendChild(item);
  }
}

function applySavedLayout(settings) {
  if (!settings) return;
  let layoutChanged = false;

  const leftWidth = parseLayoutNumber(settings.layoutLeftSidebarWidth);
  if (leftWidth !== null) {
    const next = clamp(leftWidth, 0, MAX_PX_LIVEWIN);
    root.style.setProperty("--leftSidebarW", `${next}px`);
    layoutChanged = true;
    if (next <= COLLAPSE_PX_LEFTSIDEBAR) {
      leftEl?.classList?.add("isCollapsed");
      rowGrid?.classList?.add("leftCollapsed");
    } else {
      leftEl?.classList?.remove("isCollapsed");
      rowGrid?.classList?.remove("leftCollapsed");
      layoutState.lastLeftSidebarW = next;
    }
  }

  const rightViewingWidth = parseLayoutNumber(settings.layoutRightSidebarWidthViewing);
  if (rightViewingWidth !== null) {
    const next = clamp(rightViewingWidth, 0, MAX_SIDEBAR_W_PX);
    root.style.setProperty("--rightSidebarWViewing", `${next}px`);
    layoutChanged = true;
    if (next <= COLLAPSE_PX_SIDEBAR) {
      rightViewingEl?.classList?.add("isCollapsed");
    } else {
      rightViewingEl?.classList?.remove("isCollapsed");
      layoutState.lastRightSidebarW = next;
    }
  }

  const rightPlanningWidth = parseLayoutNumber(settings.layoutRightSidebarWidthPlanning);
  if (rightPlanningWidth !== null) {
    const next = clamp(rightPlanningWidth, 0, MAX_SIDEBAR_W_PX);
    root.style.setProperty("--rightSidebarWPlanning", `${next}px`);
    layoutChanged = true;
    if (next <= COLLAPSE_PX_SIDEBAR) {
      rightPlanningEl?.classList?.add("isCollapsed");
    } else {
      rightPlanningEl?.classList?.remove("isCollapsed");
      layoutState.lastRightSidebarWPlanning = next;
    }
  }

  const timelineHeight = parseLayoutNumber(settings.layoutTimelineHeight);
  if (timelineHeight !== null) {
    const next = clamp(timelineHeight, 0, MAX_TIMELINE_H_PX);
    root.style.setProperty("--timelineH", `${next}px`);
    layoutChanged = true;
    if (next <= COLLAPSE_PX_TIMELINE) {
      timelineBar?.classList?.add("isCollapsed");
    } else {
      timelineBar?.classList?.remove("isCollapsed");
      layoutState.lastTimelineH = next;
    }
  }

  const planHeight = parseLayoutNumber(settings.layoutPlanningWaypointHeight);
  if (planHeight !== null) {
    const rightH = rightPlanningEl?.getBoundingClientRect().height || window.innerHeight;
    const maxPlanH = Math.max(COLLAPSE_WAYPOINTLIST_PX, rightH - 180);
    const next = clamp(planHeight, 0, maxPlanH);
    root.style.setProperty("--planListH", `${next}px`);
    layoutChanged = true;
    if (next <= COLLAPSE_WAYPOINTLIST_PX) {
      rightPlanningEl?.classList?.add("planListCollapsed");
    } else {
      rightPlanningEl?.classList?.remove("planListCollapsed");
    }
  }

  const planningTimelineHeight = parseLayoutNumber(settings.layoutPlanningTimelineHeight);
  if (planningTimelineHeight !== null) {
    const migratedPlanningTimelineHeight =
      Math.abs(planningTimelineHeight - LEGACY_PLANNING_TIMELINE_H_PX) < 2
        ? DEFAULT_PLANNING_TIMELINE_H_PX
        : planningTimelineHeight;
    const next = migratedPlanningTimelineHeight <= COLLAPSE_PX_PLANNING_TIMELINE
      ? 0
      : DEFAULT_PLANNING_TIMELINE_H_PX;
    root.style.setProperty("--planningTimelineH", `${next}px`);
    layoutChanged = true;
    if (next > COLLAPSE_PX_PLANNING_TIMELINE) {
      layoutState.lastPlanningTimelineH = DEFAULT_PLANNING_TIMELINE_H_PX;
      timelineBar?.classList?.remove("isCollapsed");
    } else {
      timelineBar?.classList?.add("isCollapsed");
    }
  }

  if (layoutChanged) {
    updateFieldLayout(true);
    resizeTimeline();
    resizePlanningTimeline();
    layoutTimelineCanvas();
  }
}

function centerOnWorld(x, y) {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const sp = worldToScreen(x, y);
  viewPanXpx += cx - sp.x;
  viewPanYpx += cy - sp.y;
  computeTransform();
}

function planChanged(opts = {}) {
  pruneInvalidPlanNodes();
  renderPlanList();
  updatePlanControls();
  setPlanDist(planPlayDist);
  renderPlanningEventTimeline();
  syncPlanObjectLatestValues();
  updateExportButtonAvailability();
  if (!opts.skipSelectionPanel) updatePlanSelectionPanel();
  scheduleSavedPathsSave();
}

async function loadSavedPaths() {
  try {
    const saved = await invoke("read_saved_paths");
    if (!saved) return;
    const obj = JSON.parse(saved);
    if (Array.isArray(obj?.["planned-path"])) {
      planWaypoints = obj["planned-path"].map((p) => ({
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        theta: Number(p.theta) || 0,
        speed: readPlanSpeed(p.speed, 127),
      }));
    } else {
      planWaypoints = [];
    }
    if (obj?.["planned-export-template"] !== undefined) {
      const savedTemplate = String(obj["planned-export-template"] || "");
      planExportTemplate = savedTemplate.trim() ? savedTemplate : DEFAULT_PLAN_EXPORT_TEMPLATE;
    }
    planSetSelection([]);
    planPlayDist = 0;
    planChanged();
    planObjects = normalizePlanObjects(obj?.["planned-objects"] || []);
    planNodes = normalizePlanNodes(obj?.["planned-nodes"] || []);
    pruneInvalidPlanNodes();
    clearPlanNodeSelection();
    renderPlanObjects();
    renderPlanningEventTimeline();
    normalizePlanningTimelineHeightForContent();
    rawPoses = normalizePoseArray(obj?.["robot-path"] || []);
    watches = normalizeWatches(obj?.["watches"] || []);
    logs = normalizeLogs(obj?.["logs"] || []);
    waypoints = normalizeWaypoints(obj?.["waypoints"] || []);
    data = { poses: rawPoses, watches, logs, waypoints, meta: {} };
    if (hasLoadedData()) {
      finalizeLoadedData();
      updatePlanControls();
      updateFieldLayout(true);
    }
  } catch (e) {
    console.warn("Failed to load saved paths:", e);
  }
}

function scheduleSavedPathsSave() {
  if (savedPathsSaveTimer) clearTimeout(savedPathsSaveTimer);
  savedPathsSaveTimer = setTimeout(async () => {
    try {
      const payload = buildSavedPathsPayload();
      await invoke("write_saved_paths", { contents: payload });
    } catch (e) {
      console.warn("Failed to save paths:", e);
    }
  }, 300);
}

function buildSavedPathsPayload() {
  pruneInvalidPlanNodes();
  return JSON.stringify({
    "planned-path": planWaypoints.map((p) => ({ x: p.x, y: p.y, theta: p.theta ?? 0, speed: readPlanSpeed(p.speed, 127) })),
    "planned-export-template": planExportTemplate,
    "planned-objects": planObjects.map((obj) => ({
      id: obj.id,
      name: obj.name,
      color: obj.color || null,
      latestMethod: obj.latestMethod || "",
      methods: obj.methods.map((method) => ({
        id: method.id,
        name: method.name,
        code: method.code,
      })),
    })),
    "planned-nodes": planNodes.map(serializePlanNode),
    "robot-path": rawPoses.map((p) => ({
      t: p.t ?? null,
      x: p.x, y: p.y,
      theta: p.theta ?? 0,
      l_vel: p.l_vel ?? null,
      r_vel: p.r_vel ?? null,
      speed_raw: p.speed_raw ?? 0,
    })),
    "watches": watches.map((w) => ({
      t: w.t ?? null,
      id: Number.isInteger(w.id) ? w.id : null,
      visible: w.visible !== false,
      level: w.level ?? "INFO",
      label: w.label ?? "",
      value: w.value ?? "",
    })),
    "logs": logs.map((entry) => ({
      t: entry.t ?? null,
      level: normalizeLogLevel(entry.level),
      label: entry.label ?? "",
      value: entry.message ?? entry.value ?? "",
      isSystem: entry.isSystem === true,
    })),
    "waypoints": waypoints.map((waypoint) => ({
      id: waypoint.id,
      name: waypoint.name,
      createdTime: waypoint.createdTime ?? null,
      createdEvent: waypoint.createdEvent ?? null,
      events: waypoint.events ?? [],
    })),
  });
}

async function saveSavedPathsNow() {
  if (savedPathsSaveTimer) {
    clearTimeout(savedPathsSaveTimer);
    savedPathsSaveTimer = null;
  }
  try {
    const payload = buildSavedPathsPayload();
    await invoke("write_saved_paths", { contents: payload });
  } catch (e) {
    console.warn("Failed to save paths:", e);
  }
}

function updatePlanSelectionPanel() {
  if (!planSelXEl || !planSelYEl || !planSelThetaEl || !planSelSpeedEl || !planSelIndexEl) return;
  const active = document.activeElement;
  if (planSelected < 0 || planSelected >= planWaypoints.length) {
    planSelIndexEl.textContent = "—";
    planSelXEl.value = "";
    planSelYEl.value = "";
    planSelThetaEl.value = "";
    planSelSpeedEl.value = "";
    planSelXEl.disabled = true;
    planSelYEl.disabled = true;
    planSelThetaEl.disabled = true;
    planSelSpeedEl.disabled = true;
    return;
  }
  const p = planWaypoints[planSelected];
  planSelIndexEl.textContent = `#${planSelected + 1}`;
  planSelXEl.disabled = false;
  planSelYEl.disabled = false;
  planSelThetaEl.disabled = false;
  planSelSpeedEl.disabled = false;
  if (active === planSelXEl || active === planSelYEl || active === planSelThetaEl || active === planSelSpeedEl) {
    return;
  }
  const xVal = String(fmtNum(p.x, 2));
  const yVal = String(fmtNum(p.y, 2));
  const tVal = String(fmtNum(planThetaDegAt(planSelected) ?? 0, 1));
  const sVal = String(fmtNum(readPlanSpeed(p.speed, 127), 0));
  planSelXEl.value = xVal;
  planSelYEl.value = yVal;
  planSelThetaEl.value = tVal;
  planSelSpeedEl.value = sVal;
  planSelXEl.dataset.lastValid = xVal;
  planSelYEl.dataset.lastValid = yVal;
  planSelThetaEl.dataset.lastValid = tVal;
  planSelSpeedEl.dataset.lastValid = sVal;
}

function planHitTest(mx, my) {
  let best = { idx: -1, dist2: Infinity };
  for (let i = 0; i < planWaypoints.length; i++) {
    const p = planWaypoints[i];
    const sp = worldToScreen(p.x, p.y);
    const dx = sp.x - mx;
    const dy = sp.y - my;
    const d2 = dx * dx + dy * dy;
    if (d2 < best.dist2) best = { idx: i, dist2: d2 };
  }
  const HIT_PX = 12;
  return (best.idx >= 0 && best.dist2 <= HIT_PX * HIT_PX) ? best.idx : -1;
}

function planThetaHandlePos(i) {
  const p = planWaypoints[i];
  if (!p) return null;
  const sp = worldToScreen(p.x, p.y);
  const theta = fieldHeadingToScreenDeg(planThetaDegAt(i)) * Math.PI / 180;
  const baseR = getAppMode() !== "planning" ? PLAN_OVERLAY_POINT_R : PLAN_POINT_R;
  const r = getAppMode() === "viewing"
    ? Math.min(baseR, PLAN_MARKER_MAX_IN_VIEWING * scale)
    : Math.min(baseR, PLAN_MARKER_MAX_IN * scale);
  const handleOffset = PLAN_THETA_HANDLE_OFFSET * Math.max(viewZoom, CANVAS_ZOOM_MIN);
  const dist = r + handleOffset;
  return {
    x: sp.x + Math.sin(theta) * dist,
    y: sp.y - Math.cos(theta) * dist,
  };
}

function planThetaHandleHit(mx, my) {
  for (const i of planSelectedSet) {
    const hp = planThetaHandlePos(i);
    if (!hp) continue;
    const dx = hp.x - mx;
    const dy = hp.y - my;
    if (dx * dx + dy * dy <= PLAN_THETA_HANDLE_R * PLAN_THETA_HANDLE_R) return i;
  }
  return -1;
}

function updatePlanThetaFromPointer(idx, mx, my) {
  const p = planWaypoints[idx];
  if (!p) return;
  const sp = worldToScreen(p.x, p.y);
  const dx = mx - sp.x;
  const dy = my - sp.y;
  if (dx === 0 && dy === 0) return;
  const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
  const thetaPlan = normalizeDeg(angle - fieldRotationDeg);
  if (planThetaDragBase && planThetaDragBase.length) {
    const delta = normalizeDeg(thetaPlan - planThetaDragStart);
    for (const entry of planThetaDragBase) {
      const next = normalizeDeg(entry.theta + delta);
      planWaypoints[entry.i].theta = planThetaDisplayToRaw(applyPlanThetaSnapDeg(next));
    }
  } else {
    p.theta = planThetaDisplayToRaw(applyPlanThetaSnapDeg(thetaPlan));
  }
  renderPlanList();
  updatePlanSelectionPanel();
  requestDrawAll();
}

function isInField(w) {
  if (!w || typeof w.x !== "number" || typeof w.y !== "number") return false;
  const sp = worldToScreen(w.x, w.y);
  if (!Number.isFinite(sp.x) || !Number.isFinite(sp.y)) return false;
  const rect = canvas.getBoundingClientRect();
  return sp.x >= 0 && sp.x <= rect.width && sp.y >= 0 && sp.y <= rect.height;
}

function isPointInFieldBounds(point) {
  if (!point || typeof point.x !== "number" || typeof point.x !== "number") return false;
  return (
    point.x >= FIELD_BOUNDS_IN.minX &&
    point.x <= FIELD_BOUNDS_IN.maxX &&
    point.y >= FIELD_BOUNDS_IN.minY &&
    point.y <= FIELD_BOUNDS_IN.maxY
  );
}

function drawPlanningOverlay(force = false) {
  if (!force && getAppMode() !== "planning") return;
  if (getAppMode() !== "planning" && !planOverlayVisible) return;
  if (!planWaypoints.length) return;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(120,180,255,0.7)";
  ctx.fillStyle = "rgba(120,180,255,0.9)";

  // lines
  ctx.beginPath();
  for (let i = 0; i < planWaypoints.length; i++) {
    const p = planWaypoints[i];
    const sp = worldToScreen(p.x, p.y);
    if (i === 0) ctx.moveTo(sp.x, sp.y);
    else ctx.lineTo(sp.x, sp.y);
  }
  ctx.stroke();

  if (getAppMode() === "planning" || (getAppMode() !== "planning" && planOverlayVisible)) {
    const markers = buildFieldPlanNodeMarkers();
    for (const marker of markers) {
      const sp = worldToScreen(marker.x, marker.y);
      const startScreen = worldToScreen(marker.x - marker.tx, marker.y - marker.ty);
      const endScreen = worldToScreen(marker.x + marker.tx, marker.y + marker.ty);
      const segAngle = Math.atan2(endScreen.y - startScreen.y, endScreen.x - startScreen.x);
      const normalAngle = segAngle + Math.PI / 2;
      const longLenRaw = Math.max(8, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_MARKER_LONG, PLAN_FIELD_NODE_MARKER_LONG_MAX_IN));
      const thickRaw = Math.max(3, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_MARKER_THICK, PLAN_FIELD_NODE_MARKER_THICK_MAX_IN));
      const tickLenRaw = Math.max(10, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_TICK_LEN, PLAN_FIELD_NODE_TICK_MAX_IN));
      const viewingCapPx = PLAN_FIELD_NODE_VIEWING_MAX_IN * scale;
      const longLen = getAppMode() === "planning" ? longLenRaw : Math.min(viewingCapPx, longLenRaw);
      const thick = getAppMode() === "planning" ? thickRaw : Math.min(viewingCapPx, thickRaw);
      const tickLen = getAppMode() === "planning" ? tickLenRaw : Math.min(viewingCapPx, tickLenRaw);
      const color = marker.object.color || getDefaultPlanObjectColor();
      const isSelected = planSelectedNodeId === marker.node.id;
      const isHover = planFieldHoverNodeId === marker.node.id;
      const strokeColor = isSelected || isHover ? "rgba(255,255,255,0.98)" : "rgba(15,25,35,0.65)";
      const borderPad = PLAN_FIELD_NODE_BORDER_PX * Math.max(viewingFieldMarkerStyleScale(), 0.85);

      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(normalAngle);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2.5 : 2;
      ctx.beginPath();
      ctx.moveTo(-tickLen / 2, 0);
      ctx.lineTo(tickLen / 2, 0);
      ctx.stroke();

      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.roundRect(
        -(longLen + borderPad * 2) / 2,
        -(thick + borderPad * 2) / 2,
        longLen + borderPad * 2,
        thick + borderPad * 2,
        Math.max(2, (thick + borderPad * 2) / 2),
      );
      ctx.fill();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(-longLen / 2, -thick / 2, longLen, thick, Math.max(2, thick / 2));
      ctx.fill();
      ctx.restore();
    }
  }

  // points
  for (let i = 0; i < planWaypoints.length; i++) {
    const p = planWaypoints[i];
    const sp = worldToScreen(p.x, p.y);
    const isSel = planSelectedSet.has(i);
    const baseR = (getAppMode() !== "planning") ? PLAN_OVERLAY_POINT_R : PLAN_POINT_R;
    
    let r = 0;
    if (getAppMode() === "viewing") r = Math.min(baseR, PLAN_MARKER_MAX_IN_VIEWING * scale);
    else r = Math.min(baseR, PLAN_MARKER_MAX_IN * scale);

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.fillStyle = (i === planSelected) ? "rgba(180,220,255,1)" : (isSel ? "rgba(150,200,255,0.95)" : "rgba(120,180,255,0.9)");
    ctx.fill();
    ctx.strokeStyle = "rgba(15,25,35,0.8)";
    ctx.stroke();

    // heading line (black) from center to edge
    const theta = fieldHeadingToScreenDeg(planThetaDegAt(i)) * Math.PI / 180;
    const len = r;
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(theta);
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len);
    ctx.stroke();
    ctx.restore();

    if (isSel) {
      if (getAppMode() === "viewing") var handleR = Math.min(PLAN_THETA_HANDLE_R, PLAN_MARKER_MAX_IN_VIEWING * scale);
      else var handleR = Math.min(PLAN_THETA_HANDLE_R, PLAN_MARKER_MAX_IN * scale);

      const handleOffset = PLAN_THETA_HANDLE_OFFSET * Math.max(viewZoom, CANVAS_ZOOM_MIN);
      const dist = r + handleOffset;
      const hx = sp.x + Math.sin(theta) * dist;
      const hy = sp.y - Math.cos(theta) * dist;
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, handleR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(90,160,255,1)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.stroke();
      ctx.restore();
    }
  }

  if (planSelecting && planSelectRect) {
    const x0 = Math.min(planSelectRect.x0, planSelectRect.x1);
    const x1 = Math.max(planSelectRect.x0, planSelectRect.x1);
    const y0 = Math.min(planSelectRect.y0, planSelectRect.y1);
    const y1 = Math.max(planSelectRect.y0, planSelectRect.y1);
    ctx.strokeStyle = "rgba(140,200,255,0.8)";
    ctx.fillStyle = "rgba(140,200,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function setMode(mode) {
  modeController.setMode(mode === "planning" ? "planning" : "viewing");
}


// offsets: entered in selected units, stored as inches for rendering
const offsetsIn = { x: 0, y: 0, theta: 0 };
let unitsToInFactor = 1;
let currentUnits = "in";

// -------- utilities --------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function normalizeDeg(d) { let x = d % MAX_OFFSET_THETA; if (x < 0) x += MAX_OFFSET_THETA; return x; }
function angLerpDeg(a, b, t) {
  a = normalizeDeg(a); b = normalizeDeg(b);
  let diff = (b - a + 540) % 360 - 180;
  return normalizeDeg(a + diff * t);
}

function formatNumberString(value, decimals = 2, invalidValue = "—") {
  if (value === null || value === "" || typeof value === "boolean" || isNaN(value)) {
    return invalidValue;
  }

  const num = Number(value);
  if (!Number.isFinite(num)) return invalidValue;

  const places = Math.max(0, Math.trunc(decimals) || 0);
  const factor = [1, 10, 100, 1000, 10000][places] ?? Math.pow(10, places);

  // This handles the binary "rounding toward zero" bug
  let rounded = Math.round((Math.abs(num) + Number.EPSILON) * factor) / factor * Math.sign(num);

  if (rounded === 0 && (1 / rounded) === -Infinity) {
    rounded = 0;
  }

  return String(rounded);
}

function formatFixedNumberString(value, decimals = 2, invalidValue = "—") {
  if (value === null || value === "" || typeof value === "boolean" || isNaN(value)) {
    return invalidValue;
  }

  const num = Number(value);
  if (!Number.isFinite(num)) return invalidValue;

  const places = Math.max(0, Math.trunc(decimals) || 0);
  const factor = [1, 10, 100, 1000, 10000][places] ?? Math.pow(10, places);

  let rounded = Math.round((Math.abs(num) + Number.EPSILON) * factor) / factor * Math.sign(num);
  if (rounded === 0 && (1 / rounded) === -Infinity) {
    rounded = 0;
  }

  return rounded.toFixed(places);
}

function fmtNum(v, d = 2) { return formatNumberString(v, d); }
function formatTemplateNumber(value, decimals = 3) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  const rounded = Number(formatNumberString(num, decimals));
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

function setStatus(msg, log = true) {
  const fullText = String(msg ?? "");
  statusEl.dataset.fullText = fullText;
  scheduleTopBarStatusLayout();
  if (log) console.log(`Status: ${msg}`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function toNumMaybe(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (isFinite(n)) return n;
  }
  return null;
}

function sanitizeOffsetInputs() {
  const xRaw = toNumMaybe(offXEl?.value ?? settingsOffX?.value);
  if (xRaw != null) {
    const clamped = clamp(xRaw, FIELD_BOUNDS_IN.minX, FIELD_BOUNDS_IN.maxX);
    if (offXEl) offXEl.value = String(clamped);
    if (settingsOffX) settingsOffX.value = String(clamped);
  }
  const yRaw = toNumMaybe(offYEl?.value ?? settingsOffY?.value);
  if (yRaw != null) {
    const clamped = clamp(yRaw, FIELD_BOUNDS_IN.minY, FIELD_BOUNDS_IN.maxY);
    if (offYEl) offYEl.value = String(clamped);
    if (settingsOffY) settingsOffY.value = String(clamped);
  }
  const tRaw = toNumMaybe(offThetaEl?.value ?? settingsOffTheta?.value);
  if (tRaw != null) {
    const normalized = normalizeDeg(tRaw);
    if (offThetaEl) offThetaEl.value = String(normalized);
    if (settingsOffTheta) settingsOffTheta.value = String(normalized);
  }
}

function levelStyle(levelRaw) {
  const L = String(levelRaw || "INFO").toUpperCase();
  if (L.includes("FATAL")) return { name: "FATAL", fill: "rgba(164, 0, 0, 1)", text: "#081018" };
  if (L.includes("ERROR")) return { name: "ERROR", fill: "rgb(255,77,77)", text: "#081018" };
  if (L.includes("WARN")) return { name: "WARN", fill: "rgb(255,212,77)", text: "#081018" };
  if (L.includes("DEBUG")) return { name: "DEBUG", fill: "rgba(78, 246, 255, 1)", text: "#081018" };
  return { name: "INFO", fill: "rgb(77,255,136)", text: "#081018" };
}

function levelFillWithAlpha(levelRaw, alpha) {
  const L = String(levelRaw || "INFO").toUpperCase();
  if (L.includes("FATAL")) return `rgba(164, 0, 0, ${alpha})`;
  if (L.includes("ERROR")) return `rgba(255, 77, 77, ${alpha})`;
  if (L.includes("WARN")) return `rgba(255, 212, 77, ${alpha})`;
  if (L.includes("DEBUG")) return `rgba(78, 246, 255, ${alpha})`;
  return `rgba(77, 255, 136, ${alpha})`;
}

function normalizeLogLevel(levelRaw) {
  const L = String(levelRaw || "INFO").trim().toUpperCase();
  if (L === "DEBUG" || L === "INFO" || L === "WARN" || L === "ERROR" || L === "FATAL") return L;
  return "INFO";
}

let pinnedWatchPanelCount = 0;
let pinnedWatchDragTarget = null;
let pinnedWatchDragStart = { x: 0, y: 0 };

function findLatestWatchById(watchId) {
  if (watchId == null || !Array.isArray(watches) || !watches.length) return null;
  const normalizedId = String(watchId);
  for (let i = watches.length - 1; i >= 0; i -= 1) {
    const watch = watches[i];
    const candidateId = watch?.id ?? watch?.watchId;
    if (candidateId != null && String(candidateId) === normalizedId) return watch;
  }
  return null;
}

function findWatchByIdAtOrBeforeTime(watchId, tMs) {
  if (watchId == null || tMs == null || !Array.isArray(watches) || !watches.length) return null;
  const normalizedId = String(watchId);
  for (let i = watches.length - 1; i >= 0; i -= 1) {
    const watch = watches[i];
    const candidateId = watch?.id ?? watch?.watchId;
    if (candidateId == null || String(candidateId) !== normalizedId) continue;
    if ((watch.t ?? Infinity) <= tMs) return watch;
  }
  return null;
}

function getPinnedWatchReferenceTimeMs() {
  if (playing) return playTimeMs ?? null;
  if (hoverTimelineTime != null) return hoverTimelineTime;
  if (!playing && trackHover?.pose?.t != null) return trackHover.pose.t;
  if (!playing && trackLockActive && trackLockPose?.t != null) return trackLockPose.t;
  if (!rawPoses.length) return null;
  const idx = clamp(selectedIndex, 0, Math.max(0, rawPoses.length - 1));
  return rawPoses[idx]?.t ?? null;
}

function applyPinnedWatchLevel(el, levelRaw) {
  if (!el) return;
  const level = normalizeLogLevel(levelRaw);
  const st = levelStyle(level);
  el.style.background = st.fill;
  el.style.color = st.text;
  el.style.borderColor = "rgba(255, 255, 255, 0.10)";
}

function getPinnedWatchPanelById(watchId) {
  if (!pinnedWatchHost || watchId == null) return null;
  return pinnedWatchHost.querySelector(`.pinnedWatchPanel[data-watch-id="${CSS.escape(String(watchId))}"]`);
}

function closePinnedWatchPanel(panel) {
  if (!panel) return;
  if (pinnedWatchDragTarget === panel) pinnedWatchDragTarget = null;
  panel.remove();
}

function updatePinnedWatchPanel(panel, watchId) {
  if (!panel) return;
  const tMs = getPinnedWatchReferenceTimeMs();
  const latest = findWatchByIdAtOrBeforeTime(watchId, tMs);
  const nameEl = panel.querySelector(".pinnedWatchName");
  const valueEl = panel.querySelector(".pinnedWatchValue");
  const latestOverall = findLatestWatchById(watchId);
  const label = latest?.label || latestOverall?.label || (watchId == null ? "No watch selected" : `Watch ${watchId}`);
  if (nameEl) nameEl.textContent = label;
  if (valueEl) valueEl.textContent = latest?.value != null ? String(latest.value) : "—";
  applyPinnedWatchLevel(valueEl, latest?.level ?? "INFO");
}

function refreshPinnedWatchPanels() {
  if (!pinnedWatchHost) return;
  const panels = pinnedWatchHost.querySelectorAll(".pinnedWatchPanel");
  for (const panel of panels) {
    const watchId = panel.dataset.watchId || null;
    updatePinnedWatchPanel(panel, watchId);
  }
}

function toggleFloatingWatch(watchId) {
  if (watchId == null) return openFloatingWatch(null);
  const existing = getPinnedWatchPanelById(watchId);
  if (existing) {
    closePinnedWatchPanel(existing);
    return null;
  }
  return openFloatingWatch(watchId);
}

function openFloatingWatch(watchId) {
  if (!pinnedWatchHost || !pinnedWatchTemplate) return null;

  const root = pinnedWatchTemplate.content.firstElementChild?.cloneNode(true);
  if (!root) return null;

  const headerEl = root.querySelector(".pinnedWatchHeader");
  const closeEl = root.querySelector(".pinnedWatchClose");

  root.dataset.watchId = watchId == null ? "" : String(watchId);
  root.style.top = `${128 + pinnedWatchPanelCount * 26}px`;
  root.style.right = `${16 + pinnedWatchPanelCount * 18}px`;
  pinnedWatchPanelCount += 1;

  updatePinnedWatchPanel(root, watchId);

  headerEl?.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0) return;
    pinnedWatchDragTarget = root;
    pinnedWatchDragStart = {
      x: ev.clientX - root.offsetLeft,
      y: ev.clientY - root.offsetTop,
    };
    root.style.left = `${root.offsetLeft}px`;
    root.style.top = `${root.offsetTop}px`;
    root.style.right = "auto";
    ev.preventDefault();
  });

  closeEl?.addEventListener("click", () => {
    closePinnedWatchPanel(root);
  });

  pinnedWatchHost.appendChild(root);
  return root;
}

function levelSortRank(levelRaw) {
  const L = normalizeLogLevel(levelRaw);
  if (L === "FATAL") return 4;
  if (L === "ERROR") return 3;
  if (L === "WARN") return 2;
  if (L === "INFO") return 1;
  return 0;
}

function robotDimsInches() {
  const wVal = robotWEl ? robotWEl.value : (settingsRobotW ? settingsRobotW.value : 12);
  const hVal = robotHEl ? robotHEl.value : (settingsRobotH ? settingsRobotH.value : 12);
  const w = Number(wVal || 12);
  const h = Number(hVal || 12);
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

// -------- units/offsets --------
function setUnitsFactorFromSelect(value) {
  const v = String(value || "in");
  if (v === "cm") unitsToInFactor = 1 / 2.54;
  else if (v === "ft") unitsToInFactor = 12;
  else if (v === "tiles") unitsToInFactor = 24;
  else unitsToInFactor = 1;
  currentUnits = v;
}

function inferUnitsFromMeta(metaUnits) {
  const u = String(metaUnits || "").toLowerCase().trim();
  if (!u) return "in";
  if (u.includes("tile")) return "tiles";
  if (u.includes("cm") || u.includes("cent")) return "cm";
  if (u === "ft" || u.includes("foot") || u.includes("feet")) return "ft";
  if (u.includes("in")) return "in";
  return "in";
}

function updateOffsetsFromInputs() {
  sanitizeOffsetInputs();
  const ux = Number((offXEl ? offXEl.value : settingsOffX ? settingsOffX.value : 0) || 0);
  const uy = Number((offYEl ? offYEl.value : settingsOffY ? settingsOffY.value : 0) || 0);
  const ut = Number((offThetaEl ? offThetaEl.value : settingsOffTheta ? settingsOffTheta.value : 0) || 0);

  offsetsIn.x = ux * unitsToInFactor;
  offsetsIn.y = uy * unitsToInFactor;
  offsetsIn.theta = ut;

  recomputeWatchMarkers();
  draw();
  updatePoseReadout();
  drawTimeline();
}

// -------- speed normalization (single source of truth) --------
function getMinMaxSpeed() {
  const minVal = minSpeedEl ? minSpeedEl.value : (settingsMinSpeed ? settingsMinSpeed.value : 0);
  const maxVal = maxSpeedEl ? maxSpeedEl.value : (settingsMaxSpeed ? settingsMaxSpeed.value : 127);
  let minV = Number(minVal);
  let maxV = Number(maxVal);
  minV = (isFinite(minV) ? minV : 0);
  maxV = (isFinite(maxV) ? maxV : 127);
  if (minV > maxV) { const tmp = minV; minV = maxV; maxV = tmp; }
  return { minV, maxV };
}

function computeSpeedNormRange(startIndex = 0) {
  const { minV, maxV } = getMinMaxSpeed();
  const denom = (maxV - minV) || 1;
  for (let i = Math.max(0, startIndex); i < rawPoses.length; i += 1) {
    const p = rawPoses[i];
    const s = Math.abs(p.speed_raw ?? 0);
    rawPoses.setSpeedNorm(i, clamp((s - minV) / denom, 0, 1));
  }
}

function normFromSpeedRaw(s) {
  const { minV, maxV } = getMinMaxSpeed();
  const denom = (maxV - minV) || 1;
  const v = Math.abs(s ?? 0);
  return clamp((v - minV) / denom, 0, 1);
}

function speedFromNorm(n) {
  if (n == null || !isFinite(n)) return null;
  // Display normalized speed on a 0-100 scale so min/max changes shift the value.
  return clamp(n, 0, 1) * 100;
}

function heatColorFromNorm(n) {
  const t0 = clamp(n, 0, 1);

  // If vel is ±127 scaled and n was made from it, then:
  // vel<=5 corresponds to n <= 5/127.
  const lowCut = 5 / 127;

  // Force "dark red" for very low speeds
  if (t0 <= lowCut) {
    // dark red, slightly transparent
    return `rgba(120, 10, 10, 0.95)`;
  }

  // 2) Remap (lowCut..1) -> (0..1) so everything above 5 has visible range
  const t = (t0 - lowCut) / (1 - lowCut); // 0..1
  const u = 1 - t; // u=1 red, u=0 green

  let r, g, b;

  if (u <= 0.15) {
    const a = u / 0.33;
    r = 40 + a * (255 - 40);
    g = 220;
    b = 80;
  } else if (u <= 0.66) {
    const a = (u - 0.33) / 0.33;
    r = 255;
    g = 220 - a * 140;
    b = 80 - a * 40;
  } else {
    const a = (u - 0.66) / 0.34;
    r = 255;
    g = 80 - a * 70;
    b = 40 - a * 30;
  }

  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.88)`;
}

// -------- pose conversion --------
function poseToInches(p) {
  if (!p) {
    return {
      t: null,
      x: offsetsIn.x,
      y: offsetsIn.y,
      theta: normalizeDeg(offsetsIn.theta),
      l_vel: null,
      r_vel: null,
      speed_raw: null,
      speed_norm: 0,
    };
  }
  return {
    t: (typeof p.t === "number") ? p.t : null,
    x: (p.x ?? 0) * unitsToInFactor + offsetsIn.x,
    y: (p.y ?? 0) * unitsToInFactor + offsetsIn.y,
    theta: normalizeDeg((p.theta ?? 0) + offsetsIn.theta),
    l_vel: (typeof p.l_vel === "number") ? p.l_vel : null,
    r_vel: (typeof p.r_vel === "number") ? p.r_vel : null,
    speed_raw: (typeof p.speed_raw === "number") ? p.speed_raw : null,
    speed_norm: (typeof p.speed_norm === "number") ? p.speed_norm : 0,
  };
}

function getPosesInches() { return rawPoses.map(poseToInches); }

function refreshBridgeOrigin() {
  const next = window.__BRIDGE_ORIGIN__ ?? null;
  if (next && next !== ORIGIN) {
    ORIGIN = next;
    WS_ORIGIN = ORIGIN ? ORIGIN.replace(/^http/, "ws") : null;
  }
  return ORIGIN;
}

async function ensureBridgeOriginReady() {
  if (refreshBridgeOrigin()) return true;
  try {
    const origin = await invoke("get_bridge_origin");
    if (origin) {
      ORIGIN = origin;
      WS_ORIGIN = ORIGIN.replace(/^http/, "ws");
      return true;
    }
  } catch (e) { }
  return !!refreshBridgeOrigin();
}

async function ensureBackendReady() {
  if (!(await ensureBridgeOriginReady())) return false;
  const origin = ORIGIN;
  const now = Date.now();
  if (backendReady && now - backendReadyAt < 2000) return true;
  if (backendReadyProbeInFlight) return backendReadyProbeInFlight;
  if (now - backendReadyLastCheckAt < 1000) return false;
  backendReadyLastCheckAt = now;
  backendReadyProbeInFlight = (async () => {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`${origin}/api/status`, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      const json = await res.json().catch(() => null);
      if (!json) return false;
      backendReady = true;
      backendReadyAt = now;
      return true;
    } catch (e) {
      return false;
    } finally {
      backendReadyProbeInFlight = null;
    }
  })();
  return backendReadyProbeInFlight;
}

async function waitForBackendReady(maxWaitMs = 8000, pollMs = 200) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await ensureBackendReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

function formatLogArgs(args) {
  return args.map((a) => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(" ");
}

async function logToBackend(level, message, tag) {
  const origin = refreshBridgeOrigin();
  if (!origin) return;
  // Avoid status-probe storms from console logging paths.
  if (!backendReady) return;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 800);
    await fetch(`${origin}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, message, tag }),
      signal: controller.signal,
    });
    clearTimeout(t);
  } catch (e) { }
}

// Mirror key console errors into the backend log for shipped apps
const _consoleError = console.error.bind(console);
console.error = (...args) => {
  _consoleError(...args);
  void logToBackend("ERROR", formatLogArgs(args), "console");
};
const _consoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  _consoleWarn(...args);
  void logToBackend("WARN", formatLogArgs(args), "console");
};
window.addEventListener("error", (e) => {
  const msg = `${e.message || "Script error"} @ ${e.filename || "unknown"}:${e.lineno || 0}:${e.colno || 0}`;
  void logToBackend("ERROR", msg, "window");
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason?.stack || e.reason?.message || String(e.reason);
  void logToBackend("ERROR", `Unhandled rejection: ${reason}`, "window");
});

// -------- canvas sizing/transform --------
function computeTransform() {
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const pad = bounds.pad;
  const worldW = (bounds.maxX - bounds.minX) || 1;
  const worldH = (bounds.maxY - bounds.minY) || 1;

  baseScale = Math.min((w - pad * 2) / worldW, (h - pad * 2) / worldH);

  const side = squareMode ? Math.min(w, h) : null;

  // these center the square viewport
  const vx = squareMode ? (w - side) / 2 : 0;
  const vy = squareMode ? (h - side) / 2 : 0;

  baseOffsetXpx = vx + pad - bounds.minX * baseScale;
  baseOffsetYpx = vy + pad + bounds.maxY * baseScale;

  scale = baseScale * viewZoom;
  offsetXpx = baseOffsetXpx * viewZoom + viewPanXpx;
  offsetYpx = baseOffsetYpx * viewZoom + viewPanYpx;
}

function clampViewPanToVisibleMargin(marginPx = 15) {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  const corners = [
    worldToScreen(bounds.minX, bounds.minY),
    worldToScreen(bounds.minX, bounds.maxY),
    worldToScreen(bounds.maxX, bounds.minY),
    worldToScreen(bounds.maxX, bounds.maxY),
  ];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  let dx = 0, dy = 0;
  if (maxX < marginPx) dx = marginPx - maxX;
  else if (minX > w - marginPx) dx = (w - marginPx) - minX;
  if (maxY < marginPx) dy = marginPx - maxY;
  else if (minY > h - marginPx) dy = (h - marginPx) - minY;
  if (dx !== 0 || dy !== 0) {
    viewPanXpx += dx;
    viewPanYpx += dy;
    computeTransform();
  }
}

function normalizeFieldRotation(deg) {
  const norm = ((deg % 360) + 360) % 360;
  if (norm === 90 || norm === 180 || norm === 270) return norm;
  return 0;
}

function setFieldRotationDeg(deg) {
  fieldRotationDeg = normalizeFieldRotation(deg);
  fieldRotationRad = fieldRotationDeg * Math.PI / 180;
  fieldRotationCos = Math.cos(fieldRotationRad);
  fieldRotationSin = Math.sin(fieldRotationRad);
  if (settingsFieldRotation) settingsFieldRotation.value = String(fieldRotationDeg);
  requestDrawAll();
}

function canvasViewportRect() {
  const rect = canvas.getBoundingClientRect();
  if (!squareMode) {
    return { x: 0, y: 0, width: rect.width || 1, height: rect.height || 1 };
  }
  const side = Math.min(rect.width || 1, rect.height || 1);
  return {
    x: ((rect.width || 1) - side) / 2,
    y: ((rect.height || 1) - side) / 2,
    width: side,
    height: side,
  };
}

function canvasViewportCenter() {
  const rect = canvasViewportRect();
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function rotateScreenPoint(x, y, angleRad) {
  if (!angleRad) return { x, y };
  const center = canvasViewportCenter();
  const dx = x - center.x;
  const dy = y - center.y;
  return {
    x: center.x + dx * Math.cos(angleRad) - dy * Math.sin(angleRad),
    y: center.y + dx * Math.sin(angleRad) + dy * Math.cos(angleRad),
  };
}

function rotateScreenDelta(dx, dy, angleRad) {
  if (!angleRad) return { x: dx, y: dy };
  return {
    x: dx * Math.cos(angleRad) - dy * Math.sin(angleRad),
    y: dx * Math.sin(angleRad) + dy * Math.cos(angleRad),
  };
}

function worldToScreenBase(xIn, yIn) {
  return { x: offsetXpx + xIn * scale, y: offsetYpx - yIn * scale };
}

function worldToScreen(xIn, yIn) {
  const base = worldToScreenBase(xIn, yIn);
  return rotateScreenPoint(base.x, base.y, fieldRotationRad);
}

function screenToWorld(xPx, yPx) {
  const base = rotateScreenPoint(xPx, yPx, -fieldRotationRad);
  const xR = (base.x - offsetXpx) / (scale || 1);
  const yR = (offsetYpx - base.y) / (scale || 1);
  return {
    x: xR,
    y: yR,
  };
}

function setCursorPills(text) {
  if (cursorPill) cursorPill.textContent = text;
  if (planCursorPill) planCursorPill.textContent = text;
}

function updateCursorPillsFromClient(clientX, clientY) {
  if (!cursorPill && !planCursorPill) return;
  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  const w = screenToWorld(mx, my);
  const ux = w.x / (unitsToInFactor || 1);
  const uy = w.y / (unitsToInFactor || 1);
  setCursorPills(`Cursor: X ${fmtNum(ux, 2)}  Y ${fmtNum(uy, 2)} ${currentUnits}`);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeTransform();
  clampViewPanToVisibleMargin();
  draw();
}

function layoutTimelineCanvas() {
  if (!timelineCanvas || !timelineBar) return;
  if (timelineBar.classList.contains("isCollapsed")) return;

  // Ensure we never clip the bottom: compute available height.
  const barH = timelineBar.getBoundingClientRect().height;
  const topH = timelineTop ? timelineTop.getBoundingClientRect().height : 0;
  const padding = 10 + 10; // rough internal padding
  const avail = Math.max(144, barH - topH - padding);
  timelineCanvas.style.height = `${avail}px`;
}

function resizeTimeline() {
  layoutTimelineCanvas();
  const dpr = window.devicePixelRatio || 1;
  const rect = timelineCanvas.getBoundingClientRect();
  timelineCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
  timelineCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawTimeline();
}

function syncPlanningTimelineCanvasSize() {
  if (!planningTimelineCanvas || !pctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = planningTimelineCanvas.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
  const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
  if (planningTimelineCanvas.width !== nextWidth || planningTimelineCanvas.height !== nextHeight) {
    planningTimelineCanvas.width = nextWidth;
    planningTimelineCanvas.height = nextHeight;
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function resizePlanningTimeline() {
  if (!planningTimelineCanvas || !pctx) return;
  renderPlanningEventTimeline();
  syncPlanningTimelineCanvasSize();
  drawPlanningTimeline();
}

// -------- field images --------
function loadFieldOptions() {
  if (!fieldSelect) {
    console.warn("fieldSelect element not found");
    return;
  }
  const previousValue = fieldSelect.value;
  fieldSelect.innerHTML = "";
  const visibleFields = getVisibleFieldImages();
  if (!visibleFields.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No fields available";
    opt.disabled = true;
    fieldSelect.appendChild(opt);
    fieldSelect.value = "";
    return;
  }
  for (const f of visibleFields) {
    const opt = document.createElement("option");
    opt.value = f.key;
    opt.textContent = f.label;
    fieldSelect.appendChild(opt);
  }
  fieldSelect.value = getValidFieldKey(previousValue);
}

async function resolveFieldImageSrc(fieldKey) {
  if (!isTauriRuntime) return fieldKey;
  const normalized = String(fieldKey || "").replace(/^\.\//, "");
  const candidates = [
    `_up_/src/${normalized}`,
    `src/${normalized}`,
    normalized,
  ];
  for (const candidate of candidates) {
    try {
      const resolved = await resolveResource(candidate);
      if (resolved) return resolved;
    } catch (_) {
      // Try the next possible packaged location.
    }
  }
  return fieldKey;
}

async function loadFieldImage(filename) {
  const nextField = getValidFieldKey(filename);
  if (!nextField) {
    fieldImg = null;
    draw();
    setStatus("No field image is available for the selected competition.");
    return;
  }
  let imgSrc = nextField;
  if (isTauriRuntime) {
    try {
      const resolvedPath = await resolveFieldImageSrc(nextField);
      if (resolvedPath && resolvedPath !== nextField && !resolvedPath.startsWith("asset:") && !resolvedPath.startsWith("http")) {
        imgSrc = await invoke("read_image_data", { path: resolvedPath });
      } else {
        imgSrc = resolvedPath;
      }
    } catch (_) {
      imgSrc = nextField;
    }
  }
  const img = new Image();
  img.onload = () => { fieldImg = img; draw(); };
  img.onerror = () => {
    fieldImg = null;
    draw();
    setStatus(`Could not load field image: ${nextField}`);
  };
  img.src = imgSrc;
  await viewingTelemetry.fieldImageLoaded({
    field: nextField,
  });
}

function loadRobotImage() {
  if (robotImgLoadTried) return;
  robotImgLoadTried = true;

  const img = new Image();
  img.onload = () => {
    robotImg = img;
    robotImgOk = true;
    if (robotImgControlsEl) robotImgControlsEl.hidden = false;
    if (settingsRobotImgControls && robotImageEnabled) settingsRobotImgControls.hidden = false;
    draw();
  };
  img.onerror = () => {
    robotImg = null;
    robotImgOk = false;
    if (robotImgControlsEl) robotImgControlsEl.hidden = true;
    if (settingsRobotImgControls) settingsRobotImgControls.hidden = true;
    draw();
  };
}

function drawFirstField() {
  loadFieldOptions();

  if (!fieldSelect) {
    console.warn("fieldSelect not available for drawFirstField");
    return;
  }

  const nextField = getValidFieldKey(fieldSelect.value || DEFAULT_FIELD_KEY);
  fieldSelect.value = nextField;
  if (nextField) loadFieldImage(nextField);
}

// -------- time helpers --------
function timeRange() {
  const t0 = rawPoses[0]?.t;
  const tN = rawPoses[rawPoses.length - 1]?.t;
  if (typeof t0 !== "number" || typeof tN !== "number" || tN <= t0) return null;
  return { t0, tN };
}

function findFloorIndexByTime(tMs) {
  const poses = rawPoses;
  if (!poses.length) return -1;
  let lo = 0, hi = poses.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tm = poses[mid].t ?? -Infinity;
    if (tm <= tMs) lo = mid + 1;
    else hi = mid - 1;
  }
  return clamp(hi, 0, poses.length - 1);
}

function interpolatePoseAtTime(tMs) {
  if (!rawPoses.length) return null;
  const i = findFloorIndexByTime(tMs);
  const p0 = rawPoses[i];
  if (i >= rawPoses.length - 1) return poseToInches({ ...p0, t: p0.t });

  const p1 = rawPoses[i + 1];
  const t0 = p0.t ?? tMs;
  const t1 = p1.t ?? t0;
  const denom = (t1 - t0) || 1;
  const a = clamp((tMs - t0) / denom, 0, 1);

  const x = (p0.x ?? 0) + ((p1.x ?? 0) - (p0.x ?? 0)) * a;
  const y = (p0.y ?? 0) + ((p1.y ?? 0) - (p0.y ?? 0)) * a;
  const theta = angLerpDeg(p0.theta ?? 0, p1.theta ?? 0, a);

  const l_vel = (p0.l_vel ?? 0) + ((p1.l_vel ?? 0) - (p0.l_vel ?? 0)) * a;
  const r_vel = (p0.r_vel ?? 0) + ((p1.r_vel ?? 0) - (p0.r_vel ?? 0)) * a;

  const s0 = (p0.speed_raw ?? 0), s1 = (p1.speed_raw ?? 0);
  const speed_raw = s0 + (s1 - s0) * a;
  const speed_norm = (p0.speed_norm ?? 0) + ((p1.speed_norm ?? 0) - (p0.speed_norm ?? 0)) * a;

  // feed in file units and norm; poseToInches will reapply offsets for x/y/theta
  return poseToInches({ t: tMs, x, y, theta, l_vel, r_vel, speed_raw, speed_norm });
}

function nearestIndexWithinTol(tMs, tolMs) {
  if (!rawPoses.length) return null;
  const i0 = findFloorIndexByTime(tMs);
  const cands = [i0, Math.min(i0 + 1, rawPoses.length - 1)];
  let best = null;
  for (const i of cands) {
    const tt = rawPoses[i].t;
    if (typeof tt !== "number") continue;
    const dt = Math.abs(tt - tMs);
    if (best === null || dt < best.dt) best = { idx: i, dt };
  }
  if (best && best.dt <= tolMs) return best;
  return null;
}

// -------- watches --------
function normalizeWatches(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;

  for (const w of arr) {
    if (!w || typeof w !== "object") continue;
    const tRaw = (w.t ?? w.timestamp ?? w.time ?? w.ms);
    const t = toNumMaybe(tRaw);
    if (t == null) continue;
    const idRaw = w.id ?? w.watchId;
    const idNum = Number(idRaw);
    const id = Number.isInteger(idNum) ? idNum : null;

    out.push({
      t,
      id,
      visible: w.visible !== false,
      level: w.level ?? w.lvl ?? w.severity ?? "INFO",
      label: w.label ?? w.name ?? "",
      value: (w.value ?? w.val ?? w.message ?? ""),
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function normalizeLogs(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;

  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const tRaw = entry.t ?? entry.timestamp ?? entry.time ?? entry.ms;
    const t = toNumMaybe(tRaw);
    if (t == null) continue;

    const parsed = normalizeSystemLogMessage(entry.message ?? entry.value ?? entry.val ?? "");
    const isSystem = entry.isSystem === true || parsed.isSystem;
    if (!parsed.message) continue;

    out.push({
      t,
      level: normalizeLogLevel(entry.level ?? entry.lvl ?? entry.severity ?? "INFO"),
      label: entry.label ?? "",
      value: parsed.message,
      message: parsed.message,
      isSystem,
    });
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}

function normalizeSystemLogMessage(rawMessage) {
  const text = String(rawMessage ?? "").trim();
  if (!text) return { message: "", isSystem: false };
  const prefix = "[MVLIB] ";
  if (text.startsWith(prefix)) {
    return {
      message: text.slice(prefix.length).trim(),
      isSystem: true,
    };
  }
  return { message: text, isSystem: false };
}

function normalizeWaypointType(typeRaw) {
  const T = String(typeRaw || "").trim().toUpperCase();
  if (T === "CREATED" || T === "REACHED" || T === "TIMEDOUT") return T;
  return "";
}

function parseWaypointNumber(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text.toUpperCase() === "NA") return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function parseWaypointParams(type, paramsText) {
  const text = String(paramsText ?? "").trim();
  const parts = text ? text.split(",").map((part) => part.trim()) : [];
  if (type === "CREATED") {
    if (parts.length !== 6 && parts.length !== 7) return null;
    const tarX = parseWaypointNumber(parts[0]);
    const tarY = parseWaypointNumber(parts[1]);
    const tarT = parseWaypointNumber(parts[2]);
    const timeoutMs = parseWaypointNumber(parts[3]);
    const linearTol = parseWaypointNumber(parts[4]);
    const thetaTol = parseWaypointNumber(parts[5]);
    let retriggerable = false;
    if (parts.length === 7) {
      if (parts[6] !== "0" && parts[6] !== "1") return null;
      retriggerable = parts[6] === "1";
    }
    if (tarX == null || tarY == null || linearTol == null) return null;
    return { tarX, tarY, tarT, timeoutMs, linearTol, thetaTol, retriggerable };
  }

  if (type === "REACHED") {
    if (!parts.length) return {};
    if (parts.length === 1) {
      const remainingTime = parseWaypointNumber(parts[0]);
      return remainingTime == null ? null : { remainingTime };
    }
    if (parts.length === 4) {
      const remainingTime = parseWaypointNumber(parts[3]);
      return remainingTime == null ? {} : { remainingTime };
    }
    return null;
  }

  if (type === "TIMEDOUT") {
    if (!parts.length) return {};
    if (parts.length === 4) return {};
    return null;
  }

  return null;
}

function fmtNumToString(value, decimals = 2) {
  return formatNumberString(value, decimals);
}

function fmtSecondsToString(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return null;
  return `${fmtNumToString(ms / 1000, 2)}s`;
}

function waypointTypeStyle(typeRaw) {
  const type = normalizeWaypointType(typeRaw);
  if (type === "TIMEDOUT") return { fill: "rgba(255, 120, 120, 0.18)", text: "#ffb0b0" };
  if (type === "REACHED") return { fill: "rgba(120, 220, 150, 0.18)", text: "#b6ffd0" };
  return { fill: "rgba(255,255,255,0.12)", text: "#f7fbff" };
}

function waypointEventLines(event) {
  if (!event) return [];
  const params = event.params || {};
  if (event.type === "CREATED") {
    const target = [`X: ${fmtNumToString(params.tarX)}`, `Y: ${fmtNumToString(params.tarY)}`];
    if (params.tarT != null) target.push(`θ: ${fmtNumToString(params.tarT)}`);

    const lines = [`Target: ${target.join(", ")}`];
    const tolerances = [];
    if (params.linearTol != null) tolerances.push(`Linear: ${fmtNumToString(params.linearTol)}`);
    if (params.thetaTol != null) tolerances.push(`Angular: ${fmtNumToString(params.thetaTol)}`);
    if (tolerances.length) lines.push(`Tolerances: ${tolerances.join(", ")}`);
    if (params.timeoutMs != null) lines.push(`Timeout: ${fmtSecondsToString(params.timeoutMs)}`);
    return lines;
  }

  if (event.type === "REACHED") {
    const lines = [];
    if (params.remainingTime != null) lines.push(`Time Left: ${fmtSecondsToString(params.remainingTime)}`);
    return lines;
  }

  return [];
}

function rebuildWaypointState() {
  waypointsById = new Map();
  for (const entry of waypoints) {
    if (!entry || typeof entry !== "object") continue;
    const id = Number(entry.id);
    if (!Number.isInteger(id)) continue;
    const createdEvent = entry.createdEvent && typeof entry.createdEvent === "object"
      ? entry.createdEvent
      : (Array.isArray(entry.events) ? entry.events.find((event) => event?.type === "CREATED") : null);
    if (!createdEvent?.params || createdEvent.params.tarX == null || createdEvent.params.tarY == null) continue;

    const events = Array.isArray(entry.events)
      ? entry.events
        .filter((event) => event && typeof event === "object" && typeof event.t === "number")
        .map((event) => ({
          t: event.t,
          type: normalizeWaypointType(event.type),
          id: Number.isInteger(event.id) ? event.id : id,
          name: String(event.name ?? entry.name ?? createdEvent.name ?? ""),
          params: event.params || {},
        }))
        .filter((event) => event.type)
        .sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
      : [];
    if (!events.length) continue;

    const isRetriggerable = !!createdEvent?.params?.retriggerable;
    let terminalEvent = null;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type === "TIMEDOUT" || (!isRetriggerable && event.type === "REACHED")) {
        terminalEvent = event;
        break;
      }
    }
    const latestEvent = events[events.length - 1];
    let latestActiveEvent = latestEvent;
    if (terminalEvent) {
      latestActiveEvent = createdEvent;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event.t <= terminalEvent.t) {
          latestActiveEvent = event;
          break;
        }
      }
    }

    waypointsById.set(id, {
      id,
      name: String(entry.name ?? createdEvent.name ?? ""),
      createdTime: createdEvent.t,
      createdEvent,
      target: { x: createdEvent.params.tarX, y: createdEvent.params.tarY, theta: createdEvent.params.tarT },
      retriggerable: isRetriggerable,
      events,
      active: !terminalEvent,
      terminalEvent: terminalEvent || null,
      latestEvent: latestEvent || createdEvent,
      latestActiveEvent: latestActiveEvent || createdEvent,
    });
  }
  waypoints = Array.from(waypointsById.values()).sort((a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0));
}

function normalizeWaypoints(arr) {
  waypoints = Array.isArray(arr) ? arr.slice() : [];
  rebuildWaypointState();
  return waypoints;
}

function waypointFilterValue() {
  return waypointFilter?.value || "all";
}

function waypointEventCount(arr) {
  if (!Array.isArray(arr)) return 0;
  let total = 0;
  for (const waypoint of arr) {
    if (Array.isArray(waypoint?.events)) total += waypoint.events.length;
  }
  return total;
}

function waypointFilterMatches(waypoint) {
  const filter = waypointFilterValue();
  if (filter === "all") return true;
  if (filter === "active") return !!waypoint?.active;
  return String(waypoint?.id) === filter;
}

function waypointVisibleEvents() {
  const visible = [];
  for (const waypoint of waypoints) {
    if (!waypointFilterMatches(waypoint)) continue;
    for (const event of waypoint.events) {
      visible.push({ waypoint, event });
    }
  }
  return visible.sort((a, b) => (a.event.t ?? 0) - (b.event.t ?? 0));
}

function recomputeWatchMarkers() {
  watchMarkers = [];
  for (const w of watches) {
    const t = w.t;
    const near = nearestIndexWithinTol(t, WATCH_TOL_MS);
    if (near) {
      const p = rawPoses[near.idx];
      watchMarkers.push({ watch: w, t, ok: true, dt: near.dt, pose: poseToInches(p), idx: near.idx });
    } else {
      const ip = interpolatePoseAtTime(t);
      watchMarkers.push({ watch: w, t, ok: false, dt: null, pose: ip, idx: null });
    }
  }
}

// watchMarkersByTime is used for fast "last watch hit" lookup during playback
let watchMarkersByTime = [];

function rebuildWatchMarkersByTime() {
  watchMarkersByTime = watchMarkers.slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

function lastWatchAtTime(tMs) {
  if (!watchMarkersByTime.length) return null;
  let lo = 0, hi = watchMarkersByTime.length - 1;
  if ((watchMarkersByTime[0].t ?? 0) > tMs) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const tm = watchMarkersByTime[mid].t ?? 0;
    if (tm <= tMs) lo = mid; else hi = mid - 1;
  }
  return watchMarkersByTime[lo];
}

function scrollIntoViewIfNeeded(container, el, pad = 10) {
  if (!container || !el) return;
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  // already in view
  if (r.top >= c.top + pad && r.bottom <= c.bottom - pad) return;
  const topDelta = (r.top - (c.top + pad));
  const botDelta = (r.bottom - (c.bottom - pad));
  if (topDelta < 0) container.scrollTop += topDelta;
  else if (botDelta > 0) container.scrollTop += botDelta;
}

function createVirtualList(container, {
  estimateRowHeight = 64,
  overscanPx = 320,
  getKey,
  renderItem,
} = {}) {
  if (!container) return null;

  const content = document.createElement("div");
  content.className = "virtualListContent";
  container.replaceChildren(content);
  container.classList.add("virtualList");

  let items = [];
  let renderQueued = false;
  let tops = [];
  let heights = [];
  let totalHeight = 0;
  const measuredHeights = new Map();

  function recomputeLayout() {
    tops = new Array(items.length);
    heights = new Array(items.length);

    let cursor = 0;
    for (let i = 0; i < items.length; i += 1) {
      tops[i] = cursor;
      const key = getKey(items[i], i);
      const height = measuredHeights.get(key) ?? estimateRowHeight;
      heights[i] = height;
      cursor += height;
    }

    totalHeight = cursor;
    content.style.height = `${totalHeight}px`;
  }

  function lowerBoundTop(target) {
    let lo = 0;
    let hi = tops.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((tops[mid] + heights[mid]) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function upperBoundTop(target) {
    let lo = 0;
    let hi = tops.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function renderNow() {
    renderQueued = false;
    if (!items.length) {
      content.replaceChildren();
      content.style.height = "0px";
      return;
    }

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight || (estimateRowHeight * 8);
    const startPx = Math.max(0, scrollTop - overscanPx);
    const endPx = scrollTop + viewportHeight + overscanPx;

    const startIndex = Math.max(0, lowerBoundTop(startPx));
    const endIndex = Math.min(items.length, Math.max(startIndex + 1, upperBoundTop(endPx)));

    const frag = document.createDocumentFragment();
    const renderedRows = [];
    let layoutDirty = false;

    for (let i = startIndex; i < endIndex; i += 1) {
      const item = items[i];
      const row = renderItem(item, i);
      if (!row) continue;
      row.classList.add("virtualListRow");
      row.style.top = `${tops[i]}px`;
      const key = getKey(item, i);
      renderedRows.push({ key, row });
      frag.appendChild(row);
    }

    content.replaceChildren(frag);

    for (let i = 0; i < renderedRows.length; i += 1) {
      const { key, row } = renderedRows[i];
      syncWatchItemActionLayout(row);
      const measureEl = row.querySelector?.(".watchItemContent") || row;
      const rowHeight = Math.ceil(measureEl.offsetHeight || row.offsetHeight || estimateRowHeight);
      if (rowHeight > 0 && measuredHeights.get(key) !== rowHeight) {
        measuredHeights.set(key, rowHeight);
        layoutDirty = true;
      }
    }

    if (layoutDirty) {
      recomputeLayout();
      requestRender();
    }
  }

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderNow);
  }

  function scrollToIndex(index, pad = 12) {
    if (!Number.isInteger(index) || index < 0 || index >= items.length) return;
    const top = tops[index] ?? 0;
    const height = heights[index] ?? estimateRowHeight;
    const visibleTop = container.scrollTop + pad;
    const visibleBottom = container.scrollTop + container.clientHeight - pad;
    if (top < visibleTop) container.scrollTop = Math.max(0, top - pad);
    else if ((top + height) > visibleBottom) {
      container.scrollTop = Math.max(0, top + height - container.clientHeight + pad);
    }
    requestRender();
  }

  function setItems(nextItems, { resetScroll = false } = {}) {
    items = (nextItems && typeof nextItems.length === "number") ? nextItems : [];
    measuredHeights.clear();
    recomputeLayout();
    if (resetScroll) container.scrollTop = 0;
    requestRender();
  }

  container.addEventListener("scroll", requestRender, { passive: true });
  window.addEventListener("resize", requestRender);
  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(requestRender);
    resizeObserver.observe(container);
  }

  return {
    setItems,
    refresh: requestRender,
    scrollToIndex,
    getItems: () => items,
  };
}

let renderedWatchIndexByTime = new Map();

const watchListVirtual = createVirtualList(watchList, {
  estimateRowHeight: 62,
  overscanPx: 480,
  getKey: (item, index) => `${item?.t ?? "watch"}:${index}`,
  renderItem: createWatchListItem,
});

const poseListVirtual = createVirtualList(poseList, {
  estimateRowHeight: 52,
  overscanPx: 320,
  getKey: (_, index) => `pose:${index}`,
  renderItem: (_, index) => createPoseListItem(index),
});

document.addEventListener("pointerdown", (ev) => {
  if (!openWatchActionsMenu) return;
  const target = ev.target instanceof Element ? ev.target : null;
  if (target && (
    openWatchActionsMenu.menu?.contains(target)
    || openWatchActionsMenu.button?.contains(target)
  )) return;
  closeOpenWatchActionsMenu();
}, true);

document.addEventListener("keydown", (ev) => {
  if (!openWatchActionsMenu) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeOpenWatchActionsMenu({ restoreFocus: true });
  } else if (ev.key === "Tab") {
    closeOpenWatchActionsMenu();
  }
}, true);

watchList?.addEventListener("scroll", () => {
  closeOpenWatchActionsMenu();
}, { passive: true });

function highlightWatchInList(tMs, doScroll) {
  if (!watchListVirtual) return;
  if (tMs != null && doScroll) {
    const idx = renderedWatchIndexByTime.get(tMs);
    if (idx != null) watchListVirtual.scrollToIndex(idx, 12);
  }
  watchListVirtual.refresh();
}

function highlightLogInList(tMs, doScroll) {
  if (!logList) return;
  const items = logList.querySelectorAll(".watchItem");
  items.forEach(el => el.classList.remove("selected"));
  if (tMs == null) return;
  const el = logList.querySelector(`.watchItem[data-t="${CSS.escape(String(tMs))}"]`);
  if (el) {
    el.classList.add("selected");
    if (doScroll) requestAnimationFrame(() => scrollIntoViewIfNeeded(logList, el, 12));
  }
}

function jumpToEventTime(tMs, {
  exactStatus,
  interpolatedStatus,
  noPoseStatus,
  clearWatchSelection = false,
} = {}) {
  // Clicking an event should override track lock/hover to avoid confusion.
  clearTrackHover(true);
  clearTrackLock();

  if (leftConnected && leftStreaming) liveAutoFollowHead = false;

  if (!rawPoses.length) {
    selectedIndex = 0;
    lastPoseIndex = 0;

    pause();
    hoverTimelineTime = null;
    timelineHoverSaved = null;

    if (clearWatchSelection) {
      selectedWatch = null;
      highlightWatchInList(null, false);
      hideWatchPopup();
    }

    if (typeof noPoseStatus === "function") noPoseStatus();

    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
    return;
  }

  const near = nearestIndexWithinTol(tMs, WATCH_TOL_MS);
  if (near) {
    selectedIndex = near.idx;
    if (typeof exactStatus === "function") exactStatus(near);
  } else {
    selectedIndex = findFloorIndexByTime(tMs);
    if (typeof interpolatedStatus === "function") interpolatedStatus();
  }
  lastPoseIndex = selectedIndex;

  pause();
  hoverTimelineTime = null;
  timelineHoverSaved = null;

  if (clearWatchSelection) {
    selectedWatch = null;
    highlightWatchInList(null, false);
    hideWatchPopup();
  }

  highlightPoseInList();
  updatePoseReadout();
  requestDrawAll();
}

// --- Watch popup (tiny, click to show, click elsewhere to dismiss) ---
const watchPopup = document.getElementById("watchPopup");
let watchPopupOpen = false;
let watchGraphPanelOpen = false;
let watchGraphPanelKey = null;
let watchGraphCompareKey = "";
let watchGraphChart = null;
let watchGraphMarkersForKey = [];
let watchGraphCompareMarkersForKey = [];
let watchGraphZoomRange = null;
let watchGraphFollowLatest = false;
const WATCH_GRAPH_FOLLOW_HEAD_TOLERANCE_S = 2.5;
let isWatchGraphDragging = false;
let isWatchGraphResizing = false;
let watchGraphDragStart = { x: 0, y: 0 };
let watchGraphHoverSaved = null;

function hideWatchPopup() {
  if (!watchPopup) return;
  watchPopup.hidden = true;
  watchPopupOpen = false;
}

function watchGraphKeyForWatch(w) {
  const idNum = Number(w?.id);
  if (Number.isInteger(idNum)) return `id:${idNum}`;
  return `label:${String(w?.label ?? "").trim()}`;
}

function watchVisibilityKeyForWatch(w) {
  const idNum = Number(w?.id);
  if (Number.isInteger(idNum)) return `id:${idNum}`;
  return `entry:${Number(w?.t)}`;
}

function watchFilterValue() {
  return watchFilter?.value || "all";
}

function watchFilterKeyForWatch(w) {
  return watchGraphKeyForWatch(w);
}

function watchFilterMatches(watch) {
  const filter = watchFilterValue();
  if (filter === "all") return true;
  return watchFilterKeyForWatch(watch) === filter;
}

function watchFilterLabelForWatch(watch) {
  const idNum = Number(watch?.id);
  const hasId = Number.isInteger(idNum);
  const label = String(watch?.label ?? "").trim();
  if (hasId && label) return `${label}`;
  if (hasId) return `Watch ${idNum}`;
  return label || "Unnamed Watch";
}

function isWatchVisible(w) {
  return w?.visible !== false;
}

function isWatchMarkerVisible(marker) {
  return isWatchVisible(marker?.watch) && watchFilterMatches(marker?.watch);
}

function watchVisibilityIconId(w) {
  return isWatchVisible(w) ? "icon-visibleWatch" : "icon-invisibleWatch";
}

function watchVisibilityTitle(w) {
  return isWatchVisible(w) ? "Hide watch" : "Show watch";
}

function isGraphableWatchValue(value) {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);

  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  if (text === "true" || text === "false") return true;
  return Number.isFinite(Number(text));
}

function graphableWatchOptions(currentKey = "") {
  const seen = new Set();
  const options = [];
  const source = Array.isArray(watches) ? watches : [];

  for (let i = source.length - 1; i >= 0; i -= 1) {
    const watch = source[i];
    if (!watch || !isGraphableWatchValue(watch.value)) continue;
    const key = watchGraphKeyForWatch(watch);
    if (!key || key === currentKey || seen.has(key)) continue;
    seen.add(key);
    options.push({
      key,
      label: watchFilterLabelForWatch(watch),
      id: Number(watch?.id),
    });
  }

  options.sort((a, b) => {
    const labelCmp = a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
    if (labelCmp !== 0) return labelCmp;

    const aHasId = Number.isInteger(a.id);
    const bHasId = Number.isInteger(b.id);
    if (aHasId && bHasId) return a.id - b.id;
    if (aHasId) return -1;
    if (bHasId) return 1;
    return a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: "base" });
  });

  return options;
}

function refreshWatchGraphCompareSelect() {
  if (!watchGraphCompareSelect) return;

  const options = graphableWatchOptions(watchGraphPanelKey);
  const previousValue = options.some((option) => option.key === watchGraphCompareKey) ? watchGraphCompareKey : "";
  watchGraphCompareKey = previousValue;

  watchGraphCompareSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = options.length > 0 ? "No comparison" : "No comparison watches";
  watchGraphCompareSelect.appendChild(placeholder);

  for (let i = 0; i < options.length; i += 1) {
    const option = document.createElement("option");
    option.value = options[i].key;
    option.textContent = options[i].label;
    watchGraphCompareSelect.appendChild(option);
  }

  watchGraphCompareSelect.value = previousValue;
  watchGraphCompareSelect.disabled = options.length === 0;
}

function setSvgUseHref(useEl, href) {
  if (!useEl || !href) return;
  useEl.setAttribute("href", href);
  useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href);
}

const svgIconUrls = {
  "icon-fit": fitIconUrl,
  "icon-removePlanningObject": removePlanningObjectIconUrl,
  "icon-planningChangeObjectColor": changeObjectColorIconUrl,
  "icon-pinWatch": pinWatchIconUrl,
  "icon-invisibleWatch": invisibleWatchIconUrl,
  "icon-visibleWatch": visibleWatchIconUrl,
  "icon-watchGraph": watchGraphIconUrl,
};

function svgIconHref(iconId) {
  const iconUrl = svgIconUrls[iconId];
  return iconUrl ? `${iconUrl}#${iconId}` : "";
}

function updateWatchVisibilityButtons(key) {
  if (!watchList || !key) return;
  const buttons = watchList.querySelectorAll(`.watchVisibilityBtn[data-watch-visibility-key="${key}"]`);
  for (const button of buttons) {
    const useEl = button.querySelector("use");
    const iconId = button.dataset.iconId || "icon-visibleWatch";
    if (useEl) setSvgUseHref(useEl, svgIconHref(iconId));
    button.title = button.dataset.title || "Toggle watch visibility";
    button.setAttribute("aria-label", button.dataset.title || "Toggle watch visibility");
  }
  requestDrawAll();
}

function currentVisibilityForWatch(watch) {
  const key = watchVisibilityKeyForWatch(watch);
  for (let i = watches.length - 1; i >= 0; i -= 1) {
    const candidate = watches[i];
    if (watchVisibilityKeyForWatch(candidate) !== key) continue;
    return isWatchVisible(candidate);
  }
  return true;
}

function toggleWatchVisibilityForWatch(watch) {
  const key = watchVisibilityKeyForWatch(watch);
  const nextVisible = !isWatchVisible(watch);

  for (let i = 0; i < watches.length; i += 1) {
    const candidate = watches[i];
    if (watchVisibilityKeyForWatch(candidate) !== key) continue;
    candidate.visible = nextVisible;
  }

  const nextTitle = watchVisibilityTitle({ visible: nextVisible });
  const nextIconId = watchVisibilityIconId({ visible: nextVisible });
  const buttons = watchList?.querySelectorAll(`.watchVisibilityBtn[data-watch-visibility-key="${key}"]`) ?? [];
  for (const button of buttons) {
    button.dataset.iconId = nextIconId;
    button.dataset.title = nextTitle;
  }
  updateWatchVisibilityButtons(key);
}

function watchGraphStatsByKey(key) {
  if (!key) return { latest: null, count: 0, avg: null, min: null, max: null };
  let latest = null;
  let count = 0;
  let sum = 0;
  let numericCount = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < watches.length; i += 1) {
    const entry = watches[i];
    if (watchGraphKeyForWatch(entry) !== key) continue;
    count += 1;
    if (!latest || (entry.t ?? 0) >= (latest.t ?? 0)) latest = entry;
    const numericValue = numericWatchValue(entry.value);
    if (numericValue == null) continue;
    sum += numericValue;
    numericCount += 1;
    min = Math.min(min, numericValue);
    max = Math.max(max, numericValue);
  }
  return {
    latest,
    count,
    avg: numericCount > 0 ? (sum / numericCount) : null,
    min: numericCount > 0 ? min : null,
    max: numericCount > 0 ? max : null,
  };
}

function findWatchByKeyAtOrBeforeTime(key, tMs) {
  if (!key || tMs == null || !Array.isArray(watches) || !watches.length) return null;
  for (let i = watches.length - 1; i >= 0; i -= 1) {
    const entry = watches[i];
    if (watchGraphKeyForWatch(entry) !== key) continue;
    if ((entry.t ?? Infinity) <= tMs) return entry;
  }
  return null;
}

function formatWatchGraphNumericStat(value) {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return formatNumberString(value, 3);
}

function formatWatchGraphCountStat(value) {
  return Number.isFinite(value) ? String(Math.trunc(value)) : "—";
}

function numericWatchValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;

  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "true") return 1;
  if (text === "false") return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function isBooleanWatchValue(value) {
  if (typeof value === "boolean") return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "false";
}

function collectWatchGraphSeries(key) {
  const points = [];
  const markers = [];
  let hasBooleanSeries = false;

  for (let i = 0; i < watchMarkers.length; i += 1) {
    const marker = watchMarkers[i];
    const entry = marker?.watch;
    if (watchGraphKeyForWatch(entry) !== key) continue;
    const y = numericWatchValue(entry?.value);
    const tMs = Number(marker?.t);
    if (y == null || !Number.isFinite(tMs)) continue;
    hasBooleanSeries = hasBooleanSeries || isBooleanWatchValue(entry?.value);
    markers.push(marker);
    points.push({ x: tMs / 1000, y, isBoolean: isBooleanWatchValue(entry?.value) });
  }

  return {
    points,
    markers,
    hasBooleanSeries,
  };
}

function seriesRange(points) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const y = Number(points[i]?.y);
    if (!Number.isFinite(y)) continue;
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

function normalizeBooleanSeriesPoints(points, referenceRange = null) {
  if (!Array.isArray(points) || !points.length) return [];

  let minValue = 0;
  let maxValue = 1;
  if (referenceRange && Number.isFinite(referenceRange.min) && Number.isFinite(referenceRange.max)) {
    minValue = referenceRange.min;
    maxValue = referenceRange.max;
  }

  if (minValue === maxValue) {
    if (minValue === 0) maxValue = 1;
    else minValue = 0;
  }

  return points.map((point) => ({
    x: point.x,
    y: point.y > 0 ? maxValue : minValue,
  }));
}

function buildWatchGraphDatasets(key, compareKey = "") {
  const primarySeries = collectWatchGraphSeries(key);
  const compareSeries = compareKey ? collectWatchGraphSeries(compareKey) : { points: [], markers: [], hasBooleanSeries: false };

  const primaryRange = seriesRange(primarySeries.points);
  const compareRange = seriesRange(compareSeries.points);

  const primaryPoints = primarySeries.hasBooleanSeries
    ? normalizeBooleanSeriesPoints(primarySeries.points, compareRange)
    : primarySeries.points.map((point) => ({ x: point.x, y: point.y }));
  const comparePoints = compareSeries.hasBooleanSeries
    ? normalizeBooleanSeriesPoints(compareSeries.points, primaryRange)
    : compareSeries.points.map((point) => ({ x: point.x, y: point.y }));

  const combinedRange = seriesRange(primaryPoints.concat(comparePoints));
  const yMin = combinedRange?.min ?? 0;
  const yMaxBase = combinedRange?.max ?? 1;
  const yMax = yMin === yMaxBase ? (yMin === 0 ? 1 : yMin + 1) : yMaxBase;

  return {
    primarySeries,
    compareSeries,
    primaryPoints,
    comparePoints,
    yRange: { min: yMin, max: yMax },
  };
}

function watchGraphTimeRange(primaryPoints, comparePoints) {
  const allPoints = primaryPoints.concat(comparePoints);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < allPoints.length; i += 1) {
    const x = Number(allPoints[i]?.x);
    if (!Number.isFinite(x)) continue;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}

function normalizeWatchGraphZoomRange(range, fullRange) {
  if (!range || !fullRange) return null;
  const fullMin = Number(fullRange.min);
  const fullMax = Number(fullRange.max);
  if (!Number.isFinite(fullMin) || !Number.isFinite(fullMax) || fullMax <= fullMin) return null;

  let min = clamp(Number(range.min), fullMin, fullMax);
  let max = clamp(Number(range.max), fullMin, fullMax);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

  const minSpan = Math.min(0.1, fullMax - fullMin);
  if ((max - min) < minSpan) {
    const center = (min + max) / 2;
    min = center - minSpan / 2;
    max = center + minSpan / 2;
  }

  if (min < fullMin) {
    max += fullMin - min;
    min = fullMin;
  }
  if (max > fullMax) {
    min -= max - fullMax;
    max = fullMax;
  }

  min = clamp(min, fullMin, fullMax);
  max = clamp(max, fullMin, fullMax);
  if ((max - min) >= (fullMax - fullMin) - 1e-6) return null;
  return { min, max };
}

function getLatestRobotTimeSeconds() {
  const tMs = rawPoses[rawPoses.length - 1]?.t;
  return Number.isFinite(tMs) ? tMs / 1000 : null;
}

function isWatchGraphRangeNearRobotHead(range) {
  if (!range) return false;
  const robotTime = getLatestRobotTimeSeconds();
  const rightEdge = Number(range.max);
  return Number.isFinite(robotTime)
    && Number.isFinite(rightEdge)
    && rightEdge >= robotTime - WATCH_GRAPH_FOLLOW_HEAD_TOLERANCE_S;
}

function setWatchGraphZoomRange(nextRange, fullRange) {
  watchGraphZoomRange = normalizeWatchGraphZoomRange(nextRange, fullRange);
  watchGraphFollowLatest = isWatchGraphRangeNearRobotHead(watchGraphZoomRange);
}

function renderWatchGraphForKey(key) {
  if (!watchGraphCanvas) return;

  const { primarySeries, compareSeries, primaryPoints, comparePoints, yRange } = buildWatchGraphDatasets(key, watchGraphCompareKey);
  watchGraphMarkersForKey = primarySeries.markers;
  watchGraphCompareMarkersForKey = compareSeries.markers;
  const hasPrimaryPoints = primaryPoints.length > 0;
  const hasComparePoints = comparePoints.length > 0;
  const fullTimeRange = watchGraphTimeRange(primaryPoints, comparePoints);
  let zoomRange = normalizeWatchGraphZoomRange(watchGraphZoomRange, fullTimeRange);
  if (!watchGraphFollowLatest && isWatchGraphRangeNearRobotHead(zoomRange)) {
    watchGraphFollowLatest = true;
  }
  if (watchGraphFollowLatest && zoomRange && fullTimeRange) {
    const span = zoomRange.max - zoomRange.min;
    zoomRange = normalizeWatchGraphZoomRange({
      min: fullTimeRange.max - span,
      max: fullTimeRange.max,
    }, fullTimeRange);
  }
  watchGraphZoomRange = zoomRange;
  if (!watchGraphZoomRange) watchGraphFollowLatest = false;

  if (watchGraphEmpty) watchGraphEmpty.hidden = hasPrimaryPoints || hasComparePoints;

  if (!hasPrimaryPoints) {
    if (watchGraphChart) {
      watchGraphChart.destroy();
      watchGraphChart = null;
    }
    return;
  }

  const yMin = yRange.min;
  const yMax = yRange.max;
  const datasets = [{
    label: "Value",
    data: primaryPoints,
    borderColor: "#6ea8fff2",
    backgroundColor: "rgba(110, 168, 255, 0.25)",
    borderWidth: 2,
    pointRadius: 0,
    tension: primarySeries.hasBooleanSeries ? 0 : 0.1,
    stepped: primarySeries.hasBooleanSeries ? "after" : false,
  }];

  if (hasComparePoints) {
    datasets.push({
      label: "Comparison",
      data: comparePoints,
      borderColor: "#ff810c",
      backgroundColor: "rgba(255, 129, 12, 0.2)",
      borderWidth: 2,
      pointRadius: 0,
      tension: compareSeries.hasBooleanSeries ? 0 : 0.1,
      stepped: compareSeries.hasBooleanSeries ? "after" : false,
    });
  }

  if (!watchGraphChart) {
    watchGraphChart = new Chart(watchGraphCanvas, {
      type: "line",
      data: {
        datasets,
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        parsing: false,
        normalized: true,
        scales: {
          x: {
            type: "linear",
            min: zoomRange?.min,
            max: zoomRange?.max,
            title: { display: true, text: "Time (s)", color: "rgba(255,255,255,0.75)" },
            ticks: { color: "rgba(255,255,255,0.72)" },
            grid: { color: "rgba(255,255,255,0.1)" },
          },
          y: {
            type: "linear",
            min: yMin,
            max: yMax,
            title: { display: true, text: "Value", color: "rgba(255,255,255,0.75)" },
            ticks: { color: "rgba(255,255,255,0.72)" },
            grid: { color: "rgba(255,255,255,0.1)" },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });
    return;
  }

  watchGraphChart.data.datasets = datasets;
  if (watchGraphChart.options?.scales?.x) {
    watchGraphChart.options.scales.x.min = zoomRange?.min;
    watchGraphChart.options.scales.x.max = zoomRange?.max;
  }
  if (watchGraphChart.options?.scales?.y) {
    watchGraphChart.options.scales.y.min = yMin;
    watchGraphChart.options.scales.y.max = yMax;
  }
  watchGraphChart.update("none");
}

function resizeWatchGraphChart() {
  if (!watchGraphChart) return;
  watchGraphChart.resize();
  watchGraphChart.update("none");
}

function saveWatchGraphHoverState() {
  if (watchGraphHoverSaved != null) return;
  watchGraphHoverSaved = {
    index: selectedIndex,
    lockActive: trackLockActive,
    lockPose: trackLockPose,
    lockIndex: trackLockIndex,
  };
}

function clearWatchGraphHoverPreview({ restore = true } = {}) {
  hoverTimelineTime = null;

  if (restore && watchGraphHoverSaved != null) {
    selectedIndex = watchGraphHoverSaved.index;
    trackLockActive = watchGraphHoverSaved.lockActive;
    trackLockPose = watchGraphHoverSaved.lockPose;
    trackLockIndex = watchGraphHoverSaved.lockIndex;
  }

  watchGraphHoverSaved = null;
  updatePoseReadout();
  requestDrawAll();
}

function watchGraphMarkerFromEvent(event) {
  if (!watchGraphChart) return null;
  const hits = watchGraphChart.getElementsAtEventForMode(event, "nearest", { intersect: false }, false);
  if (!Array.isArray(hits) || !hits.length) return null;
  const datasetIndex = hits[0]?.datasetIndex;
  const pointIndex = hits[0]?.index;
  if (!Number.isInteger(pointIndex)) return null;
  if (datasetIndex === 1) return watchGraphCompareMarkersForKey[pointIndex] ?? null;
  return watchGraphMarkersForKey[pointIndex] ?? null;
}

function refreshWatchGraphPanelData() {
  refreshWatchGraphCompareSelect();
  if (!watchGraphPanelOpen || !watchGraphPanelKey) return;
  const { latest, count, avg, min, max } = watchGraphStatsByKey(watchGraphPanelKey);
  const compareStats = watchGraphCompareKey ? watchGraphStatsByKey(watchGraphCompareKey) : null;
  if (!latest || count <= 0) {
    hideWatchGraphPanel();
    return;
  }

  const currentLatest = findWatchByKeyAtOrBeforeTime(watchGraphPanelKey, getPinnedWatchReferenceTimeMs());
  const currentCompareLatest = watchGraphCompareKey
    ? findWatchByKeyAtOrBeforeTime(watchGraphCompareKey, getPinnedWatchReferenceTimeMs())
    : null;

  const idNum = Number(latest.id);
  const hasId = Number.isInteger(idNum);
  const idText = hasId ? String(idNum) : "—";
  const labelText = String(latest.label ?? "");
  const latestValue = (currentLatest?.value == null) ? "—" : String(currentLatest.value);
  const compareLatestValue = (currentCompareLatest?.value == null) ? "—" : String(currentCompareLatest.value);

  if (watchGraphSubtitle) watchGraphSubtitle.textContent = hasId ? `Id: ${idText}` : "Id: —";
  if (watchGraphTitle) watchGraphTitle.textContent = labelText || "—";
  if (watchGraphLatest) watchGraphLatest.textContent = latestValue;
  if (watchGraphCompareLatest) watchGraphCompareLatest.textContent = compareLatestValue;
  if (watchGraphCount) watchGraphCount.textContent = formatWatchGraphCountStat(count);
  if (watchGraphAvg) watchGraphAvg.textContent = formatWatchGraphNumericStat(avg);
  if (watchGraphMin) watchGraphMin.textContent = formatWatchGraphNumericStat(min);
  if (watchGraphMax) watchGraphMax.textContent = formatWatchGraphNumericStat(max);
  if (watchGraphCompareCount) watchGraphCompareCount.textContent = formatWatchGraphCountStat(compareStats?.count);
  if (watchGraphCompareAvg) watchGraphCompareAvg.textContent = formatWatchGraphNumericStat(compareStats?.avg);
  if (watchGraphCompareMin) watchGraphCompareMin.textContent = formatWatchGraphNumericStat(compareStats?.min);
  if (watchGraphCompareMax) watchGraphCompareMax.textContent = formatWatchGraphNumericStat(compareStats?.max);
  renderWatchGraphForKey(watchGraphPanelKey);
}

function showWatchGraphPanelForKey(key) {
  if (!key) return false;
  const { latest, count } = watchGraphStatsByKey(key);
  if (!latest || count <= 0) return false;
  if (!watchGraphPanel) return false;
  if (watchGraphPanelKey !== key) {
    watchGraphZoomRange = null;
    watchGraphFollowLatest = false;
  }
  watchGraphPanel.classList.remove("hidden");
  watchGraphPanel.classList.add("isOn");
  watchGraphPanelOpen = true;
  watchGraphPanelKey = key;
  refreshWatchGraphPanelData();
  resizeWatchGraphChart();
  return true;
}

function hideWatchGraphPanel({ preserveKey = false } = {}) {
  if (!watchGraphPanel) return;
  watchGraphPanel.classList.add("hidden");
  watchGraphPanel.classList.remove("isOn");
  watchGraphPanelOpen = false;
  if (!preserveKey) {
    watchGraphPanelKey = null;
    watchGraphCompareKey = "";
    watchGraphZoomRange = null;
    watchGraphFollowLatest = false;
  }
  watchGraphMarkersForKey = [];
  watchGraphCompareMarkersForKey = [];
  clearWatchGraphHoverPreview({ restore: true });
  if (!preserveKey && watchGraphChart) {
    watchGraphChart.destroy();
    watchGraphChart = null;
  }
  if (!preserveKey && watchGraphEmpty) watchGraphEmpty.hidden = false;
  refreshWatchGraphCompareSelect();
}

function openOrToggleWatchGraphPanel(marker) {
  const w = marker?.watch || {};
  const nextKey = watchGraphKeyForWatch(w);
  if (!nextKey) return;
  if (watchGraphPanelOpen && watchGraphPanelKey === nextKey) {
    hideWatchGraphPanel();
    return;
  }
  showWatchGraphPanelForKey(nextKey);
}

function findClosestWatchMarker(targetMs) {
  if (!watchMarkers.length || !Number.isFinite(targetMs)) return null;

  let closest = null;
  let minDiff = Infinity;
  for (let i = 0; i < watchMarkers.length; i += 1) {
    const marker = watchMarkers[i];
    const diff = Math.abs((marker?.t ?? 0) - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = marker;
    }
  }
  return closest;
}

function toggleCurrentWatchGraphPanel() {
  if (watchGraphPanelOpen) {
    hideWatchGraphPanel({ preserveKey: true });
    return;
  }

  if (watchGraphPanelKey && showWatchGraphPanelForKey(watchGraphPanelKey)) return;

  const selectedMarker = selectedWatch?.marker ?? null;
  const poseTime = Number(currentDisplayPose()?.t);
  const fallbackMarker = Number.isFinite(poseTime)
    ? (lastWatchAtTime(poseTime) ?? findClosestWatchMarker(poseTime))
    : (watchMarkers[watchMarkers.length - 1] ?? null);
  const marker = selectedMarker || fallbackMarker;
  if (!marker) return;

  openOrToggleWatchGraphPanel(marker);
}

function fmtPose(p) {
  if (!p) return "—";
  const x = formatNumberString(p.x, 1, "0");
  const y = formatNumberString(p.y, 1, "0");
  const th = formatNumberString(p.theta, 1, "0");
  return `X: ${x} Y: ${y} θ: ${th}°`;
}

function showWatchPopup(marker, clickPos) {
  if (!watchPopup || !marker) return;
  if (!isInsideFieldC(clickPos) && !isInsideTimelineC(clickPos)) return;

  const w = marker.watch || {};
  const pose = marker.pose || interpolatePoseAtTime(marker.t);
  const poseStr = fmtPose(pose);

  const tStr = (marker.t != null) ? `${fmtNum(marker.t / 1000)}s` : "—";
  const labelStr = w.label || "—";
  const valStr = (w.value == null) ? "—" : String(w.value);

  watchPopup.innerHTML = `
    <div class="row"><div class="k">Time</div><div class="v">${escapeHtml(tStr)}</div></div>
    <div class="row"><div class="k">Pose</div><div class="v">${escapeHtml(poseStr)}</div></div>
    <div class="row"><div class="k">Name</div><div class="v">${escapeHtml(String(labelStr))}</div></div>
    <div class="row"><div class="k">Value</div><div class="v">${escapeHtml(valStr)}</div></div>
  `;

  // Position above click, clamp to viewport
  const x = (clickPos && isFinite(clickPos.x)) ? clickPos.x : (lastMouseClient?.x ?? 20);
  const y = (clickPos && isFinite(clickPos.y)) ? clickPos.y : (lastMouseClient?.y ?? 20);

  watchPopup.hidden = false;
  watchPopupOpen = true;

  // measure after display
  requestAnimationFrame(() => {
    const rect = watchPopup.getBoundingClientRect();
    let left = x - rect.width * 0.5;
    let top = y - rect.height - 10;

    left = clamp(left, 8, window.innerWidth - rect.width - 8);
    if (top < 8) top = clamp(y + 10, 8, window.innerHeight - rect.height - 8);

    watchPopup.style.left = `${left}px`;
    watchPopup.style.top = `${top}px`;
  });
}

// dismiss by clicking anywhere else
document.addEventListener("mousedown", (e) => {
  if (!watchPopupOpen) return;
  if (watchPopup && watchPopup.contains(e.target)) return;
  hideWatchPopup();
}, { capture: true });

if (btnCloseWatchGraph) {
  btnCloseWatchGraph.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideWatchGraphPanel();
  });
}

if (watchGraphHeader && watchGraphPanel) {
  watchGraphHeader.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target && e.target.closest("#btnCloseWatchGraph, #watchGraphCompareSelect")) return;
    isWatchGraphDragging = true;
    watchGraphDragStart = {
      x: e.clientX - watchGraphPanel.offsetLeft,
      y: e.clientY - watchGraphPanel.offsetTop,
    };
    e.preventDefault();
  });
}

if (watchGraphCompareSelect) {
  watchGraphCompareSelect.addEventListener("change", () => {
    watchGraphCompareKey = watchGraphCompareSelect.value || "";
    watchGraphZoomRange = null;
    watchGraphFollowLatest = false;
    renderWatchGraphForKey(watchGraphPanelKey);
  });
  watchGraphCompareSelect.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  watchGraphCompareSelect.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
}

if (watchGraphResizer) {
  watchGraphResizer.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isWatchGraphResizing = true;
    e.preventDefault();
    e.stopPropagation();
  });
}

if (watchGraphCanvas) {
  watchGraphCanvas.addEventListener("mousemove", (e) => {
    if (!data || playing || !watchGraphPanelOpen) return;
    const marker = watchGraphMarkerFromEvent(e);
    watchGraphCanvas.style.cursor = marker ? "pointer" : "crosshair";
    if (!marker) {
      clearWatchGraphHoverPreview({ restore: true });
      return;
    }

    saveWatchGraphHoverState();
    hoverTimelineTime = marker.t ?? null;
    updatePoseReadout();
    requestDrawAll();
  });

  watchGraphCanvas.addEventListener("mouseleave", () => {
    if (!data || playing) return;
    watchGraphCanvas.style.cursor = "default";
    clearWatchGraphHoverPreview({ restore: true });
  });

  watchGraphCanvas.addEventListener("mousedown", (e) => {
    if (!data || playing || !watchGraphPanelOpen) return;
    if (window.__live && window.__live.streaming) return;
    if (e.button !== 0) return;

    const marker = watchGraphMarkerFromEvent(e);
    if (!marker) return;

    e.preventDefault();
    clearWatchGraphHoverPreview({ restore: false });
    selectWatchMarker(marker, false, null);
  });

  watchGraphCanvas.addEventListener("wheel", (e) => {
    if (!watchGraphPanelOpen || !watchGraphChart) return;
    const chartArea = watchGraphChart.chartArea;
    const xScale = watchGraphChart.scales?.x;
    if (!chartArea || !xScale) return;

    const rect = watchGraphCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) return;

    const datasets = watchGraphChart.data?.datasets ?? [];
    const fullRange = watchGraphTimeRange(datasets[0]?.data ?? [], datasets[1]?.data ?? []);
    if (!fullRange) return;

    e.preventDefault();

    const currentMin = Number.isFinite(xScale.min) ? xScale.min : fullRange.min;
    const currentMax = Number.isFinite(xScale.max) ? xScale.max : fullRange.max;
    const currentSpan = currentMax - currentMin;
    if (!Number.isFinite(currentSpan) || currentSpan <= 0) return;

    const anchor = xScale.getValueForPixel(x);
    if (!Number.isFinite(anchor)) return;

    const zoomFactor = Math.exp((e.deltaY || 0) * 0.0012);
    let nextSpan = currentSpan * zoomFactor;
    nextSpan = clamp(nextSpan, Math.min(0.1, fullRange.max - fullRange.min), fullRange.max - fullRange.min);

    const ratio = (anchor - currentMin) / currentSpan;
    const nextMin = anchor - nextSpan * ratio;
    const nextMax = nextMin + nextSpan;
    setWatchGraphZoomRange({ min: nextMin, max: nextMax }, fullRange);
    renderWatchGraphForKey(watchGraphPanelKey);
  }, { passive: false });
}

function watchBooleanValueClass(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "true") return " isBooleanTrue";
  if (text === "false") return " isBooleanFalse";
  return "";
}

function watchSortValueKey(value) {
  if (value == null) return { t: 2, n: 0, s: "" };
  if (typeof value === "boolean") return { t: 0, n: value ? 1 : 0, s: String(value) };
  if (typeof value === "number") return { t: 1, n: value, s: "" };
  return { t: 0, n: 0, s: String(value) };
}

let openWatchActionsMenu = null;

function closeOpenWatchActionsMenu({ restoreFocus = false } = {}) {
  if (!openWatchActionsMenu) return;
  const { menu, button } = openWatchActionsMenu;
  menu?.setAttribute("hidden", "");
  button?.setAttribute("aria-expanded", "false");
  if (restoreFocus) button?.focus?.();
  openWatchActionsMenu = null;
}

function toggleWatchActionsMenu(button, menu) {
  if (!button || !menu) return;
  const wasOpen = openWatchActionsMenu?.menu === menu && !menu.hasAttribute("hidden");
  closeOpenWatchActionsMenu();
  if (wasOpen) return;
  menu.removeAttribute("hidden");
  button.setAttribute("aria-expanded", "true");
  openWatchActionsMenu = { button, menu };
}

function syncWatchItemActionLayout(row) {
  if (!row?.classList?.contains("watchItem")) return;
  const label = row.querySelector(".watchLabel");
  const timestamp = row.querySelector(".watchTimestamp");
  if (!label || !timestamp) return;

  row.classList.remove("watchActionsCollapsed", "watchLabelTruncated");
  const labelRect = label.getBoundingClientRect();
  const timestampRect = timestamp.getBoundingClientRect();
  const needsCollapse = labelRect.right > timestampRect.left - 4
    || label.scrollWidth > label.clientWidth + 1;
  if (!needsCollapse) return;

  row.classList.add("watchActionsCollapsed");
  const collapsedLabelRect = label.getBoundingClientRect();
  const collapsedTimestampRect = timestamp.getBoundingClientRect();
  if (
    collapsedLabelRect.right > collapsedTimestampRect.left - 4
    || label.scrollWidth > label.clientWidth + 1
  ) {
    row.classList.add("watchLabelTruncated");
  }
}

function createWatchListItem(m) {
  if (!m) return null;
  const w = m.watch;
  const st = levelStyle(w.level);
  const label = w.label || "";
  const value = w.value ?? "";
  const t = m.t;
  const showGraphButton = isGraphableWatchValue(value);

  const div = document.createElement("div");
  div.className = "watchItem";
  if (selectedWatch?.marker?.t === t) div.classList.add("selected");
  div.dataset.t = String(t);

  div.innerHTML = `
    <div class="watchItemContent">
      <div class="watchItemHeader">
        <div class="watchTitleGroup">
          <span class="pill level watchLevelPill" style="background:${st.fill};color:${st.text}">${escapeHtml(st.name)}</span>
          <span class="watchLabel">${escapeHtml(label)}</span>
        </div>
        <div class="watchMeta">
          <div class="watchTimestamp muted">${t != null ? (String(fmtNum(t / 1000, 2)) + "s") : "—"}</div>
          <div class="watchActions watchActionsPill watchActionsFull pill">
            <button class="iconBtn watchPinBtn" type="button" title="Open watch graph">
                <svg width="20" height="20">
                  <use href="${svgIconHref("icon-pinWatch")}" xlink:href="${svgIconHref("icon-pinWatch")}"></use>
                </svg>
            </button>
            <button class="iconBtn watchVisibilityBtn" type="button" title="Toggle watch visibility">
              <svg width="20" height="20">
                <use href="${svgIconHref(watchVisibilityIconId(w))}" xlink:href="${svgIconHref(watchVisibilityIconId(w))}"></use>
              </svg>
            </button>
            ${showGraphButton ? `
            <button class="iconBtn watchGraphBtn" type="button" title="Open watch graph">
              <svg width="20" height="20">
                <use href="${svgIconHref("icon-watchGraph")}" xlink:href="${svgIconHref("icon-watchGraph")}"></use>
              </svg>
            </button>
            ` : ""}
          </div>
          <div class="watchActionsCompact">
            <button class="iconBtn watchActionsMoreBtn" type="button" title="More watch actions" aria-label="More watch actions" aria-expanded="false">
              ⋮
            </button>
            <div class="watchActionsCompactMenu" hidden>
              <button class="iconBtn watchPinBtn" type="button" title="Pin watch">
                <svg width="20" height="20">
                  <use href="${svgIconHref("icon-pinWatch")}" xlink:href="${svgIconHref("icon-pinWatch")}"></use>
                </svg>
              </button>
              <button class="iconBtn watchVisibilityBtn" type="button" title="Toggle watch visibility">
                <svg width="20" height="20">
                  <use href="${svgIconHref(watchVisibilityIconId(w))}" xlink:href="${svgIconHref(watchVisibilityIconId(w))}"></use>
                </svg>
              </button>
              ${showGraphButton ? `
              <button class="iconBtn watchGraphBtn" type="button" title="Open watch graph">
                <svg width="20" height="20">
                  <use href="${svgIconHref("icon-watchGraph")}" xlink:href="${svgIconHref("icon-watchGraph")}"></use>
                </svg>
              </button>
              ` : ""}
            </div>
          </div>
        </div>
      </div>
      <div class="bigValue${watchBooleanValueClass(value)}">${escapeHtml(String(value))}</div>
    </div>
  `;

  div.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    selectWatchMarker(m, true, { x: ev.clientX, y: ev.clientY });
  }, { passive: false });

  const moreBtn = div.querySelector(".watchActionsMoreBtn");
  const compactMenu = div.querySelector(".watchActionsCompactMenu");
  if (moreBtn && compactMenu) {
    moreBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleWatchActionsMenu(moreBtn, compactMenu);
    });
    moreBtn.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
    }, { passive: true });
    compactMenu.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
    }, { passive: true });
    compactMenu.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeOpenWatchActionsMenu({ restoreFocus: true });
      } else if (ev.key === "Tab") {
        closeOpenWatchActionsMenu();
      }
    });
  }

  const pinButtons = div.querySelectorAll(".watchPinBtn");
  for (const pinBtn of pinButtons) {
    pinBtn.title = "Pin watch";
    pinBtn.setAttribute("aria-label", "Pin watch");
    pinBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleFloatingWatch(w.id ?? w.watchId ?? null);
      closeOpenWatchActionsMenu();
    });
    pinBtn.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
    }, { passive: true });
  }

  const visibilityButtons = div.querySelectorAll(".watchVisibilityBtn");
  for (const visibilityBtn of visibilityButtons) {
    const visibilityKey = watchVisibilityKeyForWatch(w);
    const visibilityTitle = watchVisibilityTitle(w);
    visibilityBtn.dataset.watchVisibilityKey = visibilityKey;
    visibilityBtn.dataset.iconId = watchVisibilityIconId(w);
    visibilityBtn.dataset.title = visibilityTitle;
    visibilityBtn.title = visibilityTitle;
    visibilityBtn.setAttribute("aria-label", visibilityTitle);
    visibilityBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleWatchVisibilityForWatch(w);
      closeOpenWatchActionsMenu();
    });
    visibilityBtn.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
    }, { passive: true });
  }

  const graphButtons = div.querySelectorAll(".watchGraphBtn");
  for (const graphBtn of graphButtons) {
    graphBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openOrToggleWatchGraphPanel(m);
      closeOpenWatchActionsMenu();
    });
    graphBtn.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
    }, { passive: true });
  }

  return div;
}

function renderWatchList() {
  closeOpenWatchActionsMenu();
  if (watchFilter) {
    renderWatchFilter();
  }
  watchCount.textContent = "0";

  const mode = watchSort ? watchSort.value : "time";
  const items = watchMarkers.filter((marker) => watchFilterMatches(marker.watch));
  watchCount.textContent = `${items.length}`;

  items.sort((a, b) => {
    const wa = a.watch || {};
    const wb = b.watch || {};
    if (mode === "level") {
      const r = levelSortRank(wb.level) - levelSortRank(wa.level);
      if (r !== 0) return r;
      return (b.t ?? 0) - (a.t ?? 0);
    }
    if (mode === "time") return (a.t ?? 0) - (b.t ?? 0);
    if (mode === "-time") return (b.t ?? 0) - (a.t ?? 0);
    if (mode === "value") {
      const ka = watchSortValueKey(wa.value);
      const kb = watchSortValueKey(wb.value);
      if (ka.t !== kb.t) return ka.t - kb.t;
      if (ka.t === 1) return (ka.n - kb.n);
      return ka.s.localeCompare(kb.s);
    }
    return 0;
  });

  renderedWatchIndexByTime = new Map();
  for (let i = 0; i < items.length; i += 1) {
    renderedWatchIndexByTime.set(items[i].t, i);
  }

  watchListVirtual?.setItems(items);

  if (selectedWatch?.marker?.t != null) highlightWatchInList(selectedWatch.marker.t, false);
  refreshWatchGraphPanelData();
}

function renderWatchFilter() {
  if (!watchFilter) return;
  const current = watchFilter.value || "all";
  watchFilter.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "All";
  watchFilter.appendChild(allOpt);

  const seen = new Set();
  const options = [];
  const source = watchMarkers.length > 0
    ? watchMarkers.map((marker) => marker.watch).filter(Boolean)
    : watches;
  for (let i = 0; i < source.length; i += 1) {
    const watch = source[i];
    const key = watchFilterKeyForWatch(watch);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({
      key,
      label: watchFilterLabelForWatch(watch),
    });
  }

  options.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
  for (const option of options) {
    const opt = document.createElement("option");
    opt.value = option.key;
    opt.textContent = option.label;
    watchFilter.appendChild(opt);
  }

  const nextValue = Array.from(watchFilter.options).some((opt) => opt.value === current) ? current : "all";
  watchFilter.value = nextValue;
}

function renderLogList() {
  if (!logList || !logCount) return;

  logList.innerHTML = "";
  logCount.textContent = `${logs.length}`;

  const mode = logSort ? logSort.value : "-time";
  const items = logs.slice();

  items.sort((a, b) => {
    if (mode === "level") {
      const r = levelSortRank(b.level) - levelSortRank(a.level);
      if (r !== 0) return r;
      return (b.t ?? 0) - (a.t ?? 0);
    }
    if (mode === "time") return (a.t ?? 0) - (b.t ?? 0);
    return (b.t ?? 0) - (a.t ?? 0);
  });

  for (const entry of items) {
    const st = levelStyle(entry.level);
    const systemPill = entry.isSystem
      ? '<span class="pill logSystemPill">SYSTEM</span>'
      : "";
    const div = document.createElement("div");
    div.className = "watchItem";
    div.dataset.t = String(entry.t);
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="pill level" style="background:${st.fill};color:${st.text}">${escapeHtml(st.name)}</span>
          ${systemPill}
        </div>
        <div class="muted">${entry.t != null ? (String(fmtNum(entry.t / 1000, 2)) + "s") : "—"}</div>
      </div>
      <div class="bigValue selectableText">${escapeHtml(String(entry.message ?? entry.value ?? ""))}</div>
    `;
    div.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target instanceof Element && ev.target.closest(".selectableText")) return;
      ev.preventDefault();
      selectedLogTime = entry.t ?? null;
      selectedWaypointId = null;
      selectedWaypointEventTime = null;
      highlightWaypointInList(null, null, false);
      jumpToEventTime(entry.t, {
        exactStatus: (near) => setStatus(`Log @${entry.t}ms mapped to pose @${rawPoses[near.idx].t}ms (Δ=${near.dt}ms).`),
        interpolatedStatus: () => setStatus(`Log @${entry.t}ms shown via interpolation (no pose within ±${WATCH_TOL_MS}ms).`),
        noPoseStatus: () => setStatus(`Log @${entry.t}ms selected (no poses loaded).`),
        clearWatchSelection: true,
      });
      highlightLogInList(entry.t, true);
    }, { passive: false });
    logList.appendChild(div);
  }

  if (selectedLogTime != null) highlightLogInList(selectedLogTime, false);
}

function renderWaypointFilter() {
  if (!waypointFilter) return;
  const current = waypointFilter.value || "all";
  waypointFilter.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "All";
  waypointFilter.appendChild(allOpt);

  const activeOpt = document.createElement("option");
  activeOpt.value = "active";
  activeOpt.textContent = "Active";
  waypointFilter.appendChild(activeOpt);

  for (const waypoint of waypoints) {
    const opt = document.createElement("option");
    opt.value = String(waypoint.id);
    opt.textContent = waypoint.name || `Waypoint ${waypoint.id}`;
    waypointFilter.appendChild(opt);
  }

  const nextValue = Array.from(waypointFilter.options).some((opt) => opt.value === current) ? current : "all";
  waypointFilter.value = nextValue;
}

function highlightWaypointInList(waypointId, eventTime, doScroll) {
  if (!waypointList) return;
  const items = waypointList.querySelectorAll(".watchItem");
  items.forEach((el) => el.classList.remove("selected"));
  if (waypointId == null) return;

  let selector = `.watchItem[data-waypoint-id="${CSS.escape(String(waypointId))}"]`;
  if (eventTime != null) selector += `[data-event-time="${CSS.escape(String(eventTime))}"]`;
  let el = waypointList.querySelector(selector);
  if (!el) el = waypointList.querySelector(`.watchItem[data-waypoint-id="${CSS.escape(String(waypointId))}"]`);
  if (el) {
    el.classList.add("selected");
    if (doScroll) requestAnimationFrame(() => scrollIntoViewIfNeeded(waypointList, el, 12));
  }
}

function clearWaypointSelection() {
  selectedWaypointId = null;
  selectedWaypointEventTime = null;
  highlightWaypointInList(null, null, false);
}

function waypointPoseIndexForSelection(waypoint, eventTime = null) {
  if (!waypoint || !rawPoses.length) return null;
  const startT = waypoint.createdTime;
  const endT = waypoint.terminalEvent?.t ?? Infinity;
  if (typeof startT !== "number") return null;

  let bestIdx = null;
  let bestDiff = Infinity;
  const targetTime = (typeof eventTime === "number") ? eventTime : (waypoint.latestActiveEvent?.t ?? waypoint.createdTime);

  for (let i = 0; i < rawPoses.length; i += 1) {
    const t = rawPoses[i]?.t;
    if (typeof t !== "number") continue;
    if (t < startT || t > endT) continue;
    const diff = Math.abs(t - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function selectWaypointEvent(waypoint, event = null, fromUserClick = false) {
  if (!waypoint) return;
  selectedWaypointId = waypoint.id;
  selectedWaypointEventTime = event?.t ?? waypoint.latestActiveEvent?.t ?? waypoint.createdTime ?? null;
  selectedWatch = null;
  selectedLogTime = null;
  highlightWatchInList(null, false);
  highlightLogInList(null, false);
  hideWatchPopup();

  if (leftConnected && leftStreaming) {
    requestDrawAll();
    setStatus(`Waypoint: ${waypoint.name || waypoint.id} selected.`);
    highlightWaypointInList(waypoint.id, selectedWaypointEventTime, fromUserClick);
    return;
  }

  const poseIdx = waypointPoseIndexForSelection(waypoint, selectedWaypointEventTime);
  if (poseIdx != null) {
    clearTrackHover(true);
    clearTrackLock();
    pause();
    hoverTimelineTime = null;
    timelineHoverSaved = null;
    selectedIndex = poseIdx;
    lastPoseIndex = selectedIndex;
    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
    setStatus(`Waypoint: ${waypoint.name || waypoint.id} mapped to pose @${rawPoses[poseIdx].t}ms.`);
  } else {
    setStatus(`Waypoint: ${waypoint.name || waypoint.id} has no poses while active.`);
    requestDrawAll();
  }

  highlightWaypointInList(waypoint.id, selectedWaypointEventTime, fromUserClick);
}

function renderWaypointList() {
  if (!waypointList || !waypointCount) return;
  waypointList.innerHTML = "";

  const visible = waypointVisibleEvents();
  waypointCount.textContent = `${visible.length}`;

  const ACTIVE_BACKGROUND = "rgba(0, 114, 176, 0.5)";
  const TIMEDOUT_BACKGROUND = "rgba(211, 24, 24, 0.45)";
  const REACHED_BACKGROUND = "rgba(22, 183, 70, 0.4)";

  for (const { waypoint, event } of visible) {
    const div = document.createElement("div");
    div.className = "watchItem";
    div.dataset.waypointId = String(waypoint.id);
    div.dataset.eventTime = String(event.t);
    const stateLabel = waypoint.retriggerable ? "RETRIGGERABLE" : (waypoint.active ? "ACTIVE" : "INACTIVE");
    const stateFill = waypoint.retriggerable
      ? ((waypoint.terminalEvent?.type === "TIMEDOUT") ? TIMEDOUT_BACKGROUND : ACTIVE_BACKGROUND)
      : (waypoint.active ? ACTIVE_BACKGROUND : (waypoint.terminalEvent?.type === "REACHED" ? REACHED_BACKGROUND : TIMEDOUT_BACKGROUND));
    const stateText = waypoint.retriggerable
      ? "#f1e7ff"
      : (waypoint.active ? "#e7f2ff" : "#d5e3f3ff");
    const eventStyle = waypointTypeStyle(event.type);
    const detailsHtml = waypointEventLines(event)
      .map((line) => `<div class="waypointValue">${escapeHtml(line)}</div>`)
      .join("");
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="pill" style="background:${stateFill};color:${stateText}">${escapeHtml(stateLabel)}</span>
          <span class="pill" style="background:${eventStyle.fill};color:${eventStyle.text}">${escapeHtml(event.type)}</span>
          <span style="font-weight:850;word-break:break-word">${escapeHtml(waypoint.name || `Waypoint ${waypoint.id}`)}</span>
          <div class="subValue" style="margin-top: 0px !important;">(Id: ${escapeHtml(String(waypoint.id))})</div>
        </div>
        <div class="muted">${fmtSecondsToString(event.t) || "—"}</div>
      </div>
      ${detailsHtml}
    `;
    div.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      selectWaypointEvent(waypoint, event, true);
    }, { passive: false });
    waypointList.appendChild(div);
  }

  if (selectedWaypointId != null) {
    highlightWaypointInList(selectedWaypointId, selectedWaypointEventTime, false);
  }
}

function selectWatchMarker(marker, fromUserClick = false, clickPos = null) {
  selectedWatch = { marker };
  selectedLogTime = null;
  selectedWaypointId = null;
  selectedWaypointEventTime = null;

  const timeStr = (marker.t != null) ? `${fmtNum(marker.t / 1000)}s` : "—";;

  jumpToEventTime(marker.t, {
    exactStatus: (near) => setStatus(`Watch @${timeStr} mapped to pose `
      + `@${((rawPoses[near.idx].t != null) ? `${fmtNum(rawPoses[near.idx].t / 1000)}s` : "—")} (Δ=${fmtNum(near.dt / 1000, 2)}s).`),
    interpolatedStatus: () => setStatus(`Watch @${timeStr} shown via interpolation (no pose within ±${WATCH_TOL_MS}ms).`),
    noPoseStatus: () => setStatus(`Watch @${timeStr} selected (no poses loaded).`),
  });

  highlightWatchInList(marker.t, fromUserClick);
  highlightLogInList(null, false);
  highlightWaypointInList(null, null, false);

  if (fromUserClick) showWatchPopup(marker, clickPos);
  else hideWatchPopup();
}

// -------- pose list --------
function createPoseListItem(i) {
  const p = rawPoses[i];
  const t = (typeof p.t === "number") ? Math.round(p.t) : "—";
  const pi = poseToInches(p);
  const poseSummary = `X: ${formatNumberString(pi.x, 1, "0")}in, Y: ${formatNumberString(pi.y, 1, "0")}in, θ: ${formatNumberString(pi.theta, 1, "0")}°`;
  const div = document.createElement("div");
  div.className = "poseItem";
  if (i === selectedIndex) div.classList.add("selected");
  div.dataset.idx = String(i);
  div.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px">
    <div style="font-weight:800">#${i + 1}</div>
    <div class="muted">${fmtNum(t / 1000)}s</div>
  </div>
  <div class="sub">${escapeHtml(poseSummary)}</div>`;
  div.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();

    pause();
    clearTrackHover(true);
    clearTrackLock();
    selectedWatch = null;
    selectedLogTime = null;
    selectedWaypointId = null;
    selectedWaypointEventTime = null;
    highlightWaypointInList(null, null, false);
    selectedIndex = i;
    if (leftConnected && leftStreaming) liveAutoFollowHead = false;
    lastPoseIndex = selectedIndex;
    setStatus(`Jumped to pose #${i + 1}.`);
    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
  }, { passive: false });
  return div;
}

function renderPoseList() {
  if (!poseList) return;
  if (!rawPoses.length) {
    poseCount.textContent = "—";
    poseListVirtual?.setItems([]);
    return;
  }
  poseCount.textContent = `${rawPoses.length}`;
  poseListVirtual?.setItems({ length: rawPoses.length });
  highlightPoseInList();
}

function highlightPoseInList() {
  if (!poseListVirtual) return;
  poseListVirtual.scrollToIndex(selectedIndex, 12);
  poseListVirtual.refresh();
}

// -------- drawing --------
let drawQueued = false;
function requestDrawAll() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    draw();
    drawTimeline();
    drawPlanningTimeline();
  });
}

function drawField() {
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, w, h);

  if (!fieldImg) return;
  const centerWorldX = (bounds.minX + bounds.maxX) * 0.5;
  const centerWorldY = (bounds.minY + bounds.maxY) * 0.5;
  const center = worldToScreenBase(centerWorldX, centerWorldY);
  const wIn = (bounds.maxX - bounds.minX) || 1;
  const hIn = (bounds.maxY - bounds.minY) || 1;
  const wPx = wIn * scale;
  const hPx = hIn * scale;
  const viewportCenter = canvasViewportCenter();

  ctx.save();
  ctx.translate(viewportCenter.x, viewportCenter.y);
  ctx.rotate(fieldRotationRad);
  ctx.translate(-viewportCenter.x, -viewportCenter.y);
  ctx.globalAlpha = 0.95;
  ctx.drawImage(fieldImg, center.x - wPx / 2, center.y - hPx / 2, wPx, hPx);
  ctx.restore();
  ctx.globalAlpha = 1.0;
}

function drawAxes() {
  const ax0 = worldToScreen(bounds.minX, 0);
  const ax1 = worldToScreen(bounds.maxX, 0);
  const ay0 = worldToScreen(0, bounds.minY);
  const ay1 = worldToScreen(0, bounds.maxY);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ax0.x, ax0.y); ctx.lineTo(ax1.x, ax1.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ay0.x, ay0.y); ctx.lineTo(ay1.x, ay1.y); ctx.stroke();
}

function drawPath() {
  const poses = getPosesInches();
  if (poses.length < 2) return;
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1], b = poses[i];
    const pa = worldToScreen(a.x, a.y);
    const pb = worldToScreen(b.x, b.y);
    const grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
    grad.addColorStop(0, heatColorFromNorm(a.speed_norm ?? 0));
    grad.addColorStop(1, heatColorFromNorm(b.speed_norm ?? 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
}

function drawWatchDots() {
  if (!watchMarkers.length) return;

  for (const m of watchMarkers) {
    const { pose, watch } = m;
    if (!isWatchMarkerVisible(m)) continue;
    if (!pose) continue;
    const p = worldToScreen(pose.x, pose.y);

    const isHover = (hoverWatch === m);
    const baseDiameter = isHover ? 11.2 : 8.4;
    const r = scaledViewingFieldRadius(baseDiameter);
    const fillA = 0.40;

    ctx.save();
    ctx.fillStyle = levelFillWithAlpha(watch.level, fillA);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = Math.max(1, 2 * viewingFieldMarkerStyleScale());
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (selectedWatch?.marker?.pose && isWatchMarkerVisible(selectedWatch.marker)) {
    const pose = selectedWatch.marker.pose;
    const p = worldToScreen(pose.x, pose.y);

    const outerR = scaledViewingFieldRadius(18);
    const innerR = scaledViewingFieldRadius(13);

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = Math.max(1, 2 * viewingFieldMarkerStyleScale());
    ctx.beginPath();
    ctx.arc(p.x, p.y, outerR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = levelFillWithAlpha(selectedWatch.marker.watch.level, 0.35);
    ctx.beginPath();
    ctx.arc(p.x, p.y, innerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawWaypointDots() {
  if (!waypoints.length) return;

  for (const waypoint of waypoints) {
    if (!waypointFilterMatches(waypoint)) continue;
    const p = worldToScreen(waypoint.target.x, waypoint.target.y);
    const isSelected = selectedWaypointId === waypoint.id;
    const fill = waypoint.active ? "rgba(0,0,0,0.10)" : "rgba(120,120,120,0.10)";
    const stroke = "rgba(255,255,255,0.96)";
    const baseDiameter = isSelected ? 15 : 12;
    const radius = scaledViewingFieldRadius(baseDiameter);
    const selectedRingGap = 4 * viewingFieldMarkerStyleScale();

    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, 2 * viewingFieldMarkerStyleScale());
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (isSelected) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = Math.max(1, 2 * viewingFieldMarkerStyleScale());
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + selectedRingGap, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function normalizeSignedDeg(d) {
  if (typeof d !== "number" || !isFinite(d)) return null;
  return ((d + 180) % 360 + 360) % 360 - 180;
}

function formatUnitsParts(inches, decimals = 1) {
  if (typeof inches !== "number" || !isFinite(inches)) return [{ text: "—", kind: "value" }];
  const value = inches / (unitsToInFactor || 1);
  return [
    { text: fmtNum(value, decimals), kind: "value" },
    { text: currentUnits, kind: "unit" },
  ];
}

function formatThetaParts(thetaDelta) {
  if (thetaDelta == null) return [{ text: "θ: —", kind: "unit" }];
  return [
    { text: fmtNum(thetaDelta, 1), kind: "value" },
    { text: "°", kind: "unit" },
  ];
}

function waypointOffsetUiScale() {
  return clamp(viewZoom, 0.25, 1);
}

function viewingFieldMarkerScale() {
  return Math.max(viewZoom, CANVAS_ZOOM_MIN);
}

function viewingFieldMarkerStyleScale() {
  return clamp(viewZoom, CANVAS_ZOOM_MIN, 1.75);
}

function scaledViewingFieldDiameter(baseDiameterPx, maxDiameterPx = Infinity) {
  return Math.min(baseDiameterPx * viewingFieldMarkerScale(), maxDiameterPx);
}

function scaledViewingFieldRadius(baseDiameterPx, maxDiameterPx = Infinity) {
  return scaledViewingFieldDiameter(baseDiameterPx, maxDiameterPx) / 2;
}

function scaledPlanFieldNodeSize(basePx, maxIn) {
  return Math.min(basePx * Math.max(viewZoom, CANVAS_ZOOM_MIN), maxIn * scale);
}

function waypointByIdLike(id) {
  if (id == null) return null;
  return waypointsById.get(Number(id))
    || waypoints.find((waypoint) => String(waypoint?.id) === String(id))
    || null;
}

function selectedWaypointForOverlay() {
  if (getAppMode() !== "viewing") return null;
  const filter = waypointFilterValue();
  const overlayWaypointId = (filter !== "all" && filter !== "active")
    ? filter
    : selectedWaypointId;
  if (overlayWaypointId == null) return null;
  const waypoint = waypointByIdLike(overlayWaypointId);
  return waypoint && waypointFilterMatches(waypoint) ? waypoint : null;
}

function drawOffsetPill(x, y, parts, options = {}) {
  if (!parts?.length) return;
  const uiScale = options.uiScale ?? waypointOffsetUiScale();
  const padX = (options.padX ?? 12) * uiScale;
  const padY = (options.padY ?? 4) * uiScale;
  const radius = options.radius ?? 999;
  const bg = options.bg ?? "rgba(30, 30, 30, 0.85)";
  const border = options.border ?? "rgba(255, 255, 255, 0.15)";
  const valueColor = options.valueColor ?? "rgba(255, 255, 255, 0.96)";
  const unitColor = options.unitColor ?? "rgba(255, 255, 255, 0.62)";
  const fontSize = (options.fontSize ?? 10) * uiScale;
  const valueFont = `300 ${fontSize}px ui-monospace, "SFMono-Regular", "SF Mono", Menlo, monospace`;
  const unitFont = `200 ${fontSize}px ui-monospace, "SFMono-Regular", "SF Mono", Menlo, monospace`;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const gap = options.gap ?? 2;
  let textWidth = 0;
  for (const part of parts) {
    ctx.font = part.kind === "unit" ? unitFont : valueFont;
    textWidth += ctx.measureText(part.text).width;
  }
  textWidth += gap * Math.max(0, parts.length - 1);
  const naturalWidth = Math.ceil(textWidth + padX * 2);
  const maxWidth = (options.maxWidth ?? WAYPOINT_OFFSET_PILL_MAX_W_PX) * uiScale;
  const width = Math.min(naturalWidth, maxWidth);
  const height = Math.ceil(fontSize + padY * 2);
  const left = x - width / 2;
  const top = y - height / 2;

  ctx.shadowColor = "rgba(0, 0, 0, 0.30)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = bg;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, radius);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = "transparent";
  const availableTextWidth = Math.max(1, width - padX * 2);
  const textScaleX = Math.min(1, availableTextWidth / Math.max(1, textWidth));
  ctx.translate(x, y + 0.5);
  ctx.scale(textScaleX, 1);
  let cursorX = -textWidth / 2;
  ctx.textAlign = "left";
  for (const part of parts) {
    ctx.font = part.kind === "unit" ? unitFont : valueFont;
    ctx.fillStyle = part.kind === "unit" ? unitColor : valueColor;
    ctx.fillText(part.text, cursorX, 0);
    cursorX += ctx.measureText(part.text).width + gap;
  }
  ctx.restore();
}

function drawWaypointOffsetOverlay(pose) {
  const waypoint = selectedWaypointForOverlay();
  if (!waypoint || !pose) return;

  const waypointScreen = worldToScreen(waypoint.target.x, waypoint.target.y);
  const robotScreen = worldToScreen(pose.x, pose.y);
  const elbowScreen = worldToScreen(pose.x, waypoint.target.y);

  const dxIn = Math.abs((pose.x ?? 0) - (waypoint.target.x ?? 0));
  const dyIn = Math.abs((pose.y ?? 0) - (waypoint.target.y ?? 0));
  const distanceIn = Math.hypot(dxIn, dyIn);
  const thetaDelta = (typeof waypoint.target.theta === "number" && typeof pose.theta === "number")
    ? normalizeSignedDeg(waypoint.target.theta - pose.theta)
    : null;

  const legColor = "rgba(210, 245, 255, 0.46)";
  const hypColor = "rgba(218, 250, 255, 0.96)";
  const pillBg = "rgba(30, 30, 30, 0.85)";
  const pillBorder = "rgba(255, 255, 255, 0.15)";
  const xParts = formatUnitsParts(dxIn);
  const yParts = formatUnitsParts(dyIn);
  const hyptText = thetaDelta ? " | " : "";
  const thetaParts = thetaDelta ? formatThetaParts(thetaDelta) : [{text: "", kind: "unit"}];
  const hypParts = [
    ...formatUnitsParts(distanceIn),
    { text: hyptText, kind: "unit" },
    ...thetaParts,
  ];
  const uiScale = waypointOffsetUiScale();

  ctx.save();
  ctx.strokeStyle = legColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(waypointScreen.x, waypointScreen.y);
  ctx.lineTo(elbowScreen.x, elbowScreen.y);
  ctx.moveTo(elbowScreen.x, elbowScreen.y);
  ctx.lineTo(robotScreen.x, robotScreen.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = hypColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(robotScreen.x, robotScreen.y);
  ctx.lineTo(waypointScreen.x, waypointScreen.y);
  ctx.stroke();
  ctx.restore();

  const pillOffset = 16 * uiScale;
  const xMid = {
    x: (waypointScreen.x + elbowScreen.x) / 2,
    y: (waypointScreen.y + elbowScreen.y) / 2 - Math.sign(robotScreen.y - waypointScreen.y || 1) * pillOffset,
  };
  const yMid = {
    x: (robotScreen.x + elbowScreen.x) / 2 + Math.sign(robotScreen.x - waypointScreen.x || 1) * pillOffset,
    y: (robotScreen.y + elbowScreen.y) / 2,
  };

  const hx = robotScreen.x - waypointScreen.x;
  const hy = robotScreen.y - waypointScreen.y;
  const hLen = Math.hypot(hx, hy) || 1;
  const nx = -hy / hLen;
  const ny = hx / hLen;
  const hypMidX = robotScreen.x + (waypointScreen.x - robotScreen.x) * 0.75;
  const hypMidY = robotScreen.y + (waypointScreen.y - robotScreen.y) * 0.75;
  const normalScale = 18 * uiScale;
  const c1 = { x: hypMidX + nx * normalScale, y: hypMidY + ny * normalScale };
  const c2 = { x: hypMidX - nx * normalScale, y: hypMidY - ny * normalScale };
  const d1 = Math.hypot(c1.x - elbowScreen.x, c1.y - elbowScreen.y);
  const d2 = Math.hypot(c2.x - elbowScreen.x, c2.y - elbowScreen.y);
  const hypPill = d1 >= d2 ? c1 : c2;

  const legFontSize = 9.5;
  const legPadX = 10;
  drawOffsetPill(xMid.x, xMid.y, xParts, { bg: pillBg, border: pillBorder, fontSize: legFontSize, padX: legPadX, uiScale });
  drawOffsetPill(yMid.x, yMid.y, yParts, { bg: pillBg, border: pillBorder, fontSize: legFontSize, padX: legPadX, uiScale });
  drawOffsetPill(hypPill.x, hypPill.y, hypParts, { bg: pillBg, border: pillBorder, fontSize: 11, padX: 12, uiScale });
}

function drawRobot(pose, alpha = 1.0) {
  if (!pose) return;
  const { w: wIn, h: hIn } = robotDimsInches();
  const center = worldToScreen(pose.x, pose.y);
  const wPx = wIn * scale;
  const hPx = hIn * scale;
  const thetaDeg = fieldHeadingToCanvasRotationDeg(pose.theta ?? 0);
  const thetaRad = (thetaDeg) * Math.PI / 180;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(center.x, center.y);
  ctx.rotate(thetaRad);

  const hasImg = robotImageEnabled && robotImgOk && robotImg && robotImg.naturalWidth > 0 && robotImg.naturalHeight > 0;

  if (hasImg) {
    const s = clamp(Number(robotImgTx.scale) || 1, 0.05, 20);
    const ox = Number(robotImgTx.offXIn) || 0;
    const oy = Number(robotImgTx.offYIn) || 0;
    const r = (Number(robotImgTx.rotDeg) || 0) * Math.PI / 180;
    const imgAlpha = clamp(Number(robotImgTx.alpha) || 1, 0, 1);

    ctx.save();
    ctx.globalAlpha = alpha * imgAlpha;
    ctx.translate(ox * scale, -oy * scale);
    ctx.rotate(r);
    ctx.drawImage(robotImg, -(wPx * s) / 2, -(hPx * s) / 2, wPx * s, hPx * s);
    ctx.restore();
  } else {
    // default robot: translucent box + outline
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-wPx / 2, -hPx / 2, wPx, hPx);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.98)";
    ctx.beginPath();
    ctx.moveTo(wPx / 2, -hPx / 2);
    ctx.lineTo(wPx / 2, hPx / 2);
    ctx.stroke();
  }

  // heading arrow (useful even with image)
  const arrowLen = Math.max(wPx, hPx) * 0.85;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(arrowLen / 2, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(arrowLen / 2, 0);
  ctx.lineTo(arrowLen / 2 - 8, -5);
  ctx.lineTo(arrowLen / 2 - 8, 5);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();

  ctx.restore();
}

async function loadRobotImageFromPath(path) {
  if (!path) return;
  try {
    const dataUrl = await invoke("read_image_data", { path });
    robotImageDataUrl = dataUrl;
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        robotImg = img;
        robotImgOk = true;
        robotImgLoadTried = true;
        if (robotImgControlsEl) robotImgControlsEl.hidden = false;
        if (settingsRobotImgControls && robotImageEnabled) settingsRobotImgControls.hidden = false;
        requestDrawAll();
        resolve();
      };
      img.onerror = () => reject(new Error("failed to load robot image from saved path"));
      img.src = dataUrl;
    });
  } catch (e) {
    console.error("Failed to load robot image from path:", e);
    setStatus(`Failed to load robot image from path: ${e.message || e}`);
  }
}

function loadRobotImageFromDataUrl(dataUrl) {
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    robotImg = img;
    robotImgOk = true;
    robotImgLoadTried = true;
    if (robotImgControlsEl) robotImgControlsEl.hidden = false;
    if (settingsRobotImgControls && robotImageEnabled) settingsRobotImgControls.hidden = false;
    requestDrawAll();
  };
  img.onerror = () => {
    setStatus("Failed to load saved robot image.");
    robotImg = null;
    robotImgOk = false;
  };
  img.src = dataUrl;
}

function currentDisplayPose() {
  // priority:
  // playing > timeline hover > track hover > track lock > selectedIndex
  if (playing) return playPose || interpolatePoseAtTime(playTimeMs);
  if (!playing && hoverTimelineTime != null) return interpolatePoseAtTime(hoverTimelineTime);
  if (!playing && trackHover?.pose) return trackHover.pose;
  if (!playing && trackLockActive && trackLockPose) return trackLockPose;
  const poses = getPosesInches();
  return poses[selectedIndex] || null;
}

function draw() {
  drawField();
  drawAxes();
  if (getAppMode() === "viewing") {
    drawPath();
    drawWaypointDots();
    drawWatchDots();
    if (planOverlayVisible) drawPlanningOverlay(true);
    const p = currentDisplayPose();
    if (p) drawWaypointOffsetOverlay(p);
    if (p) drawRobot(p, 1.0);
  } else {
    drawPlanningOverlay();
    const pose = planSampleAtDist(planPlayDist);
    if (pose) {
      drawRobot(pose, 1.0);
    }
  }
}

// -------- timeline --------
function indexToX(i) {
  const rect = timelineCanvas.getBoundingClientRect();
  const W = rect.width || 1;
  const n = Math.max(1, rawPoses.length - 1);
  return (clamp(i, 0, n) / n) * W;
}

function indexToTime(i) {
  i = clamp(i, 0, rawPoses.length - 1);
  return rawPoses[i]?.t ?? 0;
}

// Map a time to a *fractional pose index*, then to X.
// This makes consecutive poses evenly spaced on the timeline.
function timeToX(t) {
  if (!rawPoses.length) return 0;

  // binary search for floor index by time
  let lo = 0, hi = rawPoses.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const tm = rawPoses[mid]?.t ?? 0;
    if (tm <= t) lo = mid;
    else hi = mid - 1;
  }

  const i0 = lo;
  const i1 = Math.min(rawPoses.length - 1, i0 + 1);
  const t0 = rawPoses[i0]?.t ?? 0;
  const t1 = rawPoses[i1]?.t ?? t0;

  const frac = (t1 === t0) ? 0 : clamp((t - t0) / (t1 - t0), 0, 1);
  return indexToX(i0 + frac);
}

// Inverse: X -> fractional pose index -> interpolated time
function xToTime(x) {
  if (!rawPoses.length) return 0;

  const rect = timelineCanvas.getBoundingClientRect();
  const W = rect.width || 1;

  const a = clamp(x / W, 0, 1);
  const f = a * (rawPoses.length - 1);

  const i0 = Math.floor(f);
  const i1 = Math.min(rawPoses.length - 1, i0 + 1);
  const frac = f - i0;

  const t0 = rawPoses[i0]?.t ?? 0;
  const t1 = rawPoses[i1]?.t ?? t0;
  return t0 + frac * (t1 - t0);
}

function timelinePickWatchDot(mx, my) {
  const r = 8;
  for (const m of watchMarkers) {
    if (!isWatchMarkerVisible(m)) continue;
    const dx = mx - timeToX(m.t);
    const dy = my - 10;
    if ((dx * dx + dy * dy) <= r * r) return m;
  }
  return null;
}

function drawTimeline() {
  if (timelineBar.classList.contains("isCollapsed")) return;

  const rect = timelineCanvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  tctx.clearRect(0, 0, W, H);

  tctx.fillStyle = "rgba(16,23,32,0.55)";
  tctx.fillRect(0, 0, W, H);

  if (!rawPoses.length) return;
  const range = timeRange();
  if (!range) return;

  tctx.strokeStyle = "rgba(255,255,255,0.08)";
  tctx.lineWidth = 1;
  const major = 10;
  for (let i = 0; i <= major; i++) {
    const x = (W * i) / major;
    tctx.beginPath(); tctx.moveTo(x, 0); tctx.lineTo(x, H); tctx.stroke();
  }

  // speed trace using norm
  tctx.lineWidth = 2;
  for (let i = 1; i < rawPoses.length; i++) {
    const a = rawPoses[i - 1], b = rawPoses[i];
    if (typeof a.t !== "number" || typeof b.t !== "number") continue;

    const xa = timeToX(a.t);
    const xb = timeToX(b.t);

    const ya = H - 6 - (clamp(a.speed_norm ?? 0, 0, 1) * (H - 12));
    const yb = H - 6 - (clamp(b.speed_norm ?? 0, 0, 1) * (H - 12));

    const grad = tctx.createLinearGradient(xa, ya, xb, yb);
    grad.addColorStop(0, heatColorFromNorm(a.speed_norm ?? 0));
    grad.addColorStop(1, heatColorFromNorm(b.speed_norm ?? 0));

    tctx.strokeStyle = grad;
    tctx.beginPath();
    tctx.moveTo(xa, ya);
    tctx.lineTo(xb, yb);
    tctx.stroke();
  }

  // watch dots
  for (const m of watchMarkers) {
    if (!isWatchMarkerVisible(m)) continue;
    const x = timeToX(m.t);
    const y = 10;
    tctx.save();
    tctx.fillStyle = levelFillWithAlpha(m.watch.level, 0.25);
    tctx.strokeStyle = "rgba(255,255,255,0.95)";
    tctx.lineWidth = 2;
    tctx.beginPath();
    tctx.arc(x, y, 4.2, 0, Math.PI * 2);
    tctx.fill();
    tctx.stroke();
    tctx.restore();
  }

  // selected marker: depends on current state
  let selT = null;
  if (playing) selT = playTimeMs;
  else if (trackLockActive && trackLockIndex != null) selT = rawPoses[trackLockIndex]?.t ?? null;
  else selT = rawPoses[selectedIndex]?.t ?? null;

  if (selT != null) {
    const x = timeToX(selT);
    tctx.strokeStyle = "rgba(255,255,255,0.95)";
    tctx.lineWidth = 2;
    tctx.beginPath();
    tctx.moveTo(x, 0);
    tctx.lineTo(x, H);
    tctx.stroke();
  }

  if (hoverTimelineTime != null) {
    const x = timeToX(hoverTimelineTime);
    tctx.strokeStyle = "rgba(255,255,255,0.5)";
    tctx.lineWidth = 1.5;
    tctx.beginPath();
    tctx.moveTo(x, 0);
    tctx.lineTo(x, H);
    tctx.stroke();
  }

  if (selectedWatch?.marker?.t != null && isWatchMarkerVisible(selectedWatch.marker)) {
    const x = timeToX(selectedWatch.marker.t);
    const y = 10;
    tctx.save();
    tctx.strokeStyle = "rgba(255,255,255,0.95)";
    tctx.lineWidth = 2;
    tctx.beginPath();
    tctx.arc(x, y, 9.0, 0, Math.PI * 2);
    tctx.stroke();
    tctx.restore();
  }
}

function drawPlanningTimeline() {
  if (!planningTimelineCanvas || !pctx) return;
  if (getAppMode() !== "planning") return;
  const rect = planningTimelineCanvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  const layout = getCurrentPlanTimelineLayout();
  pctx.clearRect(0, 0, W, H);

  const total = planTotalLength();
  if (total <= 0) return;

  const y = H / 2;
  pctx.strokeStyle = "rgba(255,255,255,0.12)";
  pctx.lineWidth = 2;
  pctx.beginPath();
  pctx.moveTo(PLAN_TIMELINE_PAD_X, y);
  pctx.lineTo(W - PLAN_TIMELINE_PAD_X, y);
  pctx.stroke();

  const progX = getPlanTimelineXFromDistance(planPlayDist);
  pctx.strokeStyle = "rgba(120,180,255,0.9)";
  pctx.beginPath();
  pctx.moveTo(PLAN_TIMELINE_PAD_X, y);
  pctx.lineTo(progX, y);
  pctx.stroke();

  // end marker above the blue line
  pctx.beginPath();
  pctx.arc(progX, y, 8, 0, Math.PI * 2);
  pctx.fillStyle = "rgba(90, 162, 250, 0.9)";
  pctx.fill();
  pctx.strokeStyle = "rgba(0,0,0,0.9)";
  pctx.lineWidth = 1.5;
  pctx.stroke();

  // markers at waypoints
  pctx.fillStyle = "rgba(180,220,255,0.9)";
  const waypointX = layout?.waypointX?.length ? layout.waypointX : [];
  for (const x of waypointX) {
    pctx.beginPath();
    pctx.arc(x, y, 3.5, 0, Math.PI * 2);
    pctx.fill();
  }
}

// Timeline time readout
function updateDeltaReadout() {
  if (!data || !rawPoses.length) return;
  const lockedTime = rawPoses[selectedIndex]?.t || 0;

  // hoverTimelineTime is the time currently under the cursor
  const hoveredTime = hoverTimelineTime !== null ? hoverTimelineTime : lockedTime;
  const delta = Math.abs(hoveredTime - lockedTime) / 1000;
  if (deltaPill) {
    deltaPill.textContent = `Δ: ${formatFixedNumberString(delta, 2, "0.00")}s`;
  }
}

// --- Floating Window Logic ---
const floatWin = document.getElementById("floatingInfo");
const btnToggleFloat = document.getElementById("btnToggleFloat");
const btnCloseFloat = document.getElementById("btnCloseFloat");
const floatHeader = document.getElementById("floatHeader");
const floatResizer = document.getElementById("floatResizer");

// Toggle Visibility
btnToggleFloat.onclick = (e) => {
  e.stopPropagation(); // Prevents event bubbling
  toggleFloatingInfo();
};

btnCloseFloat.onclick = (e) => {
  e.stopPropagation();
  floatWin.classList.add("hidden");
  btnToggleFloat.classList.remove("isOn");
  floatWin.classList.remove("isOn");
};

// Dragging Logic
let isDragging = false, dragStart = { x: 0, y: 0 };
floatHeader.onmousedown = (e) => {
  isDragging = true;
  dragStart = { x: e.clientX - floatWin.offsetLeft, y: e.clientY - floatWin.offsetTop };
};

// Resizing Logic
let isResizing = false;
floatResizer.onmousedown = (e) => {
  isResizing = true;
  e.preventDefault();
};

window.addEventListener("mousemove", (e) => {
  if (isDragging) {
    floatWin.style.left = `${e.clientX - dragStart.x}px`;
    floatWin.style.top = `${e.clientY - dragStart.y}px`;
  }
  if (isWatchGraphDragging && watchGraphPanel) {
    const nextLeft = e.clientX - watchGraphDragStart.x;
    const nextTop = e.clientY - watchGraphDragStart.y;
    const rect = watchGraphPanel.getBoundingClientRect();
    const clampedLeft = clamp(nextLeft, 0, Math.max(0, window.innerWidth - rect.width));
    const clampedTop = clamp(nextTop, 0, Math.max(0, window.innerHeight - rect.height));
    watchGraphPanel.style.left = `${clampedLeft}px`;
    watchGraphPanel.style.top = `${clampedTop}px`;
    watchGraphPanel.style.right = "auto";
  }
  if (pinnedWatchDragTarget) {
    const nextLeft = e.clientX - pinnedWatchDragStart.x;
    const nextTop = e.clientY - pinnedWatchDragStart.y;
    const rect = pinnedWatchDragTarget.getBoundingClientRect();
    const clampedLeft = clamp(nextLeft, 0, Math.max(0, window.innerWidth - rect.width));
    const clampedTop = clamp(nextTop, 0, Math.max(0, window.innerHeight - rect.height));
    pinnedWatchDragTarget.style.left = `${clampedLeft}px`;
    pinnedWatchDragTarget.style.top = `${clampedTop}px`;
    pinnedWatchDragTarget.style.right = "auto";
  }

  if (isResizing) {
    // Calculate the intended new size
    let newWidth = e.clientX - floatWin.offsetLeft;
    let newHeight = e.clientY - floatWin.offsetTop;

    // Clamp the values
    newWidth = Math.max(floatingWindowBounds.minWidth, Math.min(newWidth, floatingWindowBounds.maxWidth));
    newHeight = Math.max(floatingWindowBounds.minHeight, Math.min(newHeight, floatingWindowBounds.maxHeight));

    // Apply to the element
    floatWin.style.width = `${newWidth}px`;
    floatWin.style.height = `${newHeight}px`;
  }
  if (isWatchGraphResizing && watchGraphPanel) {
    let newWidth = e.clientX - watchGraphPanel.offsetLeft;
    let newHeight = e.clientY - watchGraphPanel.offsetTop;
    const maxWidth = Math.max(WATCH_GRAPH_MIN_W, window.innerWidth - watchGraphPanel.offsetLeft - WATCH_GRAPH_MARGIN);
    const maxHeight = Math.max(WATCH_GRAPH_MIN_H, window.innerHeight - watchGraphPanel.offsetTop - WATCH_GRAPH_MARGIN);
    newWidth = clamp(newWidth, WATCH_GRAPH_MIN_W, Math.min(WATCH_GRAPH_MAX_W, maxWidth));
    newHeight = clamp(newHeight, WATCH_GRAPH_MIN_H, maxHeight);
    watchGraphPanel.style.width = `${newWidth}px`;
    watchGraphPanel.style.height = `${newHeight}px`;
    resizeWatchGraphChart();
  }
});

window.addEventListener("mouseup", () => {
  isDragging = false;
  isResizing = false;
  isWatchGraphDragging = false;
  isWatchGraphResizing = false;
  pinnedWatchDragTarget = null;
});

function findTemporallyClosestWatch(targetMs) {
  if (!watches || !watches.length) return null;

  let closest = null;
  let minDiff = Infinity;

  for (const w of watches) {
    const diff = Math.abs(w.t - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = w;
    }
  }
  return { watch: closest, diffMs: minDiff };
}

// Data Update Function
function updateFloatingInfo(pose, idx) {
  if (floatWin.hidden || !pose) {
    document.getElementById("fx").textContent = "—";
    document.getElementById("fy").textContent = "—";
    document.getElementById("ft").textContent = "—";
    document.getElementById("ftime").textContent = "—";
    document.getElementById("favg").textContent = "—";
    document.getElementById("flv").textContent = "—";
    document.getElementById("frv").textContent = "—";
    document.getElementById("fdeltat").textContent = "—";
    document.getElementById("fcount").textContent = "Point: —/—";
    return;
  }

  document.getElementById("fx").textContent = fmtNum(pose.x, 2);
  document.getElementById("fy").textContent = fmtNum(pose.y, 2);
  document.getElementById("ft").textContent = fmtNum(pose.theta, 2) + "°";
  document.getElementById("ftime").textContent = fmtNum(pose.t / 1000, 2) + "s";

  const l = pose.l_vel || 0;
  const r = pose.r_vel || 0;
  const n = (pose.speed_norm != null) ? pose.speed_norm : 0;
  const disp = speedFromNorm(n);
  const lDisp = speedFromNorm(normFromSpeedRaw(l));
  const rDisp = speedFromNorm(normFromSpeedRaw(r));

  document.getElementById("favg").textContent = disp == null ? "—" : fmtNum(disp, 2);
  document.getElementById("flv").textContent = lDisp == null ? "—" : fmtNum(lDisp, 2);
  document.getElementById("frv").textContent = rDisp == null ? "—" : fmtNum(rDisp, 2);

  document.getElementById("fcount").textContent = `Point: ${idx + 1}/${rawPoses.length}`;

  // Waypoint info
  const result = findTemporallyClosestWatch(pose.t);
  const waypointTime = document.getElementById("fwatchtime");
  const waypointLabel = document.getElementById("fwatchlabel");
  const waypointValue = document.getElementById("fwatchvalue");
  const clickable = document.getElementById("fwatchclickable");
  const deltaTime = document.getElementById("fdeltat");

  if (result) {
    const { watch, diffMs } = result;
    const direction = (watch.t > pose.t) ? "ahead" : "ago";
    const seconds = formatNumberString(diffMs / 1000, 1, "0");

    // Display the label and the time offset
    waypointLabel.textContent = ` ${watch.label}`;
    waypointValue.textContent = ` ${watch.value}`;
    waypointTime.textContent = ` ${seconds}s ${direction}`;

    // Clicking the readout jumps exactly to that waypoint
    clickable.style.cursor = "pointer";
    clickable.onclick = () => {
      pause();
      playTimeMs = watch.t;
      selectedIndex = findFloorIndexByTime(watch.t);
      updatePoseReadout();
      requestDrawAll();
    };

    if (!data || !rawPoses.length) temp.textContent = "—";
    const lockedTime = rawPoses[selectedIndex]?.t || 0;

    // hoverTimelineTime is the time currently under the cursor
    const hoveredTime = hoverTimelineTime !== null ? hoverTimelineTime : lockedTime;
    const delta = Math.abs(hoveredTime - lockedTime) / 1000;
    deltaTime.textContent = `${formatNumberString(delta, 2, "0")}s`;
  } else {
    waypointLabel.textContent = " —";
    waypointValue.textContent = " —";
    waypointTime.textContent = " —";
    deltaTime.textContent = "—";
    clickable.style.cursor = "default";
    clickable.onclick = null;
  }
}

function toggleFloatingInfo() {
  floatWin.classList.toggle("hidden");
  btnToggleFloat.classList.toggle("isOn", !floatWin.classList.contains("hidden"));
  floatWin.classList.toggle("isOn", !floatWin.classList.contains("hidden"));

  viewingTelemetry.floatingInfoToggled({
    enabled: !floatWin.classList.contains("hidden"),
  }).catch(err => console.error(err));
}

// -------- pose readout --------
function updatePoseReadout() {
  if (!data || !rawPoses.length) {
    timePill.textContent = "Time: —";
    pointPill.textContent = "Point: —/—";
    posePill.textContent = "X: —  Y: — θ: —  Speed: —";
    refreshPinnedWatchPanels();
    return;
  }
  if (selectedIndex < 0) selectedIndex = 0;
  if (selectedIndex >= rawPoses.length) selectedIndex = Math.max(0, rawPoses.length - 1);
  let idx = selectedIndex;
  let t = rawPoses[idx]?.t ?? null;
  let p = null;
  if (playing) {
    t = playTimeMs;
    idx = findFloorIndexByTime(playTimeMs);
    p = interpolatePoseAtTime(playTimeMs);

  } else if (hoverTimelineTime != null) {
    t = hoverTimelineTime;
    idx = findFloorIndexByTime(hoverTimelineTime);
    p = interpolatePoseAtTime(hoverTimelineTime);

  } else if (!playing && trackHover?.pose) {
    // if hover pose has a time, use interpolation (smooth) instead of the raw cached pose (snappy)
    const ht = trackHover.pose.t ?? null;

    if (ht != null) {
      t = ht;
      idx = findFloorIndexByTime(ht);
      p = interpolatePoseAtTime(ht);
    } else {
      // fallback to old behavior if hover time isn"t available
      p = trackHover.pose;
      idx = trackHover.idxNearest ?? selectedIndex;
      t = rawPoses[idx]?.t ?? null;
    }

  } else if (!playing && trackLockActive && trackLockPose) {
    p = trackLockPose;
    idx = trackLockIndex ?? selectedIndex;
    t = rawPoses[idx]?.t ?? null;

  } else {
    p = poseToInches(rawPoses[idx]);
  }

  const total = rawPoses.length;
  timePill.textContent = (t == null) ? "Time: —" : `Time: ${formatFixedNumberString(t / 1000, 2)}s`;
  pointPill.textContent = `Point: ${Math.max(1, idx + 1)}/${total}`;

  const spNorm = (p?.speed_norm != null) ? p.speed_norm : (rawPoses[idx]?.speed_norm ?? null);
  const spDisp = speedFromNorm(spNorm);

  posePill.textContent = p
    ? `X: ${fmtNum(p.x, 1)}  Y: ${fmtNum(p.y, 1)}  θ: ${fmtNum(p.theta, 1)}°  Speed: ${spDisp == null ? "—" : fmtNum(spDisp, 2)}`
    : "X: —  Y: —  θ: —  Speed: —";
  updateDeltaReadout();
  updateFloatingInfo(p, idx);
  refreshWatchGraphPanelData();
  refreshPinnedWatchPanels();
}

// -------- view controls (square maximize + pan/zoom) --------
function resetView() {
  panDelta = 0;
  viewZoom = 1;
  viewPanXpx = 0;
  viewPanYpx = 0;
}

function updateFieldLayout(preserveBounds = false) {
  canvas.style.position = "";
  canvas.style.left = "";
  canvas.style.top = "";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  if (!preserveBounds) {
    bounds = { ...FIELD_BOUNDS_IN };
    bounds.pad = FIELD_BOUNDS_IN.pad;
  }

  resizeCanvas();
  computeTransform();
  requestDrawAll();
}

function resetFieldPosition() {
  resetView();
  updateFieldLayout(false); // sets full-field bounds + square layout
  btnFit.innerHTML = `
  <svg width="12" height="12">
    <use href="${svgIconHref("icon-fit")}" xlink:href="${svgIconHref("icon-fit")}"></use>
  </svg>`;
  btnFit.title = "Recenter field (square)";
}

function clampZoom(z) {
  return clamp(z, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX);
}

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // world point under cursor (inches)
  const w0 = screenToWorld(mx, my);

  panDelta = (e.deltaY || 0);
  const zoomFactor = Math.exp(-panDelta * 0.0012);
  const newZoom = clampZoom(viewZoom * zoomFactor);

  viewZoom = newZoom;

  // adjust pan so (w0) stays under cursor
  // mx = w0.x*scale + offsetXpx, with scale/offset based on base*viewZoom and viewPan*
  const newScale = baseScale * viewZoom;
  const newOffXBase = baseOffsetXpx * viewZoom;
  const newOffYBase = baseOffsetYpx * viewZoom;
  const targetBase = rotateScreenPoint(mx, my, -fieldRotationRad);
  viewPanXpx = targetBase.x - (w0.x * newScale + newOffXBase);
  viewPanYpx = targetBase.y - (newOffYBase - w0.y * newScale);
  computeTransform();
  clampViewPanToVisibleMargin();
  requestDrawAll();
}, { passive: false });

canvas.addEventListener("pointerdown", (e) => {
  if (getAppMode() === "planning") {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (e.button === 2) {
      // right-drag to select multiple waypoints
      planSelecting = true;
      planSelectRect = { x0: mx, y0: my, x1: mx, y1: my };
      planPointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      requestDrawAll();
      return;
    }
    if (e.button !== 0) return;
    const hit = planHitTest(mx, my);
    const thetaHit = planThetaHandleHit(mx, my);
    const nodeHit = (hit < 0 && thetaHit < 0) ? hitTestPlanFieldNodeAtClient(e.clientX, e.clientY) : null;
    if (nodeHit) {
      hidePlanNodeTooltip({ immediate: true });
      selectPlanNode(nodeHit.node.id, { scrollSidebar: true });
      return;
    }
    if (thetaHit >= 0) {
      pushPlanUndo();
      planThetaDragging = true;
      planThetaDragIdx = thetaHit;
      planPointerId = e.pointerId;
      planThetaDragBase = Array.from(planSelectedSet).map((i) => ({ i, theta: planThetaDegAt(i) }));
      planThetaDragStart = planThetaDegAt(thetaHit);
      canvas.setPointerCapture(e.pointerId);
      updatePlanThetaFromPointer(thetaHit, mx, my);
      return;
    }
    const w = screenToWorld(mx, my);
    if (hit >= 0) {
      if (e.shiftKey) {
        planToggleSelection(hit);
        renderPlanList();
        updatePlanSelectionPanel();
        requestDrawAll();
        return;
      }
      if (!planSelectedSet.has(hit) || planSelectedSet.size > 1) {
        planSelectSingle(hit);
        renderPlanList();
        updatePlanSelectionPanel();
        requestDrawAll();
      }
    } else {
      pendingPlanCanvasClick = (isInField(w) && isPointInFieldBounds(w))
        ? { world: w, clearMultiSelection: planSelectedSet.size > 1 }
        : null;
      panArmed = true;
      isPanning = false;
      suppressNextClick = false;
      panPointerId = e.pointerId;
      panStart.x = mx;
      panStart.y = my;
      panStart.panX = viewPanXpx;
      panStart.panY = viewPanYpx;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    planDragging = true;
    planPointerId = e.pointerId;
    planDragStart.x = w.x;
    planDragStart.y = w.y;
    planDragOrig = Array.from(planSelectedSet).map((i) => ({ i, x: planWaypoints[i].x, y: planWaypoints[i].y }));
    canvas.setPointerCapture(e.pointerId);
    requestDrawAll();
    return;
  }

  if (e.button !== 0) return; // left only

  // Arm panning on any press. If this turns into a drag, we pan the view.
  // If it remains a click (little/no movement), existing click logic selects watches/track points.
  panArmed = true;
  isPanning = false;
  suppressNextClick = false;
  panPointerId = e.pointerId;

  const rect = canvas.getBoundingClientRect();
  panStart.x = e.clientX - rect.left;
  panStart.y = e.clientY - rect.top;
  panStart.panX = viewPanXpx;
  panStart.panY = viewPanYpx;

  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (getAppMode() === "planning") {
    if (planThetaDragging && planPointerId === e.pointerId) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      updatePlanThetaFromPointer(planThetaDragIdx, mx, my);
      return;
    }
    if (planSelecting && planPointerId === e.pointerId && planSelectRect) {
      const rect = canvas.getBoundingClientRect();
      planSelectRect.x1 = e.clientX - rect.left;
      planSelectRect.y1 = e.clientY - rect.top;
      renderPlanList();
      updatePlanSelectionPanel();
      requestDrawAll();
      return;
    }
    if (planDragging && planPointerId === e.pointerId) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = screenToWorld(mx, my);
      const dx = w.x - planDragStart.x;
      const dy = w.y - planDragStart.y;
      for (const p of planDragOrig) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        planWaypoints[p.i].x = clampPlanCoordX(nx);
        planWaypoints[p.i].y = clampPlanCoordY(ny);
      }
      renderPlanList();
      renderPlanningEventTimeline();
      updatePlanSelectionPanel();
      requestDrawAll();
      return;
    }
  }
  if (!panArmed) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const dx = x - panStart.x;
  const dy = y - panStart.y;
  const baseDelta = rotateScreenDelta(dx, dy, -fieldRotationRad);

  // Only start panning once the user has clearly dragged.
  if (!isPanning) {
    if (Math.abs(dx) + Math.abs(dy) <= 3) return;
    isPanning = true;
    suppressNextClick = true; // prevent "click" selection after a drag-pan
    canvas.style.cursor = "grabbing";

    // If a hover-preview was active, clear it so the view feels stable while panning.
    if (trackHover) {
      clearTrackHover(!trackLockActive);
      highlightPoseInList();
      updatePoseReadout();
    }
  }

  viewPanXpx = panStart.panX + baseDelta.x;
  viewPanYpx = panStart.panY + baseDelta.y;

  computeTransform();
  clampViewPanToVisibleMargin();
  requestDrawAll();
});

function endPan(e) {
  if (getAppMode() === "planning") {
    if (planThetaDragging && (planPointerId === e.pointerId || planPointerId == null)) {
      planThetaDragging = false;
      planThetaDragIdx = -1;
      planThetaDragBase = null;
      try { canvas.releasePointerCapture(planPointerId ?? e.pointerId); } catch { }
      planPointerId = null;
      planChanged();
      return;
    }
    if (planSelecting && (planPointerId === e.pointerId || planPointerId == null)) {
      planSelecting = false;
      planRectSelect();
      planChanged();
      planSelectRect = null;
      try { canvas.releasePointerCapture(planPointerId ?? e.pointerId); } catch { }
      planPointerId = null;
      requestDrawAll();
      return;
    }
    if (planDragging && (planPointerId === e.pointerId || planPointerId == null)) {
      planDragging = false;
      try { canvas.releasePointerCapture(planPointerId ?? e.pointerId); } catch { }
      planPointerId = null;
      planChanged();
      return;
    }
  }
  if (!panArmed) return;
  const wasPanning = isPanning;
  panArmed = false;
  isPanning = false;
  canvas.style.cursor = "";
  try { canvas.releasePointerCapture(panPointerId ?? e.pointerId); } catch { }
  panPointerId = null;

  if (getAppMode() === "planning") {
    const pending = pendingPlanCanvasClick;
    pendingPlanCanvasClick = null;
    if (e.type !== "pointercancel" && !wasPanning && pending) {
      if (pending.clearMultiSelection) {
        planSetSelection([]);
        planChanged();
        requestDrawAll();
        return;
      }
      pushPlanUndo();
      const previous = planWaypoints[planWaypoints.length - 1];
      planWaypoints.push({
        x: clampPlanCoordX(pending.world.x),
        y: clampPlanCoordY(pending.world.y),
        theta: 0,
        speed: previous ? readPlanSpeed(previous.speed, 127) : 127,
      });
      planSelectSingle(planWaypoints.length - 1);
      planChanged();
      planDragging = false;
      renderPlanList();
      updatePlanSelectionPanel();
      requestDrawAll();
    }
  }
}

canvas.addEventListener("pointerup", endPan);
canvas.addEventListener("pointercancel", endPan);
canvas.addEventListener("contextmenu", (e) => {
  if (getAppMode() === "planning") e.preventDefault();
});

// -------- track hover/lock --------
function pickTrackPose(clientX, clientY) {
  if (!rawPoses.length) return null;
  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;

  const poses = getPosesInches();
  if (poses.length < 2) return null;

  let best = { dist2: Infinity, i: -1, alpha: 0 };

  for (let i = 0; i < poses.length - 1; i++) {
    const a = poses[i], b = poses[i + 1];
    const pa = worldToScreen(a.x, a.y);
    const pb = worldToScreen(b.x, b.y);

    const vx = pb.x - pa.x, vy = pb.y - pa.y;
    const wx = mx - pa.x, wy = my - pa.y;
    const vv = vx * vx + vy * vy || 1;
    let alpha = (wx * vx + wy * vy) / vv;
    alpha = clamp(alpha, 0, 1);

    const px = pa.x + alpha * vx;
    const py = pa.y + alpha * vy;
    const dx = mx - px, dy = my - py;
    const d2 = dx * dx + dy * dy;

    if (d2 < best.dist2) best = { dist2: d2, i, alpha };
  }

  const dist = Math.sqrt(best.dist2);
  if (dist > HOVER_PIXEL_TOL + TRACK_HOVER_PAD_PX) return null;

  const i0 = best.i, i1 = best.i + 1;
  const p0 = poses[i0], p1 = poses[i1];
  const a = best.alpha;

  // NEW: compute interpolated time from rawPoses (not the inches-converted array)
  const rt0 = rawPoses[i0]?.t ?? 0;
  const rt1 = rawPoses[i1]?.t ?? rt0;
  const tMs = rt0 + a * (rt1 - rt0);

  const pose = {
    t: tMs, // <-- was null
    x: p0.x + (p1.x - p0.x) * a,
    y: p0.y + (p1.y - p0.y) * a,
    theta: angLerpDeg(p0.theta ?? 0, p1.theta ?? 0, a),
    l_vel: (p0.l_vel ?? 0) + ((p1.l_vel ?? 0) - (p0.l_vel ?? 0)) * a,
    r_vel: (p0.r_vel ?? 0) + ((p1.r_vel ?? 0) - (p0.r_vel ?? 0)) * a,
    speed_raw: (p0.speed_raw ?? 0) + ((p1.speed_raw ?? 0) - (p0.speed_raw ?? 0)) * a,
    speed_norm: (p0.speed_norm ?? 0) + ((p1.speed_norm ?? 0) - (p0.speed_norm ?? 0)) * a,
  };

  const nearestIdx = (a < 0.5) ? i0 : i1;
  return { pose, nearestIdx };
}

function clearTrackHover(restore) {
  trackHover = null;
  if (restore && trackHoverSavedIndex != null) {
    selectedIndex = trackHoverSavedIndex;
    trackHoverSavedIndex = null;
  }
}

function clearTrackLock() {
  trackLockActive = false;
  trackLockPose = null;
  trackLockIndex = null;
}

// -------- watch hit test on field --------
function hitTestWatchAtClient(clientX, clientY) {
  if (!watchMarkers.length) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let best = null;
  let bestD2 = Infinity;
  for (const m of watchMarkers) {
    if (!isWatchMarkerVisible(m)) continue;
    if (!m.pose) continue;
    const p = worldToScreen(m.pose.x, m.pose.y);
    const baseDiameter = hoverWatch === m ? 11.2 : 8.4;
    const tol = Math.max(8, scaledViewingFieldRadius(baseDiameter) + 5);
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= tol * tol && d2 <= bestD2) { bestD2 = d2; best = m; }
  }
  return best;
}

function hitTestWaypointAtClient(clientX, clientY) {
  if (!waypoints.length) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let best = null;
  let bestD2 = Infinity;

  for (const waypoint of waypoints) {
    if (!waypointFilterMatches(waypoint)) continue;
    const p = worldToScreen(waypoint.target.x, waypoint.target.y);
    const isSelected = selectedWaypointId === waypoint.id;
    const baseDiameter = isSelected ? 15 : 12;
    const tol = Math.max(9, scaledViewingFieldRadius(baseDiameter) + 6);
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= tol * tol && d2 <= bestD2) {
      bestD2 = d2;
      best = waypoint;
    }
  }
  return best;
}

// -------- playback --------
let playPose = null;

function pause() {
  if (!playing) return;
  playing = false;
  btnPlay.textContent = "▶";
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  playPose = null;
  lastWall = null;
  setStatus(`Paused at time ${formatNumberString((rawPoses[selectedIndex]?.t ?? 0) / 1000, 1, "0")}s`);
}

function planPause() {
  planPlaying = false;
  btnPlay.textContent = "▶";
  if (planRaf) cancelAnimationFrame(planRaf);
  planRaf = null;
  planLastWall = null;
}

function play() {
  if (!rawPoses.length) return;
  if (window.__live && window.__live.streaming) { setStatus("Playback disabled while livestreaming."); return; }

  const tMin = rawPoses[0]?.t ?? 0;
  const tMax = rawPoses[rawPoses.length - 1]?.t ?? tMin;
  if (selectedIndex >= rawPoses.length - 1 || (typeof playTimeMs === "number" && playTimeMs >= tMax)) {
    selectedIndex = 0;
    playTimeMs = tMin;
    playPose = null;
  }

  // starting playback clears track lock to avoid confusing states
  clearTrackHover(true);
  clearTrackLock();
  selectedWatch = null;
  selectedLogTime = null;
  timelineHoverSaved = null;
  setStatus(`Playing from time ${formatNumberString((rawPoses[selectedIndex]?.t ?? 0) / 1000, 1, "0")}s`);

  const tStart = rawPoses[selectedIndex]?.t;
  playTimeMs = (typeof tStart === "number") ? tStart : (rawPoses[0]?.t ?? 0);

  playing = true;
  btnPlay.textContent = "⏸";
  lastWall = performance.now();

  const tick = (now) => {
    if (!playing) return;
    const dtWall = now - lastWall;
    lastWall = now;
    // Constant-time playback (1x base, scaled only by playRate)
    playTimeMs += dtWall * playRate;

    if (playTimeMs >= tMax) {
      playTimeMs = tMax;
      playPose = interpolatePoseAtTime(playTimeMs);
      selectedIndex = rawPoses.length - 1;
      updatePoseReadout();
      requestDrawAll();
      pause();
      return;
    }

    playPose = interpolatePoseAtTime(playTimeMs);
    selectedIndex = findFloorIndexByTime(playTimeMs);

    // Highlight the most recent watch hit without overriding the user"s
    // collapsed/expanded state for the Watches panel.
    const last = lastWatchAtTime(playTimeMs);
    if (last && (!selectedWatch || selectedWatch.marker?.t !== last.t)) {
      selectedWatch = { marker: last };
      highlightWatchInList(last.t, false);
    }

    updatePoseReadout();
    requestDrawAll();
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
}

function planPlay() {
  if (planWaypoints.length < 2) return;
  const total = planTotalLength();
  if (planPlayDist >= total) {
    planPlayDist = 0;
    setPlanDist(planPlayDist);
  }
  planPlaying = true;
  btnPlay.textContent = "⏸";
  planLastWall = performance.now();
  const tick = (now) => {
    if (!planPlaying) return;
    const dtWall = (now - planLastWall) / 1000;
    planLastWall = now;
    const total = planTotalLength();
    const planSpeed = getPlanSpeedUnitsPerSecAtDist(planPlayDist);
    planPlayDist += dtWall * planSpeed * (playRate / 2);
    if (planPlayDist >= total) {
      planPlayDist = total;
      planPause();
    } else planRaf = requestAnimationFrame(tick);
    setPlanDist(planPlayDist);
  };
  planRaf = requestAnimationFrame(tick);
}

// -------- timeline interactions --------
function timelineMousePos(e) {
  const rect = timelineCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function isInsideTimelineC(cursor) {
  if (!cursor) return false;
  const x = (typeof cursor.clientX === "number") ? cursor.clientX : cursor.x;
  const y = (typeof cursor.clientY === "number") ? cursor.clientY : cursor.y;
  if (typeof x !== "number" || typeof y !== "number") return false;

  const isPlanning = getAppMode() === "planning";
  const canvasEl = isPlanning ? planningTimelineCanvas : timelineCanvas;
  if (!canvasEl) return false;
  if (!isPlanning && timelineBar?.classList.contains("isCollapsed")) return false;

  const rect = canvasEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isInsideFieldC(cursor) {
  if (!cursor) return false;
  const x = (typeof cursor.clientX === "number") ? cursor.clientX : cursor.x;
  const y = (typeof cursor.clientY === "number") ? cursor.clientY : cursor.y;
  if (typeof x !== "number" || typeof y !== "number") return false;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

timelineCanvas.addEventListener("mousemove", (e) => {
  if (!data || playing || !rawPoses.length) return;

  const { x, y } = timelineMousePos(e);
  const hit = timelinePickWatchDot(x, y);
  timelineCanvas.style.cursor = hit ? "pointer" : "crosshair";

  if (timelineHoverSaved == null) {
    timelineHoverSaved = {
      index: selectedIndex,
      lockActive: trackLockActive,
      lockPose: trackLockPose,
      lockIndex: trackLockIndex
    };
  }

  // timeline hover always previews, even if track lock is active
  hoverTimelineTime = xToTime(x);
  updatePoseReadout();
  requestDrawAll();
});

timelineCanvas.addEventListener("mouseleave", () => {
  if (!data || playing) return;
  hoverTimelineTime = null;
  timelineCanvas.style.cursor = "default";

  if (timelineHoverSaved != null) {
    selectedIndex = timelineHoverSaved.index;
    trackLockActive = timelineHoverSaved.lockActive;
    trackLockPose = timelineHoverSaved.lockPose;
    trackLockIndex = timelineHoverSaved.lockIndex;
    timelineHoverSaved = null;
  }

  updatePoseReadout();
  requestDrawAll();
});

timelineCanvas.addEventListener("mousedown", (e) => {
  if (!data || playing || !rawPoses.length) return;
  if (window.__live && window.__live.streaming) return;
  const { x, y } = timelineMousePos(e);

  const hit = timelinePickWatchDot(x, y);
  if (hit) {
    selectWatchMarker(hit, true, { x: e.clientX, y: e.clientY });
    return;
  }

  // lock selection at time (clears track lock)
  clearTrackHover(true);
  clearTrackLock();
  selectedWatch = null;
  selectedLogTime = null;
  selectedWaypointId = null;
  selectedWaypointEventTime = null;
  highlightWaypointInList(null, null, false);

  const t = xToTime(x);
  selectedIndex = findFloorIndexByTime(t);
  lastPoseIndex = selectedIndex;
  hoverTimelineTime = null;
  timelineHoverSaved = null;

  highlightPoseInList();
  updatePoseReadout();
  requestDrawAll();
});

if (planningTimelineCanvas) {
  const onPlanScrub = (e) => {
    const rect = planningTimelineCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setPlanDist(planDistFromX(x));
  };
  planningTimelineCanvas.addEventListener("pointerdown", (e) => {
    if (getAppMode() !== "planning") return;
    planScrubbing = true;
    planningTimelineCanvas.setPointerCapture(e.pointerId);
    onPlanScrub(e);
  });
  planningTimelineCanvas.addEventListener("pointermove", (e) => {
    if (!planScrubbing) return;
    onPlanScrub(e);
  });
  planningTimelineCanvas.addEventListener("pointerup", (e) => {
    if (!planScrubbing) return;
    planScrubbing = false;
    try { planningTimelineCanvas.releasePointerCapture(e.pointerId); } catch { }
  });
  planningTimelineCanvas.addEventListener("pointercancel", () => {
    planScrubbing = false;
  });
}

// -------- field interactions --------
canvas.addEventListener("mousemove", (e) => {
  updateCursorPillsFromClient(e.clientX, e.clientY);
});

canvas.addEventListener("mousemove", (e) => {
  if (getAppMode() === "planning") {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const waypointHit = planHitTest(mx, my) >= 0;
    const thetaHandleHit = planThetaHandleHit(mx, my) >= 0;
    const nodeHit = (!waypointHit && !thetaHandleHit) ? hitTestPlanFieldNodeAtClient(e.clientX, e.clientY) : null;
    if (nodeHit) {
      if (planFieldHoverNodeId !== nodeHit.node.id) {
        planFieldHoverNodeId = nodeHit.node.id;
        requestDrawAll();
      }
      canvas.style.cursor = "pointer";
      updatePlanNodeTooltip(nodeHit.tooltipText, e.clientX, e.clientY);
    } else {
      const hadHover = planFieldHoverNodeId != null;
      planFieldHoverNodeId = null;
      canvas.style.cursor = "";
      hidePlanNodeTooltip();
      if (hadHover) requestDrawAll();
    }
    return;
  }
  if (!data || playing || isPanning) return;

  // watch hover has priority
  const hw = hitTestWatchAtClient(e.clientX, e.clientY);
  if (hw) {
    hoverWatch = hw;
    canvas.style.cursor = "pointer";
    requestDrawAll();
    return;
  } else {
    if (hoverWatch) { hoverWatch = null; requestDrawAll(); }
    canvas.style.cursor = "";
  }

  const waypointHit = hitTestWaypointAtClient(e.clientX, e.clientY);
  if (waypointHit) {
    canvas.style.cursor = "pointer";
    return;
  }

  const hit = pickTrackPose(e.clientX, e.clientY);

  if (!hit) {
    // no field hit => remove timeline hover preview too
    hoverTimelineTime = null;

    if (trackHover) {
      clearTrackHover(!trackLockActive);
      highlightPoseInList();
      updatePoseReadout();
      requestDrawAll();
    }
    return;
  }

  if (trackHoverSavedIndex == null) trackHoverSavedIndex = selectedIndex;
  trackHover = { t: hit.pose.t, idxNearest: hit.nearestIdx };

  // Drive the timeline grey line from the hovered field pose
  hoverTimelineTime = hit.pose.t ?? null;

  updatePoseReadout();
  requestDrawAll();
});

canvas.addEventListener("mouseleave", () => {
  setCursorPills("Cursor: —");
  if (getAppMode() === "planning") {
    const hadHover = planFieldHoverNodeId != null;
    planFieldHoverNodeId = null;
    hidePlanNodeTooltip({ immediate: true });
    canvas.style.cursor = "";
    if (hadHover) requestDrawAll();
    return;
  }
  hoverWatch = null;
  // ensure timeline hover preview can"t "stick"
  hoverTimelineTime = null;
  timelineHoverSaved = null;
  canvas.style.cursor = "";
  if (trackHover) {
    clearTrackHover(!trackLockActive);
    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
  }
});

canvas.addEventListener("click", (e) => {
  if (getAppMode() === "planning") return;
  if (!data) return;
  if (suppressNextClick) { suppressNextClick = false; return; }

  const isLiveStreaming = window.__live && window.__live.streaming;
  if (!isLiveStreaming) {
    const hw = hitTestWatchAtClient(e.clientX, e.clientY);
    if (hw) {
      selectWatchMarker(hw, true, { x: e.clientX, y: e.clientY });
      return;
    }
  }

  const waypointHit = hitTestWaypointAtClient(e.clientX, e.clientY);
  if (waypointHit) {
    if (selectedWaypointId === waypointHit.id) {
      clearWaypointSelection();
      requestDrawAll();
      return;
    }
    if (waypointFilter && waypointFilter.value === "all") {
      renderWaypointList();
    }
    selectWaypointEvent(waypointHit, waypointHit.latestActiveEvent, true);
    return;
  }

  if (playing) return;
  if (isLiveStreaming) return;

  const hit = pickTrackPose(e.clientX, e.clientY);
  if (hit) {
    // lock to clicked position
    pause();
    selectedWatch = null;
    selectedLogTime = null;
    selectedWaypointId = null;
    selectedWaypointEventTime = null;
    highlightWaypointInList(null, null, false);

    trackLockActive = true;
    trackLockPose = hit.pose;
    trackLockIndex = hit.nearestIdx;

    selectedIndex = hit.nearestIdx;
    lastPoseIndex = selectedIndex;
    clearTrackHover(false);
    trackHoverSavedIndex = null;

    // Show locked pos on timeline
    if (timelineHoverSaved == null) {
      timelineHoverSaved = {
        index: selectedIndex,
        lockActive: trackLockActive,
        lockPose: hit.pose,
        lockIndex: trackLockIndex
      };
    }

    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
    return;
  }

  // click off-track unlocks
  if (trackLockActive) {
    clearTrackLock();
    clearWaypointSelection();
    setStatus(`Unlocked track lock.`);
    updatePoseReadout();
    requestDrawAll();
  } else if (selectedWaypointId != null) {
    clearWaypointSelection();
    requestDrawAll();
  }
});

canvas.addEventListener("dblclick", (e) => {
  if (getAppMode() !== "planning") return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (planHitTest(mx, my) >= 0 || planThetaHandleHit(mx, my) >= 0) return;
  const nodeHit = hitTestPlanFieldNodeAtClient(e.clientX, e.clientY);
  if (!nodeHit) return;
  e.preventDefault();
  openPlanNodeEditModal(nodeHit.node.id);
});


// -------- Left sidebar controls (Stop / Connect / Refresh) --------
// Live streaming model:
// - Connect toggles the WebSocket connection (/ws)
// - Start/Stop is the existing "Stop" button (it becomes a toggle)
//   * When disconnected: disabled, tooltip "Starts streaming. Connect to start."
//   * When connected & idle: shows "Start"
//   * When streaming: shows "Stop"
//   * Cmd/Ctrl + click Stop => force kill (/api/kill), if server supports it
//
// Output always appends into #liveWin.

const liveWinEl = document.getElementById("liveWin");
const btnLeftStopEl = document.getElementById("btnLeftStop");
const btnLeftConnectEl = document.getElementById("btnLeftConnect");
const btnLeftRefreshEl = document.getElementById("btnLeftRefresh");
const leftRefreshIntervalEl = document.getElementById("leftRefreshInterval");

let leftConnected = false;
let leftStreaming = false;
const liveSocket = new LiveWebSocketClient();
const livePendingBuffer = new LivePendingBuffer();
const liveConsole = new LiveConsoleBuffer(liveWinEl);
const liveActionGate = new LiveActionGate(400, 6000, () => {
  setLeftUi();
  liveAppendLine("[UI] Action timed out; UI unlocked.");
});

function setLeftActionInFlight(v) {
  liveActionGate.setInFlight(v);
}

function withTimeout(promise, ms, label) {
  let t = null;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([
    promise.finally(() => { if (t) clearTimeout(t); }),
    timeout,
  ]);
}

// In livestream mode, optionally keep the robot snapped to the newest pose when not hovering the timeline.
// Toggled with Space (while connected).
let liveAutoFollowHead = true;

let leftRefreshTimer = null;
let leftRefreshMs = parseInt(leftRefreshIntervalEl?.value || "500", 10) || 500;

// --- Live incremental processing ---
// Buffer incoming WS lines; doLeftRefresh consumes them and updates poses/watches.
// Track how much we"ve already integrated into rawPoses/watches
let liveLastPoseT = null; // last pose timestamp integrated
let liveLastPoseCount = 0;
let liveLastWatchCount = 0;
let liveLastRenderAt = 0;
let liveDebugEnabled = false;
let liveReqId = 0;

function dbgLive(msg) {
  if (!liveDebugEnabled) return;
  liveAppendLine(`[DBG] ${msg}`);
  void logToBackend("DEBUG", msg, "live");
}

function clearLivePending() {
  livePendingBuffer.clear();
}

function parseLiveLineIntoState(line) {
  const s = stripToTag(line);
  if (!s) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };

  // POSE DATA: [POSE],millis,x,y,theta,l_vel,r_vel
  if (s.startsWith("[POSE],")) {
    const parts = s.split(",");
    if (parts.length < 7) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const t = toNumMaybe(parts[1]);
    const x = toNumMaybe(parts[2]);
    const y = toNumMaybe(parts[3]);
    const theta = toNumMaybe(parts[4]);
    const l_vel = toNumMaybe(parts[5]);
    const r_vel = toNumMaybe(parts[6]);
    if (t == null || x == null || y == null) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };

    // De-dup / monotonic guard (common if stream repeats)
    if (liveLastPoseT != null && t <= liveLastPoseT) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };

    // Derive a "speed" (raw) from wheel velocities if present
    const lv = (typeof l_vel === "number" && isFinite(l_vel)) ? l_vel : 0;
    const rv = (typeof r_vel === "number" && isFinite(r_vel)) ? r_vel : 0;
    const speed_raw = (Math.abs(lv) + Math.abs(rv)) / 2;

    rawPoses.push({
      t, x, y,
      theta: (theta == null) ? 0 : theta,
      l_vel: (l_vel == null) ? null : l_vel,
      r_vel: (r_vel == null) ? null : r_vel,
      speed_raw,
      speed_norm: 0,
    });
    telemetryMetrics.totalPosesReceived += 1;
    liveLastPoseT = t;
    return { posesAdded: 1, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
  }

  // WATCH (new): [WATCH],millis,level,id,label,value (value may contain commas)
  if (s.startsWith("[WATCH],")) {
    const parts = s.split(",");
    if (parts.length < 5) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const t = toNumMaybe(parts[1]);
    if (t == null) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const level = parts[2] ?? "INFO";
    let id = null;
    let label = "";
    let value = "";

    // Prefer the new schema when an integer id is present in field 4.
    if (parts.length >= 6) {
      const idCandidate = Number(parts[3]);
      if (Number.isInteger(idCandidate)) {
        id = idCandidate;
        label = parts[4] ?? "";
        value = parts.slice(5).join(",");
      } else {
        label = parts[3] ?? "";
        value = parts.slice(4).join(",");
      }
    } else {
      label = parts[3] ?? "";
      value = parts.slice(4).join(",");
    }

    label = label.replaceAll(":", "");
    const nextWatch = { t, id, level, label, value };
    nextWatch.visible = currentVisibilityForWatch(nextWatch);
    watches.push(nextWatch);
    telemetryMetrics.totalWatchesReceived += 1;
    return { posesAdded: 0, watchesAdded: 1, logsAdded: 0, waypointsAdded: 0 };
  }

  if (s.startsWith("[LOG],")) {
    const parts = s.split(",");
    if (parts.length < 4) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const t = toNumMaybe(parts[1]);
    if (t == null) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const parsed = normalizeSystemLogMessage(parts.slice(3).join(","));
    if (!parsed.message) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    logs.push({
      t,
      level: normalizeLogLevel(parts[2]),
      label: "",
      value: parsed.message,
      message: parsed.message,
      isSystem: parsed.isSystem,
    });
    telemetryMetrics.totalLogsReceived += 1;
    return { posesAdded: 0, watchesAdded: 0, logsAdded: 1, waypointsAdded: 0 };
  }

  if (s.startsWith("[WPOINT],")) {
    const parsed = parseWaypointLine(s);
    if (!parsed.ok) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const event = parsed.waypointEvent;
    if (event.type === "CREATED") {
      const isRetriggerable = !!event.params?.retriggerable;
      telemetryMetrics.totalWaypointsReceived += 1;
      waypointsById.set(event.id, {
        id: event.id,
        name: event.name,
        createdTime: event.t,
        createdEvent: event,
        target: { x: event.params.tarX, y: event.params.tarY, theta: event.params.tarT },
        retriggerable: isRetriggerable,
        events: [event],
        active: true,
        terminalEvent: null,
        latestEvent: event,
        latestActiveEvent: event,
      });
      waypoints = Array.from(waypointsById.values()).sort((a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0));
      return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 1 };
    }

    const waypoint = waypointsById.get(event.id);
    if (!waypoint) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };

    telemetryMetrics.totalWaypointsReceived += 1;
    waypoint.events.push(event);
    waypoint.events.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    waypoint.latestEvent = event;
    if (event.type === "TIMEDOUT" || (!waypoint.retriggerable && event.type === "REACHED")) {
      waypoint.active = false;
      waypoint.terminalEvent = event;
    }
    if (!waypoint.terminalEvent || event.t <= waypoint.terminalEvent.t) {
      waypoint.latestActiveEvent = event;
    }
    waypoints = Array.from(waypointsById.values()).sort((a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0));
    return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 1 };
  }

  return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
}

function liveAppendLine(s) {
  liveConsole.appendLine(String(s));
}

function resetLiveWin() {
  liveConsole.reset();
}

function parseWaypointLine(s) {
  if (!s.startsWith("[WPOINT],")) return { ok: false, malformed: false };
  const commas = [];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === ",") commas.push(i);
  }
  if (commas.length < 4) return { ok: false, malformed: true };

  const fields = [];
  let start = 0;
  const headerFieldCount = 5;
  const splitCount = Math.min(commas.length, headerFieldCount);
  for (let i = 0; i < splitCount; i += 1) {
    const end = commas[i];
    fields.push(s.slice(start, end));
    start = end + 1;
  }
  if (fields.length < headerFieldCount) {
    fields.push(s.slice(start));
    while (fields.length < headerFieldCount) fields.push("");
  } else {
    fields.push(s.slice(start));
  }

  const [, tRaw, typeRaw, idRaw, nameRaw, paramsText] = fields;
  const t = toNumMaybe(tRaw);
  const type = normalizeWaypointType(typeRaw);
  const id = Number(idRaw);
  const name = String(nameRaw || "").trim();
  if (t == null || !type || !Number.isInteger(id) || !name) return { ok: false, malformed: true };

  const params = parseWaypointParams(type, paramsText);
  if (!params) return { ok: false, malformed: true };

  return {
    ok: true,
    malformed: false,
    waypointEvent: { t, type, id, name, params },
  };
}

function setLeftUi() {
  applyLiveButtonState({
    connectButton: btnLeftConnect,
    startStopButton: btnLeftStop,
    refreshButton: btnLeftRefreshEl,
    playButton: btnPlay,
    fileButton: btnFile,
  }, {
    connected: leftConnected,
    streaming: leftStreaming,
    actionInFlight: liveActionGate.active,
  });
  updateConnectButtonState();
  updateExportButtonAvailability();
}

function leftSetUI(reason) {
  setLeftUi();
  if (window.__live) { window.__live.connected = !!leftConnected; window.__live.streaming = !!leftStreaming; }
  if (reason) liveAppendLine(`[UI] ${reason}`);
}

function canRunLeftAction() {
  return liveActionGate.canRun();
}

async function apiPost(path, timeoutMs = 5000) {
  if (!path) return;
  if (path === "/no HTTP/1.1" || path === "/ HTTP/1.1") return;

  // ensure leading slash
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!(await ensureBridgeOriginReady())) {
    dbgLive(`apiPost: ${p} blocked (origin not ready)`);
    return { ok: false, status: 0, json: { status: "bridge origin not ready" } };
  }
  if (!(await waitForBackendReady(4000, 200))) {
    dbgLive(`apiPost: ${p} blocked (backend not ready)`);
    return { ok: false, status: 0, json: { status: "backend not ready" } };
  }
  const origin = ORIGIN;
  const url = `${origin}${p}`;
  const reqId = ++liveReqId;
  dbgLive(`apiPost#${reqId}: POST ${url}`);

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: "POST", signal: controller.signal });
    clearTimeout(t);
    // Best-effort JSON; don"t crash UI if server returns non-JSON or 404
    let json = null;
    try { json = await res.json(); } catch (e) { }
    dbgLive(`apiPost#${reqId}: response ${res.status}`);
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    const msg = (e?.name === "AbortError") ? "request timeout" : (e?.message || "request failed");
    dbgLive(`apiPost#${reqId}: error ${msg}`);
    return { ok: false, status: 0, json: { status: msg } };
  }
}

async function connectLeft() {
  dbgLive("connectLeft: begin");
  if (prosDirInput && prosDirInput.value) {
    await updateProsDir(prosDirInput.value);
  }

  if (!prosDirValid) {
    liveAppendLine("Something went wrong. Try restarting the application or waiting.");
    setStatus("Cannot connect: set a valid PROS directory in Settings first.");
    return;
  }
  if (!(await ensureBridgeOriginReady()) || ORIGIN == null || WS_ORIGIN == null) {
    leftSetUI("Child process Bridge.py was not given a port. Live streaming cannot start.");
    return;
  }
  if (!(await waitForBackendReady(6000, 200))) {
    leftSetUI("Backend is still starting. Please try again in a moment.");
    return;
  }
  pause();
  if (leftStreaming) {
    await stopStreaming(false, false);
  }

  if (liveSocket.connected) return;
  liveSocket.connect(`${WS_ORIGIN}/ws`, {
    onOpen: () => {
      leftConnected = true;
      leftSetUI("Connected");
      startLeftRefresh();
    },
    onMessage: (raw) => {
      const trimmed = stripToTag(raw);
      const isStreamData = !!trimmed;
      if (trimmed) {
        livePendingBuffer.push(trimmed);
      }

      if (!isStreamData) {
        liveAppendLine("\x1b[31m|\x1b[0m " + raw);
      } else {
        const malformedWaypoint = parseWaypointLine(trimmed).malformed;
        if (!malformedWaypoint) {
          liveAppendLine("\x1b[32m|\x1b[0m " + raw);
        } else {
          liveAppendLine("\x1b[31m|\x1b[0m " + raw);
        }
      }
    },
    onClose: () => {
      const wasStreaming = leftStreaming;
      leftConnected = false;
      leftStreaming = false;
      if (wasStreaming) liveTelemetry.streamingStopped();
      else liveTelemetry.resetCurrentStreamingSession();
      if (window.__live) { window.__live.connected = false; window.__live.streaming = false; }
      stopLeftRefresh();
      leftSetUI("Disconnected");
      dbgLive("ws: close");
    },
    onError: () => {
      // Errors often precede close; keep it gentle.
      liveAppendLine("[WS] error");
    },
  });

  leftSetUI("Connecting...");
}

async function disconnectLeft() {
  dbgLive("disconnectLeft: begin");
  const wasStreaming = leftStreaming;
  let stopHandled = false;
  if (wasStreaming) {
    stopHandled = await stopStreaming(false, false);
  }
  liveSocket.close();
  leftConnected = false;
  leftStreaming = false;
  if (wasStreaming && !stopHandled) await liveTelemetry.streamingStopped();
  else liveTelemetry.resetCurrentStreamingSession();
  stopLeftRefresh();
  leftSetUI("Disconnected");
}

function stopLeftRefresh() {
  if (leftRefreshTimer) {
    clearInterval(leftRefreshTimer);
    leftRefreshTimer = null;
  }
}

function startLeftRefresh() {
  stopLeftRefresh();
  if (!leftConnected) return;
  if (!leftRefreshMs || leftRefreshMs <= 0) return;
  dbgLive(`startLeftRefresh: ${leftRefreshMs}ms`);
  leftRefreshTimer = setInterval(() => {
    doLeftRefresh();
  }, leftRefreshMs);
}

let lastPoseIndex = 0;
async function doLeftRefresh() {
  // During live mode, refresh means: integrate any pending WS lines into
  // rawPoses/watches, then update derived state and redraw.
  if (!leftConnected) return;
  if (!leftStreaming) {
    // "Stop" pauses drawing; do not let WS backlog grow unbounded.
    clearLivePending();
    return;
  }

  const t0 = performance.now();

  if (!data) {
    data = { poses: [], watches: [], logs: [], waypoints: [], meta: {} };
  }

  const batch = livePendingBuffer.batch();
  if (!batch) {
    // Nothing new; still ensure we snap to latest if appropriate
    if (liveAutoFollowHead && rawPoses.length && hoverTimelineTime == null && !playing && !trackLockActive && !(trackHover && (trackHover.pose || trackHover.t))) {
      selectedIndex = rawPoses.length - 1;
      lastPoseIndex = selectedIndex;
      updatePoseReadout();
    } else if (!liveAutoFollowHead && rawPoses.length && hoverTimelineTime == null && !playing && !trackLockActive && !(trackHover && (trackHover.pose || trackHover.t))) {
      selectedIndex = lastPoseIndex;
    }
    return;
  }

  let posesAdded = 0;
  let watchesAdded = 0;
  let logsAdded = 0;
  let waypointsAdded = 0;

  for (let i = batch.startIndex; i < batch.endIndex; i++) {
    const r = parseLiveLineIntoState(batch.lines[i]);
    posesAdded += r.posesAdded;
    watchesAdded += r.watchesAdded;
    logsAdded += r.logsAdded;
    waypointsAdded += r.waypointsAdded;
  }
  livePendingBuffer.markConsumed(batch.endIndex);

  const hasNewData = posesAdded > 0 || watchesAdded > 0 || logsAdded > 0 || waypointsAdded > 0;
  if (!hasNewData) return;

  // Keep watches sorted (poses are appended monotonically by t)
  if (watchesAdded > 0) {
    watches.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  }
  if (logsAdded > 0) {
    logs.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  }
  if (waypointsAdded > 0) {
    waypoints.sort((a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0));
  }

  // Recompute derived fields incrementally for newly appended poses.
  if (posesAdded > 0) computeSpeedNormRange(rawPoses.length - posesAdded);
  data.poses = rawPoses;
  data.watches = watches;
  data.logs = logs;
  data.waypoints = waypoints;

  if (watchesAdded > 0) {
    recomputeWatchMarkers();
    rebuildWatchMarkersByTime();
    renderWatchFilter();
    renderWatchList();
    refreshPinnedWatchPanels();
  }

  if (logsAdded > 0) {
    renderLogList();
  }
  if (waypointsAdded > 0) {
    renderWaypointFilter();
    renderWaypointList();
  }

  if (posesAdded > 0) {
    renderPoseList();
    // If not hovering timeline/track, keep the robot on the most recent pose.
    if (liveAutoFollowHead && hoverTimelineTime == null && !playing && !trackLockActive && !(trackHover && (trackHover.pose || trackHover.t))) {
      selectedIndex = rawPoses.length - 1;
    } else if (!liveAutoFollowHead && rawPoses.length && hoverTimelineTime == null && !playing && !trackLockActive && !(trackHover && (trackHover.pose || trackHover.t))) {
      selectedIndex = lastPoseIndex;
    }
    highlightPoseInList();
  }

  updatePoseReadout();
  if (
    rawPoses.length !== liveLastPoseCount
    || watches.length !== liveLastWatchCount
    || livePendingBuffer.consumedIndex !== liveLastRenderAt
  ) {
    requestDrawAll();
    liveLastPoseCount = rawPoses.length;
    liveLastWatchCount = watches.length;
    liveLastRenderAt = livePendingBuffer.consumedIndex;
  }
  scheduleSavedPathsSave();

  const t1 = performance.now();
  const dt = t1 - t0;
  if (dt > 100) {
    dbgLive(`doLeftRefresh: ${formatNumberString(dt, 1, "0")}ms (poses=${rawPoses.length}, watches=${watches.length}, pending=${livePendingBuffer.pendingCount()})`);
  }
}


async function startStreaming() {
  dbgLive("startStreaming: begin");
  liveTelemetry.resetCurrentStreamingSession();
  let r;
  try {
    r = await withTimeout(apiPost("/api/start"), 5000, "start");
  } catch (e) {
    liveAppendLine(`[api] start failed (${e?.message || e})`);
    // Retry once after reconnecting
    try {
      await disconnectLeft();
      await connectLeft();
      r = await withTimeout(apiPost("/api/start"), 5000, "start");
    } catch (e2) {
      return false;
    }
    if (!r || !r.ok) return false;
    leftStreaming = true;
    liveTelemetry.streamingStarted();
    leftSetUI("Streaming started");
    dbgLive("startStreaming: ok (retry)");
    return true;
  }
  if (!r.ok) {
    liveAppendLine(`[api] start failed (${r.status})`);
    liveAppendLine("Backend may not be working. Try restarting the application.");
    dbgLive(`startStreaming: failed status=${r.status}`);
    return false;
  }
  // New session: allow timestamps to restart from 0 without being dropped.
  liveLastPoseT = null;
  leftStreaming = true;
  liveTelemetry.streamingStarted();
  leftSetUI("Streaming started");
  dbgLive(`startStreaming: ok (status=${r.status || "n/a"})`);
  return true;
}

async function stopStreaming(forceKill = false, doMsg = true) {
  dbgLive(`stopStreaming: begin (force=${forceKill})`);
  const path = forceKill ? "/api/kill" : "/api/stop";
  let r;
  try {
    r = await withTimeout(apiPost(path), 5000, "stop");
  } catch (e) {
    liveAppendLine(`[api] stop/kill failed (${e?.message || e})`);
    dbgLive(`stopStreaming: failed (${e?.message || e})`);
    return false;
  }
  if (!r.ok) {
    liveAppendLine(`[api] stop/kill failed (${r.status})`);
    // Even if kill endpoint doesn"t exist, still fall back to /api/stop
    if (forceKill && r.status === 404) {
      let r2;
      try {
        r2 = await withTimeout(apiPost("/api/stop"), 5000, "stop");
      } catch (e) {
        return false;
      }
      if (!r2.ok) return false;
    } else {
      return false;
    }
  }
  leftStreaming = false;
  clearLivePending();
  await liveTelemetry.streamingStopped();
  if (doMsg) leftSetUI(forceKill ? "Force-killed" : "Streaming stopped");
  dbgLive("stopStreaming: ok");
  return true;
}

// Connect toggle
btnLeftConnectEl?.addEventListener("click", async () => {
  if (!canRunLeftAction()) return;
  setLeftActionInFlight(true);
  setLeftUi();
  try {
    if (leftConnected) await disconnectLeft();
    else await connectLeft();
  } finally {
    setLeftActionInFlight(false);
    setLeftUi();
  }
});

// Start/Stop toggle (+ cmd/ctrl click => force kill)
btnLeftStopEl?.addEventListener("click", async (e) => {
  if (!leftConnected) return;
  if (!canRunLeftAction()) return;
  setLeftActionInFlight(true);
  setLeftUi();

  try {
    const forceKill = (e?.metaKey || e?.ctrlKey);
    if (forceKill) {
      await stopStreaming(true);
      return;
    }

    if (!leftStreaming) await startStreaming();
    else await stopStreaming(false);
    btnLeftConnectEl.title = leftConnected ? "Disconnect" : "Connect";
  } finally {
    setLeftActionInFlight(false);
    setLeftUi();
  }
});

// Manual refresh button
btnLeftRefreshEl?.addEventListener("click", () => {
  doLeftRefresh();
});

leftRefreshIntervalEl?.addEventListener("change", () => {
  leftRefreshMs = parseInt(leftRefreshIntervalEl.value || "0", 10) || 0;
  startLeftRefresh();
  saveSettings();
});

if (btnFit) {
  btnFit.addEventListener("click", () => resetFieldPosition());
} else {
  console.warn("btnFit not found");
}

// Initialize UI on load
leftSetUI("");
renderPlanObjects();
renderPlanningEventTimeline();


function getTimelineH() {
  const v = getComputedStyle(root).getPropertyValue("--timelineH").trim();
  const n = parseFloat(v);
  return isFinite(n) ? n : 260;
};

function getPlanningTimelineH() {
  const v = getComputedStyle(root).getPropertyValue("--planningTimelineH").trim();
  const n = parseFloat(v);
  return isFinite(n) ? n : DEFAULT_PLANNING_TIMELINE_H_PX;
};

function isPlanningTimelineCollapsed() {
  return getPlanningTimelineH() <= COLLAPSE_PX_PLANNING_TIMELINE;
}

// -------- splitters with collapse --------
(function setupSplitters() {
  let draggingV = false;
  let startX = 0;
  let startW = 0;
  // ensure grid state matches persisted widths on load
  try {
    if (getLeftSidebarW() <= 1) leftEl.classList.add("isCollapsed"); rowGrid && rowGrid.classList.add("leftCollapsed");
  } catch (e) { }


  const getRightSidebarWViewing = () => {
    const v = getComputedStyle(root).getPropertyValue("--rightSidebarWViewing").trim();
    const n = parseFloat(v);
    return isFinite(n) ? n : 360;
  };
  const setRightSidebarWViewing = (px) => {
    px = Math.min(px, MAX_SIDEBAR_W_PX);
    root.style.setProperty("--rightSidebarWViewing", `${px}px`);
  };

  const getRightSidebarWPlanning = () => {
    const v = getComputedStyle(root).getPropertyValue("--rightSidebarWPlanning").trim();
    const n = parseFloat(v);
    return isFinite(n) ? n : 360;
  };
  const setRightSidebarWPlanning = (px) => {
    px = Math.min(px, MAX_SIDEBAR_W_PX);
    root.style.setProperty("--rightSidebarWPlanning", `${px}px`);
  };

  const getLeftSidebarW = () => {
    const v = getComputedStyle(root).getPropertyValue("--leftSidebarW").trim();
    const n = parseFloat(v);
    return isFinite(n) ? n : 360;
  };
  const setLeftSidebarW = (px) => {
    px = Math.min(px, MAX_PX_LIVEWIN);
    root.style.setProperty("--leftSidebarW", `${px}px`);
  };

  let draggingVL = false;
  let startXL = 0;
  let startWL = 0;

  vSplitL.addEventListener("mousedown", (e) => {
    draggingVL = true;
    startXL = e.clientX;
    startWL = getLeftSidebarW();
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  });

  vSplit.addEventListener("mousedown", (e) => {
    draggingV = true;
    startX = e.clientX;
    startW = (getAppMode() === "planning") ? getRightSidebarWPlanning() : getRightSidebarWViewing();
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  });

  let draggingH = false;
  let startY = 0;
  let startH = 0;
  let draggingPlanningTimeline = false;
  let startPlanningTimelineY = 0;
  let startPlanningTimelineH = 0;
  let draggingPlanList = false;
  let startPlanY = 0;
  let startPlanH = 0;

  const setTimelineH = (px) => {
    px = Math.min(px, MAX_TIMELINE_H_PX);
    root.style.setProperty("--timelineH", `${px}px`);
  }

  const setPlanningTimelineH = (px) => {
    px = px <= COLLAPSE_PX_PLANNING_TIMELINE ? 0 : DEFAULT_PLANNING_TIMELINE_H_PX;
    root.style.setProperty("--planningTimelineH", `${px}px`);
  };

  const setPlanningTimelineCollapsed = (collapsed) => {
    if (collapsed) {
      setPlanningTimelineH(0);
      timelineBar?.classList?.add("isCollapsed");
    } else {
      layoutState.lastPlanningTimelineH = DEFAULT_PLANNING_TIMELINE_H_PX;
      setPlanningTimelineH(DEFAULT_PLANNING_TIMELINE_H_PX);
      timelineBar?.classList?.remove("isCollapsed");
    }
  };

  hSplit.addEventListener("mousedown", (e) => {
    draggingH = true;
    startY = e.clientY;
    startH = getTimelineH();
    document.body.style.cursor = "row-resize";
    e.preventDefault();

  });

  if (planningTimelineSplit) {
    planningTimelineSplit.addEventListener("mousedown", (e) => {
      if (getAppMode() !== "planning") return;
      draggingPlanningTimeline = true;
      startPlanningTimelineY = e.clientY;
      startPlanningTimelineH = getPlanningTimelineH();
      document.body.style.cursor = "row-resize";
      e.preventDefault();
    });
  }
  const getPlanListH = () => {
    const v = getComputedStyle(root).getPropertyValue("--planListH").trim();
    const n = parseFloat(v);
    return isFinite(n) ? n : 240;
  };
  const setPlanListH = (px) => {
    root.style.setProperty("--planListH", `${px}px`);
  };

  if (planSplit) {
    planSplit.addEventListener("mousedown", (e) => {
      if (getAppMode() !== "planning") return;
      draggingPlanList = true;
      startPlanY = e.clientY;
      startPlanH = getPlanListH();
      document.body.style.cursor = "row-resize";
      e.preventDefault();
    });
  }

  window.addEventListener("mousemove", (e) => {
    if (draggingVL) {
      const dx = e.clientX - startXL;
      const w = window.innerWidth;
      let next = clamp(startWL + dx, 0, Math.max(0, w - 240));

      if (next <= COLLAPSE_PX_LEFTSIDEBAR) {
        next = 0;
        leftEl.classList.add("isCollapsed");
        rowGrid && rowGrid.classList.add("leftCollapsed");
      } else {
        leftEl.classList.remove("isCollapsed");
        rowGrid && rowGrid.classList.remove("leftCollapsed");
        layoutState.lastLeftSidebarW = next;
      }
      setLeftSidebarW(next);
      resizeCanvas();
      resizeTimeline();
    }

    if (draggingV) {
      const dx = e.clientX - startX;
      const w = window.innerWidth;
      let next = clamp(startW - dx, 0, Math.max(0, w - 240));

      if (next <= COLLAPSE_PX_SIDEBAR) {
        next = 0;
        if (getAppMode() === "planning") rightPlanningEl?.classList?.add("isCollapsed");
        else rightViewingEl?.classList?.add("isCollapsed");
      } else {
        if (getAppMode() === "planning") {
          rightPlanningEl?.classList?.remove("isCollapsed");
          layoutState.lastRightSidebarWPlanning = next;
        } else {
          rightViewingEl?.classList?.remove("isCollapsed");
          layoutState.lastRightSidebarW = next;
        }
      }
      if (getAppMode() === "planning") setRightSidebarWPlanning(next);
      else setRightSidebarWViewing(next);
      resizeCanvas();
      resizeTimeline();
    }

    if (draggingH) {
      const dy = e.clientY - startY;
      const h = window.innerHeight;
      let next = clamp(startH - dy, 0, Math.max(0, Math.floor(h * 0.80)));

      if (next <= COLLAPSE_PX_TIMELINE) {
        next = 0;
        timelineBar.classList.add("isCollapsed");
      } else {
        timelineBar.classList.remove("isCollapsed");
        layoutState.lastTimelineH = next;
      }

      setTimelineH(next);
      resizeTimeline();
      resizeCanvas();
    }

    if (draggingPlanningTimeline) {
      const nearBottom = e.clientY >= window.innerHeight - COLLAPSE_PX_PLANNING_TIMELINE;
      const draggedDownPastHeight = e.clientY - startPlanningTimelineY >= Math.max(startPlanningTimelineH, DEFAULT_PLANNING_TIMELINE_H_PX) * 0.5;
      setPlanningTimelineCollapsed(nearBottom || draggedDownPastHeight);
      resizePlanningTimeline();
      resizeCanvas();
    }

    if (draggingPlanList) {
      const dy = e.clientY - startPlanY;
      const rightH = rightPlanningEl?.getBoundingClientRect().height || window.innerHeight;
      const minH = 120;
      const maxH = Math.max(COLLAPSE_WAYPOINTLIST_PX, rightH - 180);
      let next = clamp(startPlanH + dy, 0, maxH);
      if (next <= COLLAPSE_WAYPOINTLIST_PX) {
        next = 0;
        rightPlanningEl?.classList.add("planListCollapsed");
      } else {
        if (next < minH) next = minH;
        rightPlanningEl?.classList.remove("planListCollapsed");
      }
      setPlanListH(next);
    }
  });

  window.addEventListener("mouseup", () => {
    const wasDragging = draggingV || draggingH || draggingVL || draggingPlanList || draggingPlanningTimeline;
    if (wasDragging) {
      draggingV = false;
      draggingH = false;
      draggingVL = false;
      draggingPlanList = false;
      draggingPlanningTimeline = false;
      document.body.style.cursor = "";
      // If user re-expands from collapsed by dragging, restore visibility automatically
      if (getAppMode() === "planning") {
        if (getRightSidebarWPlanning() > COLLAPSE_PX_SIDEBAR) rightPlanningEl?.classList?.remove("isCollapsed");
      } else {
        if (getRightSidebarWViewing() > COLLAPSE_PX_SIDEBAR) rightViewingEl?.classList?.remove("isCollapsed");
      }
      if (getTimelineH() > COLLAPSE_PX_TIMELINE) timelineBar.classList.remove("isCollapsed");
      if (getAppMode() === "planning" && !isPlanningTimelineCollapsed()) timelineBar?.classList?.remove("isCollapsed");
      resizeCanvas();
      resizeTimeline();
      void saveSettings();
    }
  });

  // double-click splitters to toggle collapse/restore
  vSplitL.addEventListener("dblclick", () => {
    const cur = getLeftSidebarW();
    if (cur <= COLLAPSE_PX_LEFTSIDEBAR) {
      setLeftSidebarW(Math.max(1, layoutState.lastLeftSidebarW));
      leftEl.classList.remove("isCollapsed");
      rowGrid && rowGrid.classList.remove("leftCollapsed");
    } else {
      layoutState.lastLeftSidebarW = cur;
      setLeftSidebarW(0);
      leftEl.classList.add("isCollapsed");
      rowGrid && rowGrid.classList.add("leftCollapsed");
    }
    resizeCanvas();
    resizeTimeline();
  });

  vSplit.addEventListener("dblclick", () => {
    if (getAppMode() === "planning") {
      const cur = getRightSidebarWPlanning();
      if (cur <= COLLAPSE_PX_SIDEBAR) {
        setRightSidebarWPlanning(Math.max(1, layoutState.lastRightSidebarWPlanning || 360));
        rightPlanningEl?.classList?.remove("isCollapsed");
      } else {
        layoutState.lastRightSidebarWPlanning = cur;
        setRightSidebarWPlanning(0);
        rightPlanningEl?.classList?.add("isCollapsed");
      }
    } else {
      const cur = getRightSidebarWViewing();
      if (cur <= COLLAPSE_PX_SIDEBAR) {
        setRightSidebarWViewing(Math.max(1, layoutState.lastRightSidebarW));
        rightViewingEl?.classList?.remove("isCollapsed");
      } else {
        layoutState.lastRightSidebarW = cur;
        setRightSidebarWViewing(0);
        rightViewingEl?.classList?.add("isCollapsed");
      }
    }
    resetFieldPosition();
    resizeCanvas();
    layoutTimelineCanvas();
  });

  hSplit.addEventListener("dblclick", () => {
    const cur = getTimelineH();
    if (cur <= COLLAPSE_PX_TIMELINE) {
      setTimelineH(Math.max(160, layoutState.lastTimelineH));
      timelineBar.classList.remove("isCollapsed");
    } else {
      layoutState.lastTimelineH = cur;
      setTimelineH(0);
      timelineBar.classList.add("isCollapsed");
    }
    resizeTimeline();
    resetFieldPosition();
    resizeCanvas();
    layoutTimelineCanvas();
  });

  if (planningTimelineSplit) {
    planningTimelineSplit.addEventListener("dblclick", () => {
      setPlanningTimelineCollapsed(!isPlanningTimelineCollapsed());
      resizePlanningTimeline();
      resizeCanvas();
      void saveSettings();
    });
  }
})();

// -------- data load --------
function setData(obj, options = {}) {
  const { replacePlanning = true, replaceViewing = true } = options;
  data = obj;
  if (!obj) {
    setStatus("Invalid JSON: missing data object");
    return;
  }

  if (replacePlanning) {
    applyImportedPlanningData(obj);
  }

  if (replaceViewing) {
    applyImportedViewingData(obj);
  }

  if (!hasLoadedData()) {
    setStatus("Invalid JSON: no viewing or planning route data found");
    return;
  }

  finalizeLoadedData();
}

function setDataFromStreamText(text) {
  planWaypoints = [];
  planObjects = [];
  planNodes = [];
  clearPlanNodeSelection();
  renderPlanObjects();
  renderPlanningEventTimeline();
  normalizePlanningTimelineHeightForContent();
  planSetSelection([]);
  planPlayDist = 0;
  rawPoses = createPoseStore();
  watches = [];
  logs = [];
  waypoints = [];
  waypointsById = new Map();
  liveLastPoseT = null;

  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    parseLiveLineIntoState(line);
  }

  watches.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  logs.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  waypoints.sort((a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0));
  data = { poses: rawPoses, watches, logs, waypoints, meta: {} };
  setImportedRouteMeta(null);

  if (!hasLoadedData()) {
    setStatus("No poses, watches, logs, waypoints, or planning data found in file.");
    return;
  }

  finalizeLoadedData();
}

function normalizePoseArray(arr) {
  const store = createPoseStore(Array.isArray(arr) ? arr.length : 16);
  const items = (Array.isArray(arr) ? arr : [])
    .filter(p => p && typeof p.x === "number" && typeof p.y === "number")
    .map(p => ({
      t: (typeof p.t === "number") ? p.t : (toNumMaybe(p.t) ?? null),
      x: p.x, y: p.y,
      theta: (typeof p.theta === "number") ? p.theta : (toNumMaybe(p.theta) ?? 0),
      l_vel: (typeof p.l_vel === "number") ? p.l_vel : (toNumMaybe(p.l_vel) ?? null),
      r_vel: (typeof p.r_vel === "number") ? p.r_vel : (toNumMaybe(p.r_vel) ?? null),
      speed_raw: (typeof p.speed_raw === "number")
        ? p.speed_raw
        : ((typeof p.speed === "number") ? p.speed : (toNumMaybe(p.speed) ?? 0)),
      speed_norm: 0,
    }))
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  for (let i = 0; i < items.length; i += 1) store.push(items[i]);
  return store;
}

function hasLoadedData() {
  return rawPoses.length > 0 || watches.length > 0 || logs.length > 0 || waypoints.length > 0 || planWaypoints.length > 0 || planObjects.length > 0;
}

function finalizeLoadedData() {
  const currentUnits = settingsUnitsSelect?.value || unitsSelect?.value || "in";
  setUnitsFactorFromSelect(currentUnits);
  updateOffsetsFromInputs();

  computeSpeedNormRange();
  scheduleSavedPathsSave();

  // Sync to settings modal and save
  syncMainToSettings();
  saveSettings();

  selectedWatch = null;
  hideWatchGraphPanel();
  selectedLogTime = null;
  selectedWaypointId = null;
  selectedWaypointEventTime = null;
  selectedIndex = 0;
  hoverTimelineTime = null;
  timelineHoverSaved = null;
  hoverWatch = null;

  clearTrackHover(true);
  clearTrackLock();
  pause();

  recomputeWatchMarkers();
  rebuildWatchMarkersByTime();
  renderWatchFilter();
  renderWatchList();
  refreshPinnedWatchPanels();
  renderLogList();
  renderWaypointFilter();
  renderWaypointList();
  renderPoseList();

  bounds = { ...FIELD_BOUNDS_IN };
  computeTransform();

  setStatus(`Loaded ${rawPoses.length} poses, ${watches.length} watches, ${logs.length} logs, ${waypointVisibleEvents().length} waypoints.`);
  if (btnPlay) btnPlay.disabled = rawPoses.length < 2;
  if (btnFit) btnFit.disabled = false;
  if (fieldSelect) fieldSelect.disabled = false;
  updateExportButtonAvailability();

  updatePoseReadout();
  requestDrawAll();
}

async function handleFile(file) {
  try {
    const fileName = file?.name?.toLowerCase?.() ?? "";
    const text = await file.text();
    setStatus(`Loaded ${file.name}`);
    if (fileName.endsWith(".json")) {
      const obj = JSON.parse(text);
      const incomingHasPlanning = hasImportedPlanningWaypoints(obj);
      const incomingHasViewing = hasImportedViewingData(obj);
      const currentHasPlanning = hasPlanningExportData();
      if (incomingHasPlanning && currentHasPlanning) {
        const confirmed = await confirmPlanningImportOverride();
        if (!confirmed) {
          setStatus("Import cancelled.");
          return "json-cancelled";
        }
      }
      setData(obj, {
        replacePlanning: incomingHasPlanning,
        replaceViewing: incomingHasViewing,
      });
      return "json";
    }
    if (fileName.endsWith(".txt") || fileName.endsWith(".log")) {
      setDataFromStreamText(text);
      return "text";
    }
    setStatus("Unsupported file type");
  } catch (e) {
    console.error(e);
    setStatus(`Failed to load: ${e?.message || e}`);
    await viewingTelemetry.failedFileLoad({
      reason: e?.message || e,
    });
    throw e;
  }
}

async function openFile(file, inputEl) {
  if (!file) return;
  // Validate file extension
  const validExtensions = [".txt", ".log", ".json"];
  const fileName = file.name.toLowerCase();
  const isValid = validExtensions.some(ext => fileName.endsWith(ext));
  if (!isValid) {
    alert("Invalid file type. Please select a .txt, .log, or .json file");
    if (inputEl) inputEl.value = ""; // allow reselect
    setStatus("Invalid file type.");
    return;
  }
  try {
    const loadedType = await handleFile(file);
    if (inputEl) inputEl.value = ""; // allow re selecting same file
    await viewingTelemetry.fileLoaded({
      file_name: fileName,
      file_type: loadedType,
      file_size: file.size,
    });
  } catch (e) {
    if (inputEl) inputEl.value = "";
  }
}

// -------- controls wiring --------
btnFile.addEventListener("click", () => fileEl.click());
fileEl.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  openFile(file, e.target);
});


// Help modal
function openHelp() {
  if (!helpModal) {
    console.warn("helpModal not found");
    return;
  }
  helpModal.removeAttribute("hidden");
  helpModal.style.display = "flex";
}
function closeHelp() {
  if (!helpModal) return;
  helpModal.setAttribute("hidden", "");
  helpModal.style.display = "none";
}
function openKeybinds() {
  if (!keybindsModal) return;
  keybindsModal.removeAttribute("hidden");
  keybindsModal.style.display = "flex";
}
function closeKeybinds() {
  if (!keybindsModal) return;
  keybindsModal.setAttribute("hidden", "");
  keybindsModal.style.display = "none";
}
if (btnHelp) {
  btnHelp.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openHelp();
  });
} else console.warn("btnHelp not found");

if (btnHelpClose) {
  btnHelpClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeHelp();
  });
} else console.warn("btnHelpClose not found");

if (btnHelpKeybinds) {
  btnHelpKeybinds.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openKeybinds();
  });
}
if (btnKeybindsClose) {
  btnKeybindsClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeKeybinds();
  });
}
if (helpModal) {
  helpModal.addEventListener("click", (e) => {
    if (e.target && (e.target.classList.contains("modalBackdrop"))) closeHelp();
  });
} else console.warn("helpModal not found");

if (keybindsModal) {
  keybindsModal.addEventListener("click", (e) => {
    if (e.target && (e.target.classList.contains("modalBackdrop"))) closeKeybinds();
  });
}

// Settings modal and JSON persistence
async function loadSettings() {
  try {
    let settings = null;
    if (invoke) {
      const saved = await invoke("read_settings");
      if (saved) settings = JSON.parse(saved);
      else {
        // Create defaults on first run so the app data dir/file exists.
        await saveSettings();
      }
    } else console.warn("Settings persistence is unavailable (Tauri invoke missing).");

    if (settings) {
      if (settings.appState && typeof settings.appState === "object" && !Array.isArray(settings.appState)) {
        persistedAppState = { ...settings.appState };
      }
      if (settings.prosDir && prosDirInput) {
        prosDirInput.value = settings.prosDir;
        prosDirFromSettings = true;
      }
      if (settings.robotImageEnabled !== undefined) robotImageEnabled = settings.robotImageEnabled;
      if (settings.units) {
        if (settingsUnitsSelect) settingsUnitsSelect.value = settings.units;
        if (unitsSelect) unitsSelect.value = settings.units;
        setUnitsFactorFromSelect(settings.units);
      }
      if (settings.robotW) {
        if (robotWEl) robotWEl.value = settings.robotW;
        if (settingsRobotW) settingsRobotW.value = settings.robotW;
      }
      if (settings.robotH) {
        if (robotHEl) robotHEl.value = settings.robotH;
        if (settingsRobotH) settingsRobotH.value = settings.robotH;
      }
      if (settings.offX !== undefined) {
        if (offXEl) offXEl.value = settings.offX;
        if (settingsOffX) settingsOffX.value = settings.offX;
      }
      if (settings.offY !== undefined) {
        if (offYEl) offYEl.value = settings.offY;
        if (settingsOffY) settingsOffY.value = settings.offY;
      }
      if (settings.offTheta !== undefined) {
        if (offThetaEl) offThetaEl.value = settings.offTheta;
        if (settingsOffTheta) settingsOffTheta.value = settings.offTheta;
      }
      if (settings.minSpeed !== undefined) {
        if (minSpeedEl) minSpeedEl.value = settings.minSpeed;
        if (settingsMinSpeed) settingsMinSpeed.value = settings.minSpeed;
      }
      if (settings.maxSpeed !== undefined) {
        if (maxSpeedEl) maxSpeedEl.value = settings.maxSpeed;
        if (settingsMaxSpeed) settingsMaxSpeed.value = settings.maxSpeed;
      }
      if (settings.planMoveStep !== undefined && settingsPlanMoveStep) {
        settingsPlanMoveStep.value = settings.planMoveStep;
      }
      if (settings.planSnapStep !== undefined && settingsPlanSnapStep) {
        settingsPlanSnapStep.value = settings.planSnapStep;
      }
      if (settings.planThetaSnapStep !== undefined && settingsPlanThetaSnapStep) {
        settingsPlanThetaSnapStep.value = settings.planThetaSnapStep;
      }
      if (settings.planLimitBounds !== undefined && settingsPlanLimitBounds) {
        settingsPlanLimitBounds.checked = !!settings.planLimitBounds;
      }
      if (settings.planExportTemplate !== undefined) {
        const savedTemplate = String(settings.planExportTemplate || "");
        planExportTemplate = savedTemplate.trim() ? savedTemplate : DEFAULT_PLAN_EXPORT_TEMPLATE;
      }
      if (settings.refreshIntervalMs !== undefined && leftRefreshIntervalEl) {
        leftRefreshIntervalEl.value = String(settings.refreshIntervalMs);
        leftRefreshMs = parseInt(leftRefreshIntervalEl.value || "0", 10) || 0;
        startLeftRefresh();
      }
      if (settings.liveDebug !== undefined) {
        liveDebugEnabled = !!settings.liveDebug;
        if (settingsLiveDebug) settingsLiveDebug.checked = liveDebugEnabled;
      } else if (settingsLiveDebug) {
        settingsLiveDebug.checked = false;
      }
      if (settings.showPreviousYearFields !== undefined) {
        showPreviousYearFields = !!settings.showPreviousYearFields;
      }
      if (settings.fieldCompetition !== undefined) {
        fieldCompetition = normalizeFieldCompetition(settings.fieldCompetition);
      }
      if (settingsFieldCompetition) {
        settingsFieldCompetition.value = fieldCompetition;
      }
      if (settingsShowPreviousYearFields) {
        settingsShowPreviousYearFields.checked = showPreviousYearFields;
      }
      loadFieldOptions();
      if (settings.playbackSpeed !== undefined && speedSelect) {
        speedSelect.value = String(settings.playbackSpeed);
        playRate = Number(speedSelect.value) || 1;
      }
      if (settings.selectedField !== undefined && fieldSelect) {
        const nextField = getValidFieldKey(settings.selectedField);
        fieldSelect.value = nextField;
        loadFieldImage(nextField);
      }
      if (settings.robotImgScale !== undefined) {
        robotImgTx.scale = settings.robotImgScale;
        if (robotImgScaleEl) robotImgScaleEl.value = settings.robotImgScale;
        if (settingsRobotImgScale) settingsRobotImgScale.value = settings.robotImgScale;
      }
      if (settings.robotImgOffX !== undefined) {
        robotImgTx.offXIn = settings.robotImgOffX;
        if (robotImgOffXEl) robotImgOffXEl.value = settings.robotImgOffX;
        if (settingsRobotImgOffX) settingsRobotImgOffX.value = settings.robotImgOffX;
      }
      if (settings.robotImgOffY !== undefined) {
        robotImgTx.offYIn = settings.robotImgOffY;
        if (robotImgOffYEl) robotImgOffYEl.value = settings.robotImgOffY;
        if (settingsRobotImgOffY) settingsRobotImgOffY.value = settings.robotImgOffY;
      }
      if (settings.robotImgRot !== undefined) {
        robotImgTx.rotDeg = settings.robotImgRot;
        if (robotImgRotEl) robotImgRotEl.value = settings.robotImgRot;
        if (settingsRobotImgRot) settingsRobotImgRot.value = settings.robotImgRot;
      }
      if (settings.robotImgAlpha !== undefined) {
        robotImgTx.alpha = clamp(Number(settings.robotImgAlpha) || 100, 0, 100) / 100;
        if (robotImgAlphaEl) robotImgAlphaEl.value = String(Math.round(robotImgTx.alpha * 100));
        if (settingsRobotImgAlpha) settingsRobotImgAlpha.value = String(Math.round(robotImgTx.alpha * 100));
      }
      if (settings.fieldRotation !== undefined) {
        setFieldRotationDeg(Number(settings.fieldRotation) || 0);
      }
      if (settings.robotImage?.path) {
        robotImagePath = settings.robotImage.path;
      }
      if (settings.robotImage?.dataUrl) {
        robotImageDataUrl = settings.robotImage.dataUrl;
      }
      if (robotImageEnabled) {
        if (robotImageDataUrl) loadRobotImageFromDataUrl(robotImageDataUrl);
        else if (robotImagePath) loadRobotImageFromPath(robotImagePath);
      }
      if (robotImageDataUrl && invoke && !robotImagePath) {
        try {
          const savedPath = await invoke("save_robot_image", { dataUrl: robotImageDataUrl });
          if (savedPath) {
            robotImagePath = savedPath;
            await saveSettings();
          }
        } catch (e) {
          console.warn("Failed to persist robot image to app data:", e);
        }
      }
      applySavedLayout(settings);
      updateOffsetsFromInputs();
      computeSpeedNormRange();
      if (robotImageToggle) robotImageToggle.checked = robotImageEnabled;
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}

async function loadDemoRouteIfUpgraded() {
  if (!invoke) return false;

  try {
    const upgradeState = await invoke("was_previous_version_old");
    persistedAppState = {
      ...(persistedAppState && typeof persistedAppState === "object" ? persistedAppState : {}),
      lastSeenAppVersion: APP_VERSION,
    };
    if (!upgradeState?.wasPreviousVersionOlder) return false;

    const response = await fetch(demoRouteUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const obj = await response.json();
    setData(obj);
    setStatus("Loaded getting started demo route after app upgrade.");
    return true;
  } catch (e) {
    console.warn("Failed to load upgrade demo route:", e);
    return false;
  }
}

async function saveSettings() {
  try {
    const settings = {
      prosDir: prosDirInput ? prosDirInput.value : "",
      robotImageEnabled,
      units: settingsUnitsSelect ? settingsUnitsSelect.value : (unitsSelect ? unitsSelect.value : "in"),
      robotW: robotWEl ? robotWEl.value : "12",
      robotH: robotHEl ? robotHEl.value : "12",
      offX: offXEl ? offXEl.value : "0",
      offY: offYEl ? offYEl.value : "0",
      offTheta: offThetaEl ? offThetaEl.value : "0",
      minSpeed: minSpeedEl ? minSpeedEl.value : "0",
      maxSpeed: maxSpeedEl ? maxSpeedEl.value : "127",
      planMoveStep: settingsPlanMoveStep ? settingsPlanMoveStep.value : "0.5",
      planSnapStep: settingsPlanSnapStep ? settingsPlanSnapStep.value : "0",
      planThetaSnapStep: settingsPlanThetaSnapStep ? settingsPlanThetaSnapStep.value : "0",
      planLimitBounds: settingsPlanLimitBounds ? settingsPlanLimitBounds.checked : true,
      planExportTemplate,
      refreshIntervalMs: leftRefreshIntervalEl ? leftRefreshIntervalEl.value : "0",
      liveDebug: settingsLiveDebug ? settingsLiveDebug.checked : liveDebugEnabled,
      showPreviousYearFields,
      fieldCompetition,
      playbackSpeed: speedSelect ? speedSelect.value : "1",
      selectedField: fieldSelect ? fieldSelect.value : DEFAULT_FIELD_KEY,
      robotImgScale: robotImgTx.scale,
      robotImgOffX: robotImgTx.offXIn,
      robotImgOffY: robotImgTx.offYIn,
      robotImgRot: robotImgTx.rotDeg,
      robotImgAlpha: Math.round(clamp(Number(robotImgTx.alpha) || 1, 0, 1) * 100),
      robotImage: {
        path: robotImagePath || null,
        dataUrl: robotImagePath ? null : (robotImageDataUrl || null),
      },
      fieldRotation: fieldRotationDeg,
      layoutLeftSidebarWidth: readRootCssNumber("--leftSidebarW", 360),
      layoutRightSidebarWidthViewing: readRootCssNumber("--rightSidebarWViewing", 370),
      layoutRightSidebarWidthPlanning: readRootCssNumber("--rightSidebarWPlanning", 370),
      layoutTimelineHeight: readRootCssNumber("--timelineH", 180),
      layoutPlanningWaypointHeight: readRootCssNumber("--planListH", 240),
      layoutPlanningTimelineHeight: readRootCssNumber("--planningTimelineH", 144),
    };
    if (persistedAppState && typeof persistedAppState === "object" && !Array.isArray(persistedAppState)) {
      settings.appState = { ...persistedAppState };
    }
    const payload = JSON.stringify(settings);
    if (invoke) {
      await invoke("write_settings", { contents: payload });
    } else {
      console.warn("Settings persistence is unavailable (Tauri invoke missing).");
    }
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

function syncSettingsToMain() {
  // Sync from settings modal to main inputs
  if (!settingsUnitsSelect) return;
  if (unitsSelect && settingsUnitsSelect.value !== unitsSelect.value) {
    unitsSelect.value = settingsUnitsSelect.value;
  }
  if (settingsUnitsSelect.value !== currentUnits) {
    setUnitsFactorFromSelect(settingsUnitsSelect.value);
    updateOffsetsFromInputs();
  }
  if (settingsRobotW && robotWEl && settingsRobotW.value !== robotWEl.value) {
    robotWEl.value = settingsRobotW.value;
    requestDrawAll();
  }
  if (settingsRobotH && robotHEl && settingsRobotH.value !== robotHEl.value) {
    robotHEl.value = settingsRobotH.value;
    requestDrawAll();
  }
  if (settingsOffX && offXEl && settingsOffX.value !== offXEl.value) {
    offXEl.value = settingsOffX.value;
    updateOffsetsFromInputs();
  }
  if (settingsOffY && offYEl && settingsOffY.value !== offYEl.value) {
    offYEl.value = settingsOffY.value;
    updateOffsetsFromInputs();
  }
  if (settingsOffTheta && offThetaEl && settingsOffTheta.value !== offThetaEl.value) {
    offThetaEl.value = settingsOffTheta.value;
    updateOffsetsFromInputs();
  }
  if (settingsMinSpeed && minSpeedEl && settingsMinSpeed.value !== minSpeedEl.value) {
    minSpeedEl.value = settingsMinSpeed.value;
    computeSpeedNormRange();
    recomputeWatchMarkers();
    rebuildWatchMarkersByTime();
    requestDrawAll();
    updatePoseReadout();
  }
  if (settingsMaxSpeed && maxSpeedEl && settingsMaxSpeed.value !== maxSpeedEl.value) {
    maxSpeedEl.value = settingsMaxSpeed.value;
    computeSpeedNormRange();
    recomputeWatchMarkers();
    rebuildWatchMarkersByTime();
    requestDrawAll();
    updatePoseReadout();
  }
  if (settingsRobotImgScale && robotImgScaleEl && settingsRobotImgScale.value !== robotImgScaleEl.value) {
    robotImgScaleEl.value = settingsRobotImgScale.value;
    syncRobotImgTxFromInputs();
    requestDrawAll();
  }
  if (settingsRobotImgOffX && robotImgOffXEl && settingsRobotImgOffX.value !== robotImgOffXEl.value) {
    robotImgOffXEl.value = settingsRobotImgOffX.value;
    syncRobotImgTxFromInputs();
    requestDrawAll();
  }
  if (settingsRobotImgOffY && robotImgOffYEl && settingsRobotImgOffY.value !== robotImgOffYEl.value) {
    robotImgOffYEl.value = settingsRobotImgOffY.value;
    syncRobotImgTxFromInputs();
    requestDrawAll();
  }
  if (settingsRobotImgRot && robotImgRotEl && settingsRobotImgRot.value !== robotImgRotEl.value) {
    robotImgRotEl.value = settingsRobotImgRot.value;
    syncRobotImgTxFromInputs();
    requestDrawAll();
  }
  if (settingsRobotImgAlpha && robotImgAlphaEl && settingsRobotImgAlpha.value !== robotImgAlphaEl.value) {
    robotImgAlphaEl.value = settingsRobotImgAlpha.value;
    syncRobotImgTxFromInputs();
    requestDrawAll();
  }
  saveSettings();
}

function syncMainToSettings() {
  // Sync from main inputs to settings modal
  if (!unitsSelect || !settingsUnitsSelect) return;
  if (unitsSelect.value !== settingsUnitsSelect.value) {
    settingsUnitsSelect.value = unitsSelect.value;
  }
  if (robotWEl && settingsRobotW && robotWEl.value !== settingsRobotW.value) {
    settingsRobotW.value = robotWEl.value;
  }
  if (robotHEl && settingsRobotH && robotHEl.value !== settingsRobotH.value) {
    settingsRobotH.value = robotHEl.value;
  }
  if (offXEl && settingsOffX && offXEl.value !== settingsOffX.value) {
    settingsOffX.value = offXEl.value;
  }
  if (offYEl && settingsOffY && offYEl.value !== settingsOffY.value) {
    settingsOffY.value = offYEl.value;
  }
  if (offThetaEl && settingsOffTheta && offThetaEl.value !== settingsOffTheta.value) {
    settingsOffTheta.value = offThetaEl.value;
  }
  if (minSpeedEl && settingsMinSpeed && minSpeedEl.value !== settingsMinSpeed.value) {
    settingsMinSpeed.value = minSpeedEl.value;
  }
  if (maxSpeedEl && settingsMaxSpeed && maxSpeedEl.value !== settingsMaxSpeed.value) {
    settingsMaxSpeed.value = maxSpeedEl.value;
  }
  if (robotImgScaleEl && settingsRobotImgScale && robotImgScaleEl.value !== settingsRobotImgScale.value) {
    settingsRobotImgScale.value = robotImgScaleEl.value;
  }
  if (robotImgOffXEl && settingsRobotImgOffX && robotImgOffXEl.value !== settingsRobotImgOffX.value) {
    settingsRobotImgOffX.value = robotImgOffXEl.value;
  }
  if (robotImgOffYEl && settingsRobotImgOffY && robotImgOffYEl.value !== settingsRobotImgOffY.value) {
    settingsRobotImgOffY.value = robotImgOffYEl.value;
  }
  if (robotImgRotEl && settingsRobotImgRot && robotImgRotEl.value !== settingsRobotImgRot.value) {
    settingsRobotImgRot.value = robotImgRotEl.value;
  }
  if (robotImgAlphaEl && settingsRobotImgAlpha && robotImgAlphaEl.value !== settingsRobotImgAlpha.value) {
    settingsRobotImgAlpha.value = robotImgAlphaEl.value;
  }
  if (settingsShowPreviousYearFields) {
    settingsShowPreviousYearFields.checked = showPreviousYearFields;
  }
  if (settingsFieldCompetition) {
    settingsFieldCompetition.value = fieldCompetition;
  }
}

function openSettings() {
  if (!settingsModal) {
    console.error("Settings modal not found");
    return;
  }
  try {
    syncMainToSettings(); // Load current values into settings modal
  } catch (e) {
    console.error("Error syncing settings:", e);
  }
  if (prosDirInput && prosDirInput.value && prosDirInput.value.trim()) {
    updateProsDir(prosDirInput.value);
  }

  // Update robot image controls visibility
  if (settingsRobotImgControls) {
    settingsRobotImgControls.hidden = !(robotImageEnabled && robotImgOk);
  }
  if (robotImageToggle) {
    robotImageToggle.checked = robotImageEnabled;
  }
  settingsModal.removeAttribute("hidden");
  settingsModal.style.display = "flex"; // Ensure flex display
  // Focus the modal card for accessibility
  requestAnimationFrame(() => {
    const modalCard = settingsModal.querySelector(".modalCard");
    if (modalCard) modalCard.focus();
  });
}

function closeSettings() {
  if (!settingsModal) return;
  try {
    void saveSettings();
  } catch (e) {
    console.error("Error saving settings:", e);
  }

  try {
    syncSettingsToMain(); // Save settings modal values to main inputs
  } catch (e) {
    console.error("Error syncing settings:", e);
  }
  settingsModal.setAttribute("hidden", "");
  settingsModal.style.display = "none"; // Force hide
}

function sanitizeExportFilename(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\.json\s*$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim();
}

function sanitizeExportPathName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function exportLocationLabel(value) {
  if (value === "desktop") return "Desktop";
  if (value === "documents") return "Documents";
  if (value === "custom") return "Custom Folder";
  return "Downloads";
}

function getExportLocationPath() {
  const location = exportLocationSelect ? exportLocationSelect.value : "downloads";
  const customPath = exportCustomPathInput ? exportCustomPathInput.value.trim() : "";
  return {
    kind: location,
    label: exportLocationLabel(location),
    customPath: location === "custom" ? customPath : null,
  };
}

function serializeExportPose(pose) {
  return {
    t: pose.t ?? null,
    x: pose.x,
    y: pose.y,
    theta: pose.theta ?? 0,
    l_vel: pose.l_vel ?? null,
    r_vel: pose.r_vel ?? null,
    speed: pose.speed_raw ?? 0,
  };
}

function serializeExportWatch(watch) {
  return {
    t: watch.t ?? null,
    id: Number.isInteger(watch.id) ? watch.id : null,
    visible: watch.visible !== false,
    level: watch.level ?? "INFO",
    label: watch.label ?? "",
    value: watch.value ?? "",
  };
}

function serializeExportLog(entry) {
  const rawMessage = entry.message ?? entry.value ?? "";
  const value = entry.isSystem ? `[MVLIB] ${rawMessage}` : rawMessage;
  return {
    t: entry.t ?? null,
    level: normalizeLogLevel(entry.level),
    label: entry.label ?? "",
    value,
  };
}

function serializeExportWaypointEvent(event) {
  return {
    t: event?.t ?? null,
    type: normalizeWaypointType(event?.type),
    id: Number.isInteger(event?.id) ? event.id : null,
    name: event?.name ?? "",
    params: event?.params ? { ...event.params } : {},
  };
}

function serializeExportWaypoint(waypoint) {
  return {
    id: waypoint.id,
    name: waypoint.name ?? "",
    events: Array.isArray(waypoint.events) ? waypoint.events.map(serializeExportWaypointEvent) : [],
  };
}

function buildExportMetadata(PathName) {
  const { minV, maxV } = getMinMaxSpeed();
  const robotDims = robotDimsInches();
  const Units = settingsUnitsSelect?.value || unitsSelect?.value || currentUnits || "in";
  const SelectedField = fieldSelect ? fieldSelect.value : DEFAULT_FIELD_KEY;
  const poseStart = rawPoses[0]?.t ?? null;
  const poseEnd = rawPoses[rawPoses.length - 1]?.t ?? null;

  const formattedDateGB = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());

  return {
    SchemaVersion: 3,
    CreationDate: formattedDateGB,
    AppVersion: APP_VERSION,
    Creator: "MotionView",
    PathName,
    Stats: {
      PoseCount: rawPoses.length,
      WatchCount: watches.length,
      LogCount: logs.length,
      WaypointCount: waypoints.length,
      WaypointEvents: waypointEventCount(waypoints),
      PlannedWaypointCount: planWaypoints.length,
      PlannedObjectCount: planObjects.length,
      PlannedNodeCount: planNodes.length,
    },
    Times: {
      StartTime: String(fmtNum(poseStart / 1000, 2)) + "s",
      EndTime: String(fmtNum(poseEnd / 1000, 2)) + "s",
      DurationTimeMs: (typeof poseStart === "number" && typeof poseEnd === "number") ? Math.max(0, poseEnd - poseStart) : null,
    },
    ViewingSettings: {
      Units,
      SelectedField,
      PathOffsets: {
        X: Number((offXEl ? offXEl.value : settingsOffX ? settingsOffX.value : 0) || 0),
        Y: Number((offYEl ? offYEl.value : settingsOffY ? settingsOffY.value : 0) || 0),
        Theta: Number((offThetaEl ? offThetaEl.value : settingsOffTheta ? settingsOffTheta.value : 0) || 0),
      },
      RobotDimensions: {
        Width: robotDims.w,
        Height: robotDims.h,
      },
      SpeedNorm: {
        Minimum: minV,
        Maximum: maxV,
      },
    },
  };
}

function getSelectedExportType() {
  const value = String(exportTypesSelect?.value || "viewing");
  return (value === "planning" || value === "both") ? value : "viewing";
}

function hasViewingExportData() {
  return rawPoses.length > 0 || watches.length > 0 || logs.length > 0 || waypoints.length > 0;
}

function hasPlanningExportData() {
  return planWaypoints.length > 0 || planObjects.length > 0 || planNodes.length > 0;
}

function hasAnyExportData() {
  return hasViewingExportData() || hasPlanningExportData();
}

function updateExportButtonAvailability() {
  if (!btnExport) return;
  btnExport.disabled = (leftConnected && leftStreaming) || !hasAnyExportData();
}

function buildExportPayload() {
  const rawPathName = exportPathNameInput ? exportPathNameInput.value : "";
  const pathName = sanitizeExportPathName(rawPathName) || "Untitled Path";
  const exportType = getSelectedExportType();

  const includeViewing = exportType === "viewing" || exportType === "both";
  const includePlanning = exportType === "planning" || exportType === "both";
  if (includePlanning) pruneInvalidPlanNodes();

  const payload = {
    meta: buildExportMetadata(pathName),
  };

  if (includePlanning) {
    payload["planned-path"] = planWaypoints.map((p) => ({
      x: p.x,
      y: p.y,
      theta: p.theta ?? 0,
      speed: readPlanSpeed(p.speed, 127),
    }));
    payload["planned-export-template"] = planExportTemplate;
    payload["planned-objects"] = planObjects.map((obj) => ({
      id: obj.id,
      name: obj.name,
      color: obj.color || null,
      latestMethod: obj.latestMethod || "",
      methods: obj.methods.map((method) => ({
        id: method.id,
        name: method.name,
        code: method.code,
      })),
    }));
    payload["planned-nodes"] = planNodes.map(serializePlanNode);
  }

  if (includeViewing) {
    payload.poses = rawPoses.map(serializeExportPose);
    payload.watches = watches.map(serializeExportWatch);
    payload.logs = logs.map(serializeExportLog);
    payload.waypoints = waypoints.map(serializeExportWaypoint);
  }

  return payload;
}

function buildExportRequest() {
  const filenameBase = sanitizeExportFilename(exportFilenameInput ? exportFilenameInput.value : "");
  const pathName = sanitizeExportPathName(exportPathNameInput ? exportPathNameInput.value : "");
  const location = getExportLocationPath();
  const payload = buildExportPayload();
  const exportType = getSelectedExportType();
  const json = JSON.stringify(payload, null, 2);

  return {
    exportType,
    filenameBase,
    filename: `${filenameBase}.json`,
    pathName: pathName || payload.meta?.PathName || "Untitled Path",
    destination: location,
    payload,
    json,
  };
}

function flattenMetaEntries(value, prefix = "") {
  if (value == null) {
    return prefix ? [{ key: prefix, value: "null" }] : [];
  }

  if (Array.isArray(value)) {
    if (!value.length) return prefix ? [{ key: prefix, value: "[]" }] : [];
    const entries = [];
    value.forEach((item, index) => {
      const nextPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
      entries.push(...flattenMetaEntries(item, nextPrefix));
    });
    return entries;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (!keys.length) return prefix ? [{ key: prefix, value: "{}" }] : [];
    const entries = [];
    for (const key of keys) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      entries.push(...flattenMetaEntries(value[key], nextPrefix));
    }
    return entries;
  }

  const text = typeof value === "string" ? value : String(value);
  return prefix ? [{ key: prefix, value: text }] : [];
}

function renderRouteInfoList() {
  if (!routeInfoList) return;
  const entries = flattenMetaEntries(importedRouteMeta);
  if (!entries.length) {
    routeInfoList.innerHTML = '<div class="routeInfoEmpty">No imported metadata is available for this route.</div>';
    return;
  }
  routeInfoList.innerHTML = entries
    .map((entry) => `
      <div class="routeInfoRow">
        <div class="routeInfoKey">${escapeHtml(entry.key)}</div>
        <div class="routeInfoValue">${escapeHtml(entry.value)}</div>
      </div>
    `)
    .join("");
}

function setImportedRouteMeta(meta) {
  importedRouteMeta = (meta && typeof meta === "object" && !Array.isArray(meta) && Object.keys(meta).length)
    ? meta
    : null;
  if (btnRouteInfo) {
    btnRouteInfo.disabled = !importedRouteMeta;
  }
  updateExportButtonAvailability();
  if (btnApplyRunSettings) {
    btnApplyRunSettings.disabled = !importedRouteMeta?.ViewingSettings;
  }
  renderRouteInfoList();
}

async function applyImportedRunSettings() {
  const viewing = importedRouteMeta?.ViewingSettings;
  if (!viewing || typeof viewing !== "object") {
    setStatus("No run settings were found in this route metadata.");
    return;
  }

  if (viewing.Units !== undefined) {
    const nextUnits = inferUnitsFromMeta(viewing.Units);
    if (unitsSelect) unitsSelect.value = nextUnits;
    if (settingsUnitsSelect) settingsUnitsSelect.value = nextUnits;
    setUnitsFactorFromSelect(nextUnits);
  }

  if (viewing.SelectedField !== undefined && fieldSelect) {
    const nextField = getValidFieldKey(viewing.SelectedField);
    fieldSelect.value = nextField;
    await loadFieldImage(nextField);
  }

  const pathOffsets = (viewing.PathOffsets && typeof viewing.PathOffsets === "object") ? viewing.PathOffsets : null;
  if (pathOffsets) {
    if (offXEl) offXEl.value = String(toNumMaybe(pathOffsets.X) ?? 0);
    if (offYEl) offYEl.value = String(toNumMaybe(pathOffsets.Y) ?? 0);
    if (offThetaEl) offThetaEl.value = String(toNumMaybe(pathOffsets.Theta) ?? 0);
  }

  const robotDimensions = (viewing.RobotDimensions && typeof viewing.RobotDimensions === "object") ? viewing.RobotDimensions : null;
  if (robotDimensions) {
    if (robotWEl) robotWEl.value = String(toNumMaybe(robotDimensions.Width) ?? robotWEl.value ?? 12);
    if (robotHEl) robotHEl.value = String(toNumMaybe(robotDimensions.Height) ?? robotHEl.value ?? 12);
  }

  const speedNorm = (viewing.SpeedNorm && typeof viewing.SpeedNorm === "object") ? viewing.SpeedNorm : null;
  if (speedNorm) {
    if (minSpeedEl) minSpeedEl.value = String(toNumMaybe(speedNorm.Minimum) ?? 0);
    if (maxSpeedEl) maxSpeedEl.value = String(toNumMaybe(speedNorm.Maximum) ?? 127);
  }

  sanitizeOffsetInputs();
  syncMainToSettings();
  updateOffsetsFromInputs();
  computeSpeedNormRange();
  renderPoseList();
  renderWatchFilter();
  renderWatchList();
  renderLogList();
  renderWaypointFilter();
  renderWaypointList();
  updatePoseReadout();
  requestDrawAll();
  await saveSettings();
  setStatus("Applied run settings from imported metadata.");
}

function openRouteInfoModal() {
  if (!routeInfoModal || !importedRouteMeta) return;
  renderRouteInfoList();
  routeInfoModal.removeAttribute("hidden");
  routeInfoModal.style.display = "flex";
  requestAnimationFrame(() => {
    const modalCard = routeInfoModal.querySelector(".modalCard");
    if (modalCard) modalCard.focus();
  });
}

function closeRouteInfoModal() {
  if (!routeInfoModal) return;
  routeInfoModal.setAttribute("hidden", "");
  routeInfoModal.style.display = "none";
}

function updateExportUiState() {
  const exportLocation = exportLocationSelect ? exportLocationSelect.value : "downloads";
  const exportType = getSelectedExportType();
  const isCustomLocation = exportLocation === "custom";
  if (exportCustomPathWrap) {
    exportCustomPathWrap.hidden = !isCustomLocation;
  }

  const pathName = sanitizeExportPathName(exportPathNameInput ? exportPathNameInput.value : "");
  const rawFilename = exportFilenameInput ? exportFilenameInput.value : "";
  const sanitizedFilename = sanitizeExportFilename(rawFilename);
  const pathNameValid = pathName.length > 0;
  const filenameValid = sanitizedFilename.length > 0;
  const customPath = exportCustomPathInput ? exportCustomPathInput.value.trim() : "";
  const customPathValid = !isCustomLocation || customPath.length > 0;
  const viewingDataValid = exportType !== "viewing" || hasViewingExportData();
  const planningDataValid = exportType !== "planning" || hasPlanningExportData();
  const combinedDataValid = exportType !== "both" || (hasViewingExportData() || hasPlanningExportData());
  const exportDataValid = viewingDataValid && planningDataValid && combinedDataValid;

  if (exportFilenameHint) {
    exportFilenameHint.textContent = sanitizedFilename && rawFilename !== sanitizedFilename
      ? `Sanitized filename: ${sanitizedFilename}.json`
      : "Only letters, numbers, spaces, dashes, and underscores are kept.";
  }

  if (exportCustomPathHint) {
    exportCustomPathHint.textContent = isCustomLocation
      ? "Enter a folder path. Folder existence will be checked when export logic is added."
      : "Folder validation will be enforced when export logic is added.";
  }

  if (exportValidationMessage) {
    if (!pathNameValid) {
      exportValidationMessage.textContent = "Enter a path name to continue.";
    } else if (!filenameValid) {
      exportValidationMessage.textContent = "Enter a filename to continue.";
    } else if (!customPathValid) {
      exportValidationMessage.textContent = "Enter a custom folder path to continue.";
    } else if (!viewingDataValid) {
      exportValidationMessage.textContent = "There is no Viewing mode data to export.";
    } else if (!planningDataValid) {
      exportValidationMessage.textContent = "There is no Planning mode data to export.";
    } else if (!combinedDataValid) {
      exportValidationMessage.textContent = "There is no Viewing or Planning mode data to export.";
    } else {
      exportValidationMessage.textContent = "";
    }
  }

  if (btnExportConfirm) {
    btnExportConfirm.disabled = !(pathNameValid && filenameValid && customPathValid && exportDataValid);
  }
}

function openExportModal(defaultExportType = null) {
  if (!exportModal) {
    console.warn("Export modal not found");
    return;
  }
  if (exportSuccessMessage) {
    exportSuccessMessage.textContent = "";
    exportSuccessMessage.hidden = true;
  }
  if (exportPathNameInput && !exportPathNameInput.value.trim()) {
    exportPathNameInput.value = "Untitled Path";
  }
  if (exportFilenameInput && !exportFilenameInput.value.trim()) {
    exportFilenameInput.value = "motionview-path";
  }
  if (defaultExportType && exportTypesSelect) {
    exportTypesSelect.value = defaultExportType;
  }
  updateExportUiState();
  exportModal.removeAttribute("hidden");
  exportModal.style.display = "flex";
  requestAnimationFrame(() => {
    if (exportPathNameInput) exportPathNameInput.focus();
    else {
      const modalCard = exportModal.querySelector(".modalCard");
      if (modalCard) modalCard.focus();
    }
  });
}

function closeExportModal() {
  if (!exportModal) return;
  exportModal.setAttribute("hidden", "");
  exportModal.style.display = "none";
}

// Settings modal event handlers - ensure they"re set up
if (btnSettings) {
  btnSettings.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSettings();
  });
} else {
  console.warn("btnSettings element not found");
}

if (btnExport) {
  btnExport.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openExportModal();
  });
} else {
  console.warn("btnExport element not found");
}

if (btnPlanExport) {
  btnPlanExport.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openExportModal("planning");
  });
} else {
  console.warn("btnPlanExport element not found");
}

if (btnRouteInfo) {
  btnRouteInfo.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openRouteInfoModal();
  });
} else {
  console.warn("btnRouteInfo element not found");
}

if (btnSettingsClose) {
  btnSettingsClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSettings();
  });
} else {
  console.warn("btnSettingsClose element not found");
}

if (btnExportClose) {
  btnExportClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeExportModal();
  });
} else {
  console.warn("btnExportClose element not found");
}

if (btnRouteInfoClose) {
  btnRouteInfoClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeRouteInfoModal();
  });
} else {
  console.warn("btnRouteInfoClose element not found");
}

if (btnApplyRunSettings) {
  btnApplyRunSettings.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void applyImportedRunSettings();
  });
}

if (btnExportCancel) {
  btnExportCancel.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeExportModal();
  });
} else {
  console.warn("btnExportCancel element not found");
}

if (btnExportConfirm) {
  btnExportConfirm.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    updateExportUiState();
    if (btnExportConfirm.disabled) return;
    try {
      if (exportSuccessMessage) {
        exportSuccessMessage.textContent = "";
        exportSuccessMessage.hidden = true;
      }
      pendingExportRequest = buildExportRequest();
      window.__motionViewPendingExport = pendingExportRequest;
      window.__motionViewPendingExportJson = pendingExportRequest.json;
      const result = await invoke("export_motionview_json", {
        filenameBase: pendingExportRequest.filenameBase,
        location: pendingExportRequest.destination.kind,
        customPath: pendingExportRequest.destination.customPath,
        jsonContents: pendingExportRequest.json,
      });
      if (exportSuccessMessage) {
        exportSuccessMessage.textContent = `Successfully exported ${pendingExportRequest.pathName} to "${result?.path || pendingExportRequest.filename}"`;
        exportSuccessMessage.hidden = false;
      }
      setStatus(`Exported ${pendingExportRequest.filename}.`);
      const includesPlanning = pendingExportRequest.exportType === "planning" || pendingExportRequest.exportType === "both";
      const includesViewing = pendingExportRequest.exportType === "viewing" || pendingExportRequest.exportType === "both";
      void exportTelemetry.motionviewJsonExported(getPlanningTelemetryProperties({
        export_type: pendingExportRequest.exportType,
        includes_planning: includesPlanning,
        includes_viewing: includesViewing,
        export_location: pendingExportRequest.destination.kind,
        exported_chars: pendingExportRequest.json.length,
        exported_bytes: getUtf8ByteLength(pendingExportRequest.json),
        exported_planning_template_bytes: includesPlanning ? getUtf8ByteLength(planExportTemplate) : 0,
        exported_viewing_poses: includesViewing ? rawPoses.length : 0,
        exported_viewing_watches: includesViewing ? watches.length : 0,
        exported_viewing_logs: includesViewing ? logs.length : 0,
        exported_viewing_waypoints: includesViewing ? waypoints.length : 0,
      }));
      console.log("MotionView export payload written:", {
        request: pendingExportRequest,
        result,
      });
    } catch (err) {
      console.error("Failed to export MotionView JSON:", err);
      if (exportSuccessMessage) {
        exportSuccessMessage.textContent = "";
        exportSuccessMessage.hidden = true;
      }
      if (exportValidationMessage) {
        exportValidationMessage.textContent = `Failed to export file: ${err?.message || err}`;
      }
    }
  });
} else {
  console.warn("btnExportConfirm element not found");
}

if (exportPathNameInput) {
  exportPathNameInput.addEventListener("input", () => {
    const sanitizedValue = sanitizeExportPathName(exportPathNameInput.value);
    if (exportPathNameInput.value !== sanitizedValue) {
      const cursor = sanitizedValue.length;
      exportPathNameInput.value = sanitizedValue;
      exportPathNameInput.setSelectionRange(cursor, cursor);
    }
    updateExportUiState();
  });
  exportPathNameInput.addEventListener("blur", () => {
    exportPathNameInput.value = sanitizeExportPathName(exportPathNameInput.value);
    updateExportUiState();
  });
}

if (exportFilenameInput) {
  exportFilenameInput.addEventListener("input", () => {
    const sanitizedValue = sanitizeExportFilename(exportFilenameInput.value);
    if (exportFilenameInput.value !== sanitizedValue) {
      const cursor = sanitizedValue.length;
      exportFilenameInput.value = sanitizedValue;
      exportFilenameInput.setSelectionRange(cursor, cursor);
    }
    updateExportUiState();
  });
  exportFilenameInput.addEventListener("blur", () => {
    exportFilenameInput.value = sanitizeExportFilename(exportFilenameInput.value);
    updateExportUiState();
  });
}

if (exportLocationSelect) {
  exportLocationSelect.addEventListener("change", () => {
    updateExportUiState();
    if (exportLocationSelect.value === "custom" && exportCustomPathInput) {
      requestAnimationFrame(() => exportCustomPathInput.focus());
    }
  });
}

if (exportTypesSelect) {
  exportTypesSelect.addEventListener("change", () => {
    updateExportUiState();
  });
}

if (exportCustomPathInput) {
  exportCustomPathInput.addEventListener("input", () => {
    updateExportUiState();
  });
}

if (settingsModal) {
  settingsModal.addEventListener("click", (e) => {
    if (e.target && (e.target.classList.contains("modalBackdrop"))) closeSettings();
  });
} else console.warn("settingsModal element not found");

if (exportModal) {
  exportModal.addEventListener("click", (e) => {
    if (e.target && e.target.classList.contains("modalBackdrop")) closeExportModal();
  });
} else console.warn("exportModal element not found");

if (routeInfoModal) {
  routeInfoModal.addEventListener("click", (e) => {
    if (e.target && e.target.classList.contains("modalBackdrop")) closeRouteInfoModal();
  });
} else console.warn("routeInfoModal element not found");

if (planTemplateModal) {
  planTemplateModal.addEventListener("click", (e) => {
    if (e.target && e.target.classList.contains("modalBackdrop")) closePlanTemplateModal();
  });
}

if (planObjectDeleteModal) {
  planObjectDeleteModal.addEventListener("click", (e) => {
    if (e.target && e.target.classList.contains("modalBackdrop")) cancelPlanObjectDeleteModal();
  });
}

if (modeViewingBtn) modeViewingBtn.addEventListener("click", () => setMode("viewing"));

if (modePlanningBtn) modePlanningBtn.addEventListener("click", () => setMode("planning"));

if (btnPlanEditTemplate) {
  btnPlanEditTemplate.addEventListener("click", () => {
    openPlanTemplateModal();
  });
}

if (btnPlanAddObject) {
  btnPlanAddObject.onmousedown = (e) => {
    e.preventDefault();
  };
  btnPlanAddObject.onclick = () => {
    commitActivePlanObjectEdit();
    addPlanObject();
  };
}

if (planObjectListEl) {
  planObjectListEl.onmousedown = (e) => {
    if (!(e.target instanceof Element)) return;
    const actionBtn = e.target.closest(".planObjectRemoveActionBtn, .planMethodRemoveBtn, .planMethodAddBtn, .planObjectColorBtn");
    if (actionBtn) e.preventDefault();
  };
  planObjectListEl.onclick = (e) => {
    if (!(e.target instanceof Element)) return;
    const colorBtn = e.target.closest(".planObjectColorBtn");
    if (colorBtn) {
      cancelPlanObjectNameEdit();
      const objectId = colorBtn.getAttribute("data-object-id") || "";
      if (!objectId) return;
      planOpenColorPickerObjectId = planOpenColorPickerObjectId === objectId ? null : objectId;
      renderPlanObjects();
      return;
    }
    const methodAddBtn = e.target.closest(".planMethodAddBtn");
    if (methodAddBtn) {
      cancelPlanObjectNameEdit();
      const objectId = methodAddBtn.getAttribute("data-object-id") || "";
      if (objectId) openPlanMethodCreateModal(objectId);
      return;
    }
    const methodRemoveBtn = e.target.closest(".planMethodRemoveBtn");
    if (methodRemoveBtn) {
      cancelPlanObjectNameEdit();
      const objectId = methodRemoveBtn.getAttribute("data-object-id") || "";
      const methodId = methodRemoveBtn.getAttribute("data-method-id") || "";
      if (objectId && methodId) removePlanMethod(objectId, methodId);
      return;
    }
    const removeBtn = e.target.closest(".planObjectRemoveActionBtn");
    if (!removeBtn) return;
    const objectId = removeBtn.getAttribute("data-object-id") || "";
    if (!objectId) return;
    requestPlanObjectRemoval(objectId);
  };
  planObjectListEl.oninput = (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    if (!e.target.classList.contains("planObjectColorInput")) return;
    const objectId = e.target.getAttribute("data-object-id") || "";
    if (!objectId) return;
    setPlanObjectColor(objectId, e.target.value);
    planOpenColorPickerObjectId = objectId;
  };
}

function isClientInsidePlanningTimelineViewport(clientX, clientY) {
  if (!planningTimelineViewport) return false;
  const rect = planningTimelineViewport.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function isClientInsidePlanningSidebar(clientX, clientY) {
  if (!rightPlanningEl) return false;
  const rect = rightPlanningEl.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function hasValidPlanTimelineDropTarget() {
  return !!planTimelineDropTarget && getAppMode() === "planning" && planWaypoints.length >= 2;
}

function commitPlanTimelineDragTarget(context, target) {
  if (!context || !target) return null;
  let node = null;
  if (context.source === "sidebar") {
    node = insertPlanNode(context.objectId, context.methodId, target.beforeWaypoint, target.index);
  } else if (context.source === "node") {
    node = movePlanNode(context.nodeId, target.beforeWaypoint, target.index);
  }
  if (!node) return null;
  savePlanTimelineUi();
  selectPlanNode(node.id, { scrollSidebar: true });
  void (context.source === "sidebar" ? planningTelemetry.timelineNodeCreated : planningTelemetry.timelineNodeMoved).call(planningTelemetry, getPlanningTelemetryProperties({
    before_waypoint: node.beforeWaypoint,
    node_index: node.index,
  }));
  return node;
}

function positionPlanMethodDragGhost(ghost, clientX, clientY) {
  if (!ghost) return;
  ghost.style.left = `${clientX + 12}px`;
  ghost.style.top = `${clientY + 12}px`;
  ghost.style.zIndex = "1000";
}

function beginPlanPointerDrag({
  source,
  objectId,
  methodId,
  nodeId = null,
  sourceEl,
  startX,
  startY,
}) {
  hidePlanNodeTooltip({ immediate: true });
  planPointerDragState = {
    mode: "pending",
    source,
    objectId,
    methodId,
    nodeId,
    sourceEl,
    startX,
    startY,
    ghost: null,
  };
}

function ensurePlanPointerDragStarted(clientX, clientY) {
  const state = planPointerDragState;
  if (!state || state.mode === "dragging") return state;
  if (Math.hypot(clientX - state.startX, clientY - state.startY) < PLAN_POINTER_DRAG_THRESHOLD_PX) return state;
  state.mode = "dragging";
  state.sourceEl?.classList?.add("isDragging");
  state.ghost = createPlanMethodDragGhostCard({ objectId: state.objectId, methodId: state.methodId });
  positionPlanMethodDragGhost(state.ghost, clientX, clientY);
  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
  return state;
}

function updatePlanPointerDrag(clientX, clientY) {
  const state = planPointerDragState;
  if (!state) return;
  ensurePlanPointerDragStarted(clientX, clientY);
  if (state.mode !== "dragging") return;
  positionPlanMethodDragGhost(state.ghost, clientX, clientY);
  if (planWaypoints.length >= 2 && isClientInsidePlanningTimelineViewport(clientX, clientY)) {
    if (planningTimelineViewport) {
      const rect = planningTimelineViewport.getBoundingClientRect();
      if (clientX < rect.left + 40) planningTimelineViewport.scrollLeft -= 10;
      else if (clientX > rect.right - 40) planningTimelineViewport.scrollLeft += 10;
    }
    updatePlanTimelineDropTarget(clientX);
  } else {
    clearPlanTimelineDropTarget();
  }
}

function finishPlanPointerDrag(clientX, clientY) {
  const state = planPointerDragState;
  if (!state) return;
  hidePlanNodeTooltip({ immediate: true });
  if (state.mode === "dragging") {
    if (planWaypoints.length >= 2 && hasValidPlanTimelineDropTarget()) {
      commitPlanTimelineDragTarget({
        source: state.source,
        objectId: state.objectId,
        methodId: state.methodId,
        nodeId: state.nodeId,
      }, planTimelineDropTarget);
    } else if (state.source === "node" && isClientInsidePlanningSidebar(clientX, clientY) && state.nodeId) {
      removePlanNode(state.nodeId);
    }
  }
  if (state.ghost) state.ghost.remove();
  state.sourceEl?.classList?.remove("isDragging");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  planPointerDragState = null;
  clearPlanTimelineDropTarget();
}

if (planningEventTimelineEl) {
  planningEventTimelineEl.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest(".planningTimelineNode")) return;
    clearPlanNodeSelection();
    renderPlanningEventTimeline();
    renderPlanObjects();
    syncPlanObjectLatestValues();
  });
}

planningTimelineViewport?.addEventListener("scroll", () => {
  hidePlanNodeTooltip({ immediate: true });
});

window.addEventListener("blur", () => {
  hidePlanNodeTooltip({ immediate: true });
});

if (window.__motionViewPlanColorMousedownHandler) {
  document.removeEventListener("mousedown", window.__motionViewPlanColorMousedownHandler, true);
}
window.__motionViewPlanColorMousedownHandler = (e) => {
  if (!planOpenColorPickerObjectId) return;
  if (e.target instanceof Element && e.target.closest(".planObjectColorWrap")) return;
  planOpenColorPickerObjectId = null;
  renderPlanObjects();
};
document.addEventListener("mousedown", window.__motionViewPlanColorMousedownHandler, true);

if (btnPlanObjectDeleteClose) {
  btnPlanObjectDeleteClose.onclick = () => cancelPlanObjectDeleteModal();
}

if (btnPlanObjectDeleteCancel) {
  btnPlanObjectDeleteCancel.onclick = () => cancelPlanObjectDeleteModal();
}

if (btnPlanObjectDeleteConfirm) {
  btnPlanObjectDeleteConfirm.onclick = () => confirmPlanObjectRemoval();
}

if (btnPlanCopyCode) {
  btnPlanCopyCode.addEventListener("click", async () => {
    const code = buildPlanExportCode();
    if (!code) {
      setStatus("Add at least one waypoint and a template before copying code.");
      return;
    }
    try {
      await copyTextToClipboard(code);
      setStatus(`Copied generated code for ${planWaypoints.length} waypoint${planWaypoints.length === 1 ? "" : "s"}.`);
      void planningTelemetry.templateExported(getPlanningTelemetryProperties({
        export_surface: "clipboard",
        exported_chars: code.length,
        exported_bytes: getUtf8ByteLength(code),
      }));
    } catch (err) {
      console.error("Failed to copy planning export code:", err);
      setStatus(`Failed to copy code: ${err?.message || err}`);
    }
  });
}

if (btnPlanTemplateClose) {
  btnPlanTemplateClose.addEventListener("click", () => {
    closePlanTemplateModal();
  });
}

if (btnPlanTemplateCancel) {
  btnPlanTemplateCancel.addEventListener("click", () => {
    closePlanTemplateModal();
  });
}

if (btnPlanTemplateConfirm) {
  btnPlanTemplateConfirm.addEventListener("click", () => {
    confirmPlanTemplateModal();
  });
}

// Global Escape handler: close modals and prevent window-level behavior
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const helpOpen = helpModal && helpModal.style.display !== "none" && !helpModal.hasAttribute("hidden");
  const settingsOpen = settingsModal && settingsModal.style.display !== "none" && !settingsModal.hasAttribute("hidden");
  const exportOpen = exportModal && exportModal.style.display !== "none" && !exportModal.hasAttribute("hidden");
  const routeInfoOpen = routeInfoModal && routeInfoModal.style.display !== "none" && !routeInfoModal.hasAttribute("hidden");
  const planTemplateOpen = planTemplateModal && planTemplateModal.style.display !== "none" && !planTemplateModal.hasAttribute("hidden");
  const planObjectDeleteOpen = planObjectDeleteModal && planObjectDeleteModal.style.display !== "none" && !planObjectDeleteModal.hasAttribute("hidden");
  if (helpOpen) closeHelp();
  else if (settingsOpen) closeSettings();
  else if (exportOpen) closeExportModal();
  else if (routeInfoOpen) closeRouteInfoModal();
  else if (planTemplateOpen) closePlanTemplateModal();
  else if (planObjectDeleteOpen) closePlanObjectDeleteModal();
  else if (selectedWaypointId != null) {
    clearWaypointSelection();
    requestDrawAll();
  }
  e.preventDefault();
  e.stopPropagation();
}, true);

// Settings inputs event handlers
if (settingsUnitsSelect) {
  settingsUnitsSelect.addEventListener("change", () => {
    syncSettingsToMain();
  });
}
if (settingsFieldRotation) {
  settingsFieldRotation.addEventListener("change", () => {
    setFieldRotationDeg(Number(settingsFieldRotation.value) || 0);
    saveSettings();
  });
}
async function refreshFieldOptionsForSettingsChange() {
  const previousField = fieldSelect ? fieldSelect.value : DEFAULT_FIELD_KEY;
  loadFieldOptions();
  const nextField = getValidFieldKey(previousField);
  if (fieldSelect) fieldSelect.value = nextField;
  await loadFieldImage(nextField);
  saveSettings();
}

if (settingsFieldCompetition) {
  settingsFieldCompetition.addEventListener("change", async () => {
    fieldCompetition = normalizeFieldCompetition(settingsFieldCompetition.value);
    await refreshFieldOptionsForSettingsChange();
  });
}
if (settingsShowPreviousYearFields) {
  settingsShowPreviousYearFields.addEventListener("change", async () => {
    showPreviousYearFields = !!settingsShowPreviousYearFields.checked;
    await refreshFieldOptionsForSettingsChange();
  });
}
if (settingsRobotW) {
  settingsRobotW.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsRobotH) {
  settingsRobotH.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsOffX) {
  settingsOffX.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsOffY) {
  settingsOffY.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsOffTheta) {
  settingsOffTheta.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsMinSpeed) {
  settingsMinSpeed.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsMaxSpeed) {
  settingsMaxSpeed.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsLiveDebug) {
  settingsLiveDebug.addEventListener("change", () => {
    liveDebugEnabled = settingsLiveDebug.checked;
    saveSettings();
  });
}
if (settingsPlanMoveStep) {
  settingsPlanMoveStep.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsPlanSnapStep) {
  settingsPlanSnapStep.addEventListener("change", () => {
    syncSettingsToMain();
  });
}
if (settingsPlanThetaSnapStep) {
  settingsPlanThetaSnapStep.addEventListener("change", () => {
    syncSettingsToMain();
  });
}
if (settingsPlanLimitBounds) {
  settingsPlanLimitBounds.addEventListener("change", () => {
    saveSettings();
  });
}
if (settingsRobotImgScale) {
  settingsRobotImgScale.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsRobotImgOffX) {
  settingsRobotImgOffX.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsRobotImgOffY) {
  settingsRobotImgOffY.addEventListener("input", () => {
    syncSettingsToMain();
  });
}
if (settingsRobotImgRot) {
  settingsRobotImgRot.addEventListener("input", () => {
    syncSettingsToMain();
  });
}

function setProsDirStatus(message, kind = "info") {
  if (!prosDirStatusEl) return;
  prosDirStatusEl.textContent = message;
  if (kind === "error") prosDirStatusEl.style.color = "#ff9b9b";
  else if (kind === "ok") prosDirStatusEl.style.color = "#9fddb0";
  else prosDirStatusEl.style.color = "var(--muted)";
}

function setAutoStatus(message, kind = "info") {
  if (!prosDirAutoStatusEl) return;
  prosDirAutoStatusEl.textContent = message;
  if (kind === "error") {
    prosDirAutoStatusEl.style.color = "#ff9b9b";
  } else if (kind === "ok") {
    prosDirAutoStatusEl.style.color = "#9fddb0";
  } else {
    prosDirAutoStatusEl.style.color = "var(--muted)";
  }
}

function renderAutoResults(candidates) {
  if (!prosDirAutoResultsEl) {
    prosDirAutoResultsEl.hidden = true;
    return;
  }
  prosDirAutoResultsEl.innerHTML = "";
  prosDirAutoResultsEl.hidden = false;
  if (!candidates || !candidates.length) {
    prosDirAutoResultsEl.textContent = "";
    prosDirAutoResultsEl.style.color = "var(--muted)";
    return;
  }
  for (const dir of candidates) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.marginBottom = "6px";

    const pathEl = document.createElement("div");
    pathEl.textContent = dir;
    pathEl.style.flex = "1";
    pathEl.style.fontFamily = "monospace";
    pathEl.style.fontSize = "12px";

    const useBtn = document.createElement("button");
    useBtn.className = "iconBtn";
    useBtn.style.fontSize = "11px";
    useBtn.textContent = "Use";
    useBtn.addEventListener("click", () => {
      if (!prosDirInput) return;
      prosDirInput.value = dir;
      prosDirFromSettings = true;
      updateProsDir(dir);
      saveSettings();
      renderAutoResults([]);
      setAutoStatus("Applied.", "ok");
      prosDirAutoResultsEl.hidden = true;
    });

    row.appendChild(pathEl);
    row.appendChild(useBtn);
    prosDirAutoResultsEl.appendChild(row);
  }
}

function refreshWS() {
  if (!ensureBackendReady) return;
  refreshBridgeOrigin();
  updateConnectButtonState();

  if (prosDirInput && prosDirInput.value && prosDirInput.value.trim()) updateProsDir(prosDirInput.value);
  else setProsDirStatus("PROS directory not set. Live viewing disabled.", "error");

  // Best-effort refresh from backend
  loadProsDirFromAPI();
}

async function validateConfiguredProsDirWhenReady() {
  const configuredDir = prosDirInput?.value?.trim();
  if (configuredDir) {
    await updateProsDir(configuredDir);
    return;
  }
  await loadProsDirFromAPI();
}

// PROS directory input
async function updateProsDir(dir) {
  if (!dir) {
    prosDirValid = false;
    setProsDirStatus("PROS directory not set. Live viewing disabled.", "error");
    saveSettings();
    updateConnectButtonState();
    return;
  }

  if (dir === "None" /*None is default state */) { return; }
  try {
    const origin = refreshBridgeOrigin();
    if (!origin || !(await ensureBackendReady())) {
      prosDirValid = false;
      setProsDirStatus("Bridge not ready yet. Retrying...", "error");
      updateConnectButtonState();
      if (prosDirRetryTimer) clearTimeout(prosDirRetryTimer);
      if (prosDirRetryAttempts < 5) {
        prosDirRetryAttempts += 1;
        prosDirRetryTimer = setTimeout(() => updateProsDir(dir), 500);
      } else {
        setProsDirStatus("Bridge not ready yet. Try again in a moment.", "error");
      }
      return;
    }
    prosDirRetryAttempts = 0;
    const response = await fetch(`${origin}/api/pros-dir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: dir })
    });
    const result = await response.json();
    if (result.ok) {
      prosDirValid = true;
      setStatus(`PROS directory set to: ${result.dir}`);
      setProsDirStatus(`Using PROS project: ${result.dir}`, "ok");
      saveSettings();
      updateConnectButtonState();
    } else {
      prosDirValid = false;
      setStatus(`Failed to set PROS directory: ${result.status}`);
      setProsDirStatus(`Invalid PROS directory: ${result.status}`, "error");
      updateConnectButtonState();
    }
  } catch (e) {
    prosDirValid = false;
    console.error("Error updating PROS directory:", e);
    setStatus(`Error updating PROS directory: ${e.message || e}`);
    setProsDirStatus(`Error validating PROS directory: ${e.message || e}`, "error");
    updateConnectButtonState();
  }
}

if (prosDirInput) {
  let prosDirTimeout = null;
  prosDirInput.addEventListener("input", () => {
    // Debounce API calls
    if (prosDirTimeout) clearTimeout(prosDirTimeout);
    prosDirTimeout = setTimeout(() => {
      updateProsDir(prosDirInput.value);
    }, 500);
    saveSettings();
  });
}

// PROS directory browse button (placeholder - could use Tauri dialog API)
if (btnProsDirAuto) {
  btnProsDirAuto.addEventListener("click", async () => {
    if (!refreshBridgeOrigin() || !(await ensureBackendReady())) {
      setAutoStatus("Backend not ready.", "error");
      return;
    }
    setAutoStatus("Scanning…");
    try {
      const response = await fetch(`${ORIGIN}/api/pros-dir/auto`);
      const result = await response.json();
      if (!result.ok) {
        setAutoStatus(result.status || "Auto-detect failed.", "error");
        renderAutoResults([]);
        return;
      }
      renderAutoResults(result.candidates || []);
      setAutoStatus(`Found ${result.candidates?.length || 0} project(s).`, "ok");
    } catch (e) {
      console.error("Auto-detect failed:", e);
      setAutoStatus("Auto-detect failed.", "error");
      renderAutoResults([]);
    }
    refreshWS();
  });
}

// Load PROS directory from API on startup
async function loadProsDirFromAPI() {
  if (!refreshBridgeOrigin() || !(await ensureBackendReady())) return;
  try {
    const response = await fetch(`${ORIGIN}/api/pros-dir`);
    const result = await response.json();
    if (result.ok && result.dir && prosDirInput && result.dir !== "None") {
      const hasUserDir = prosDirFromSettings || (prosDirInput.value && prosDirInput.value.trim());
      if (hasUserDir) return;
      prosDirInput.value = result.dir;
      prosDirValid = true;
      setProsDirStatus(`Using PROS project: ${result.dir}`, "ok");
      saveSettings();
      if (btnLeftConnect) btnLeftConnect.disabled = false;
    } else {
      prosDirValid = false;
    }
  } catch (e) {
    prosDirValid = false;
    console.error("Error loading PROS directory from API:", e);
  }
}

// Check PROS dir and enable/disable connect button
function updateConnectButtonState() {
  if (!btnLeftConnect) return;
  // Connect button should be enabled only after the PROS dir has been validated,
  // unless we are already connected and need to allow disconnect.
  btnLeftConnect.disabled = (!prosDirValid && !leftConnected) || liveActionGate.active;
}

// Robot image upload
if (btnUploadRobotImage) {
  btnUploadRobotImage.addEventListener("click", () => {
    robotImageFile.click();
  });
}

if (robotImageFile) {
  robotImageFile.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate it"s an image
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      e.target.value = ""; // Clear the input
      return;
    }

    robotImagePath = typeof file.path === "string" && file.path ? file.path : null;

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const img = new Image();
        img.onload = () => {
          robotImg = img;
          robotImgOk = true;
          robotImgLoadTried = true;
          robotImageDataUrl = event.target.result;
          if (robotImgControlsEl) robotImgControlsEl.hidden = false;
          if (settingsRobotImgControls && robotImageEnabled) settingsRobotImgControls.hidden = false;
          draw();
        };
        img.onerror = () => {
          setStatus("Failed to load uploaded robot image.");
          robotImg = null;
          robotImgOk = false;
        };
        img.src = event.target.result;
        try {
          if (invoke && event.target?.result) {
            const savedPath = await invoke("save_robot_image", { dataUrl: event.target.result });
            if (savedPath) robotImagePath = savedPath;
          }
        } catch (saveErr) {
          console.warn("Failed to persist robot image to app data:", saveErr);
        }
        saveSettings();
      };
      reader.onerror = () => {
        setStatus("Failed to read robot image file.");
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Error loading robot image:", err);
      setStatus("Error loading robot image.");
    }
  });
}

// Robot image toggle
if (robotImageToggle) {
  robotImageToggle.addEventListener("change", (e) => {
    robotImageEnabled = e.target.checked;
    if (settingsRobotImgControls) {
      settingsRobotImgControls.hidden = !(robotImageEnabled && robotImgOk);
    }
    if (robotImageEnabled && !robotImgOk) {
      if (robotImageDataUrl) loadRobotImageFromDataUrl(robotImageDataUrl);
      else if (robotImagePath) loadRobotImageFromPath(robotImagePath);
    }
    requestDrawAll();
    saveSettings();
  });
}

document.addEventListener("pointermove", (e) => {
  updatePlanPointerDrag(e.clientX, e.clientY);
});

document.addEventListener("pointerup", (e) => {
  finishPlanPointerDrag(e.clientX, e.clientY);
});

document.addEventListener("pointercancel", () => {
  finishPlanPointerDrag(-1, -1);
});

btnPlay.addEventListener("click", () => {
  if (getAppMode() === "planning") {
    if (planPlaying) planPause();
    else planPlay();
    requestDrawAll();
    return;
  }
  if (!data) return;
  if (playing) { pause(); updatePoseReadout(); requestDrawAll(); }
  else play();
});

if (btnTogglePlanOverlay) {
  btnTogglePlanOverlay.addEventListener("click", () => {
    planOverlayVisible = !planOverlayVisible;
    btnTogglePlanOverlay.classList.toggle("isOn", planOverlayVisible);
    requestDrawAll();
    viewingTelemetry.planOverlayToggled({
      enabled: planOverlayVisible,
    }).catch(err => console.error(err));
  });
  btnTogglePlanOverlay.classList.toggle("isOn", planOverlayVisible);
}

speedSelect.addEventListener("change", () => {
  playRate = Number(speedSelect.value) || 1;
  saveSettings();
});



if (fieldSelect) {
  fieldSelect.addEventListener("change", (e) => {
    loadFieldImage(e.target.value);
    saveSettings();
  });
}

if (unitsSelect) {
  unitsSelect.addEventListener("change", (e) => {
    if (e.target.value !== currentUnits) {
      setUnitsFactorFromSelect(e.target.value);
      updateOffsetsFromInputs();
    }
    syncMainToSettings();
    saveSettings();
  });
}

robotWEl.addEventListener("input", () => {
  requestDrawAll();
  syncMainToSettings();
  saveSettings();
});

robotHEl.addEventListener("input", () => {
  requestDrawAll();
  syncMainToSettings();
  saveSettings();
});

function syncRobotImgTxFromInputs() {
  const scaleEl = robotImgScaleEl || settingsRobotImgScale;
  const offXEl = robotImgOffXEl || settingsRobotImgOffX;
  const offYEl = robotImgOffYEl || settingsRobotImgOffY;
  const rotEl = robotImgRotEl || settingsRobotImgRot;
  const alphaEl = robotImgAlphaEl || settingsRobotImgAlpha;

  robotImgTx.scale = clamp(Number(scaleEl?.value || 1), 0.05, 20);
  robotImgTx.offXIn = Number(offXEl?.value || 0);
  robotImgTx.offYIn = Number(offYEl?.value || 0);
  robotImgTx.rotDeg = Number(rotEl?.value || 0);
  robotImgTx.alpha = clamp(Number(alphaEl?.value || 100), 0, 100) / 100;
}

const onRobotImgInput = () => {
  syncRobotImgTxFromInputs();
  requestDrawAll();
  syncMainToSettings();
  saveSettings();
};

if (robotImgScaleEl) robotImgScaleEl.addEventListener("input", onRobotImgInput);
if (robotImgOffXEl) robotImgOffXEl.addEventListener("input", onRobotImgInput);
if (robotImgOffYEl) robotImgOffYEl.addEventListener("input", onRobotImgInput);
if (robotImgRotEl) robotImgRotEl.addEventListener("input", onRobotImgInput);
if (robotImgAlphaEl) robotImgAlphaEl.addEventListener("input", onRobotImgInput);
if (settingsRobotImgScale) settingsRobotImgScale.addEventListener("input", onRobotImgInput);
if (settingsRobotImgOffX) settingsRobotImgOffX.addEventListener("input", onRobotImgInput);
if (settingsRobotImgOffY) settingsRobotImgOffY.addEventListener("input", onRobotImgInput);
if (settingsRobotImgRot) settingsRobotImgRot.addEventListener("input", onRobotImgInput);
if (settingsRobotImgAlpha) settingsRobotImgAlpha.addEventListener("input", onRobotImgInput);


settingsMinSpeed.addEventListener("input", () => {
  computeSpeedNormRange();
  recomputeWatchMarkers();
  rebuildWatchMarkersByTime();
  requestDrawAll();
  updatePoseReadout();
  syncMainToSettings();
  saveSettings();
});

settingsMaxSpeed.addEventListener("input", () => {
  computeSpeedNormRange();
  recomputeWatchMarkers();
  rebuildWatchMarkersByTime();
  requestDrawAll();
  updatePoseReadout();
  syncMainToSettings();
  saveSettings();
});

if (settingsPlanMoveStep) {
  settingsPlanMoveStep.addEventListener("input", () => {
    saveSettings();
  });
}
if (settingsPlanSnapStep) {
  settingsPlanSnapStep.addEventListener("change", () => {
    saveSettings();
  });
}
if (settingsPlanThetaSnapStep) {
  settingsPlanThetaSnapStep.addEventListener("change", () => {
    saveSettings();
  });
}
if (settingsPlanLimitBounds) {
  settingsPlanLimitBounds.addEventListener("change", () => {
    saveSettings();
  });
}
function bindPlanField(el, getter, setter) {
  if (!el) return;
  el.addEventListener("focus", () => {
    // capture last known good value before edits
    el.dataset.lastValid = el.dataset.lastValid ?? String(getter());
    if (getAppMode() === "planning" && planSelected >= 0 && planSelected < planWaypoints.length && !el.dataset.undoSession) {
      pushPlanUndo();
      el.dataset.undoSession = "1";
    }
  });
  el.addEventListener("input", () => {
    if (planSelected < 0 || planSelected >= planWaypoints.length) return;
    if (el.value.trim() === "") return; // allow clearing while typing
    const v = Number(el.value);
    if (!isFinite(v)) return;
    setter(v);
    planChanged({ skipSelectionPanel: true });
    requestDrawAll();
  });
  el.addEventListener("blur", () => {
    if (planSelected < 0 || planSelected >= planWaypoints.length) return;
    const v = Number(el.value);
    if (!isFinite(v) || el.value.trim() === "") {
      const last = el.dataset.lastValid ?? String(getter());
      el.value = last;
      delete el.dataset.undoSession;
      return;
    }
    // normalize display on blur
    el.value = String(getter());
    el.dataset.lastValid = el.value;
    delete el.dataset.undoSession;
  });
}

function clampDigits(el, maxDigits) {
  const s = el.value;
  const parts = s.split(".");
  const intPart = parts[0].replace(/[^0-9-]/g, "");
  const fracPart = parts[1] ? parts[1].replace(/[^0-9]/g, "") : "";
  const trimmedInt = intPart.replace(/(?!^)-/g, "").slice(0, maxDigits + (intPart.startsWith("—") ? 1 : 0));
  el.value = fracPart.length ? `${trimmedInt}.${fracPart}` : trimmedInt;
}

bindPlanField(
  planSelXEl,
  () => fmtNum(planWaypoints[planSelected]?.x ?? 0, 2),
  (v) => { planWaypoints[planSelected].x = clampPlanCoordX(v); }
);
bindPlanField(
  planSelYEl,
  () => fmtNum(planWaypoints[planSelected]?.y ?? 0, 2),
  (v) => { planWaypoints[planSelected].y = clampPlanCoordY(v); }
);
bindPlanField(
  planSelThetaEl,
  () => fmtNum(planThetaDegAt(planSelected), 1),
  (v) => { planWaypoints[planSelected].theta = planThetaDisplayToRaw(v); }
);
bindPlanField(
  planSelSpeedEl,
  () => fmtNum(readPlanSpeed(planWaypoints[planSelected]?.speed, 127), 0),
  (v) => { planWaypoints[planSelected].speed = clampPlanSpeed(v); }
);

if (planSelXEl) {
  planSelXEl.addEventListener("input", () => clampDigits(planSelXEl, 2));
}
if (planSelYEl) {
  planSelYEl.addEventListener("input", () => clampDigits(planSelYEl, 2));
}
if (planSelThetaEl) {
  planSelThetaEl.addEventListener("input", () => clampDigits(planSelThetaEl, 3));
  planSelThetaEl.addEventListener("blur", () => {
    if (planSelected < 0 || planSelected >= planWaypoints.length) return;
    const v = Number(planSelThetaEl.value);
    if (isFinite(v)) {
      planWaypoints[planSelected].theta = planThetaDisplayToRaw(v);
      updatePlanSelectionPanel();
      requestDrawAll();
    }
  });
}
if (planSelSpeedEl) {
  planSelSpeedEl.addEventListener("input", () => clampDigits(planSelSpeedEl, 3));
  planSelSpeedEl.addEventListener("blur", () => {
    if (planSelected < 0 || planSelected >= planWaypoints.length) return;
    const v = Number(planSelSpeedEl.value);
    if (isFinite(v)) {
      planWaypoints[planSelected].speed = clampPlanSpeed(v);
      updatePlanSelectionPanel();
      requestDrawAll();
    }
  });
}

offXEl.addEventListener("input", () => {
  updateOffsetsFromInputs();
  syncMainToSettings();
  saveSettings();
});
offYEl.addEventListener("input", () => {
  updateOffsetsFromInputs();
  syncMainToSettings();
  saveSettings();
});
offThetaEl.addEventListener("input", () => {
  updateOffsetsFromInputs();
  syncMainToSettings();
  saveSettings();
});

if (watchSort) watchSort.addEventListener("change", () => { renderWatchList(); requestDrawAll(); });
if (watchFilter) watchFilter.addEventListener("change", () => {
  renderWatchList();
  requestDrawAll();
});
if (logSort) logSort.addEventListener("change", () => { renderLogList(); });
if (waypointFilter) waypointFilter.addEventListener("change", () => {
  renderWaypointList();
  requestDrawAll();
});

const btnClearField = document.getElementById("btnClearField");

function clearAllPosesAndWatches() {
  // Stop playback/hover/locks so UI doesn’t reference stale indices
  try { playing = false; } catch { }
  try { hoverTimelineTime = null; } catch { }
  try { trackHover = null; } catch { }
  try { trackLockActive = false; } catch { }

  // Clear core data
  rawPoses = createPoseStore();
  watches = [];
  logs = [];
  waypoints = [];
  waypointsById = new Map();
  selectedWaypointId = null;
  selectedWaypointEventTime = null;

  try { watchMarkers = []; } catch { }
  try { watchByLabel = {}; } catch { }
  try { lastPoseIndex = 0; } catch { }
  liveLastPoseT = null;
  liveLastPoseCount = 0;
  liveLastWatchCount = 0;
  liveLastRenderAt = 0;
  try { livePendingBuffer.clear(); } catch { }
  setImportedRouteMeta(null);

  if (typeof data === "object" && data) {
    data.poses = [];
    data.watches = [];
    data.logs = [];
    data.waypoints = [];
  }

  try { renderPoseList?.(); } catch { }
  try { renderWatchList?.(); } catch { }
  try { refreshPinnedWatchPanels?.(); } catch { }
  try { renderLogList?.(); } catch { }
  try { renderWaypointFilter?.(); } catch { }
  try { renderWaypointList?.(); } catch { }
  try { updatePoseReadout?.(); } catch { }
  try { updateFloatingInfo?.(null, 0); } catch { }
  try { requestDrawAll?.(); } catch { } 2
}

btnClearField?.addEventListener("click", (event) => {
  if (event.metaKey || event.ctrlKey) {
    // Clear everything across modes
    const clearAll = () => {
      clearAllPosesAndWatches();
      resetLiveWin();
      if (getAppMode() === "planning") pushPlanUndo();
      clearPlanningModeData();
      requestDrawAll();
      setStatus("Cleared Field and Planned Path");
    };
    if (getAppMode() === "planning" && hasAnyPlanMethods()) {
      openPlanDangerConfirmModal("Are you sure you want to clear the field and Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearAll);
      return;
    }
    clearAll();
    return;
  }

  if (getAppMode() === "planning") {
    const clearPlanOnly = () => {
      pushPlanUndo();
      clearPlanningModeData();
      requestDrawAll();
      setStatus("Cleared Planned Path");
    };
    if (hasAnyPlanMethods()) {
      openPlanDangerConfirmModal("Are you sure you want to clear Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearPlanOnly);
      return;
    }
    clearPlanOnly();
  } else {
    clearAllPosesAndWatches();
    resetLiveWin();
    setStatus("Cleared Field");
  }
});


document.addEventListener("keydown", (e) => {
  const mouseTag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  const isTypingTarget = (mouseTag === "input" || mouseTag === "textarea" || (e.target && e.target.isContentEditable));
  if (isTypingTarget && e.target !== liveWinEl) return;

  if (getAppMode() === "planning" && planSelectedNodeId && (e.key === "Backspace" || e.key === "Delete")) {
    const planTemplateOpen = planTemplateModal && planTemplateModal.style.display !== "none" && !planTemplateModal.hasAttribute("hidden");
    const planObjectDeleteOpen = planObjectDeleteModal && planObjectDeleteModal.style.display !== "none" && !planObjectDeleteModal.hasAttribute("hidden");
    if (!planTemplateOpen && !planObjectDeleteOpen) {
      e.preventDefault();
      removePlanNode(planSelectedNodeId);
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
    if (e.key === "1") {
      e.preventDefault();
      setMode("viewing");
      return;
    }

    if (e.key === "2") {
      e.preventDefault();
      setMode("planning");
      return;
    }

    if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      fileEl.click();
      return;
    }

    if (e.key === "r" || e.key === "R") {
      if (getAppMode() !== "viewing") return;
      e.preventDefault();
      btnLeftRefresh?.click();
      return;
    }

    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      if (getAppMode() !== "viewing") return;
      if (leftConnected) void disconnectLeft();
      else void connectLeft();
      return;
    }
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (getAppMode() !== "viewing") return;

      if (leftConnected) {
        if (!leftStreaming) void startStreaming();
        else void stopStreaming(false);
      }
      return;
    }

    if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      if (getAppMode() === "planning") {
        const clearPlanOnly = () => {
          pushPlanUndo();
          clearPlanningModeData();
          requestDrawAll();
          setStatus("Cleared Planned Path");
        };
        if (hasAnyPlanMethods()) {
          openPlanDangerConfirmModal("Are you sure you want to clear Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearPlanOnly);
          return;
        }
        clearPlanOnly();
      } else {
        clearAllPosesAndWatches();
        resetLiveWin();
        setStatus("Cleared Field");
      }
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    // Clear everything across modes
    const clearAll = () => {
      clearAllPosesAndWatches();
      resetLiveWin();
      if (getAppMode() === "planning") pushPlanUndo();
      clearPlanningModeData();
      requestDrawAll();
      setStatus("Cleared Field and Planned Path");
    };
    if (hasAnyPlanMethods()) {
      openPlanDangerConfirmModal("Are you sure you want to clear the field and Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearAll);
      return;
    }
    clearAll();
    return;
  }

  if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      if (getAppMode() === "viewing" && btnTogglePlanOverlay) btnTogglePlanOverlay.click();
      return;
    }

    if (e.key === "t" || e.key === "T") {
      toggleFloatingInfo();
      return;
    }

    if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      if (getAppMode() !== "viewing") return;
      toggleCurrentWatchGraphPanel();
      return;
    }
  }

  if (!e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && (e.key === "N" || e.key === "n")) {
    e.preventDefault();
    openFloatingWatch(null);
    return;
  }

  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    resetFieldPosition();
    return;
  }

  if (getAppMode() === "planning") {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (!e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        planUndo();
        return;
      }
      if (e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        planRedo();
        return;
      }
    }
    if (e.code === "Space") {
      e.preventDefault();
      if (planPlaying) planPause();
      else planPlay();
      requestDrawAll();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && planSelectedSet.size) {
      e.preventDefault();
      pushPlanUndo();
      const toRemove = Array.from(planSelectedSet).sort((a, b) => b - a);
      for (const idx of toRemove) {
        if (idx >= 0 && idx < planWaypoints.length) planWaypoints.splice(idx, 1);
      }
      planSetSelection([]);
      planChanged();
      requestDrawAll();
      return;
    }
    const step = getPlanMoveStepIn();
    if (planSelectedSet.size) {
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft" && e.shiftKey) dx = -step * 5;
      else if (e.key === "ArrowLeft") dx = -step;

      if (e.key === "ArrowDown" && e.shiftKey) dy = -step * 5;
      else if (e.key === "ArrowDown") dy = -step;

      if (e.key === "ArrowRight" && e.shiftKey) dx = step * 5;
      else if (e.key === "ArrowRight") dx = step;

      if (e.key === "ArrowUp" && e.shiftKey) dy = step * 5;
      else if (e.key === "ArrowUp") dy = step;

      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        pushPlanUndo();
        // Adjust movement for field rotation so arrows follow screen directions.
        const c = fieldRotationCos;
        const s = fieldRotationSin;
        const rdx = dx * c + dy * s;
        const rdy = -dx * s + dy * c;
        for (const idx of planSelectedSet) {
          if (idx >= 0 && idx < planWaypoints.length) {
            planWaypoints[idx].x = clampPlanCoordX(planWaypoints[idx].x + rdx);
            planWaypoints[idx].y = clampPlanCoordY(planWaypoints[idx].y + rdy);
          }
        }
        planChanged();
        requestDrawAll();
        sanitizeOffsetInputs();
        return;
      }
    }
  }
  if (!data) return;

  // Space toggles "auto-follow head" while connected in livestream mode.
  if (e.code === "Space" && leftConnected) {
    e.preventDefault();
    if (liveAutoFollowHead) {
      // about to turn it OFF = freeze at current index
      lastPoseIndex = selectedIndex;
      liveAutoFollowHead = false;
    } else {
      liveAutoFollowHead = true;
    }
    if (window.__live) window.__live.autoFollowHead = !!liveAutoFollowHead;
    setStatus(`Live View: Auto-follow head: ${liveAutoFollowHead ? "ON" : "OFF"} (Space)`);
    return;
  } else if (e.code === "Space") {
    e.preventDefault();
    playing ? (pause(), updatePoseReadout(), requestDrawAll()) : play();
  }

  if (e.code === "ArrowLeft") {
    e.preventDefault();
    pause();
    clearTrackHover(true);
    clearTrackLock();
    selectedWatch = null;
    selectedLogTime = null;
    selectedWaypointId = null;
    selectedWaypointEventTime = null;
    highlightWaypointInList(null, null, false);
    selectedIndex = Math.max(0, selectedIndex - 1);
    lastPoseIndex = selectedIndex;
    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
  }
  if (e.code === "ArrowRight") {
    e.preventDefault();
    pause();
    clearTrackHover(true);
    clearTrackLock();
    selectedWatch = null;
    selectedLogTime = null;
    selectedWaypointId = null;
    selectedWaypointEventTime = null;
    highlightWaypointInList(null, null, false);
    selectedIndex = Math.min(rawPoses.length - 1, selectedIndex + 1);
    lastPoseIndex = selectedIndex;
    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
  }
});
sanitizeExportFilename();
// -------- init --------
await appTelemetry.loaded({
  plan_saved: planWaypoints.length > 0,
  plan_points: planWaypoints.length,
});
loadFieldOptions();
await loadSettings();
await loadSavedPaths();
await loadDemoRouteIfUpgraded();
setMode("viewing");

async function appExit() {
  try {
    if (robotImageDataUrl && invoke && !robotImagePath) {
      try {
        const savedPath = await invoke("save_robot_image", { dataUrl: robotImageDataUrl });
        if (savedPath) robotImagePath = savedPath;
      } catch (e) {
        console.warn("Failed to persist robot image during exit:", e);
      }
    }
    await saveSavedPathsNow();
    await saveSettings();
  } catch (err) { }

  await liveTelemetry.totalStreamingDuration();

  await liveTelemetry.livestreamMetrics({
    totalPosesReceived: telemetryMetrics.totalPosesReceived,
    totalLogsReceived: telemetryMetrics.totalLogsReceived,
    totalWatchesReceived: telemetryMetrics.totalWatchesReceived,
    totalWaypointsReceived: telemetryMetrics.totalWaypointsReceived,
  });

  const uptime = fmtNum(performance.now() / 1000, 2) > 60
    ? fmtNum(performance.now() / 1000 / 60, 2)
    : fmtNum(performance.now() / 1000, 2);

  await appTelemetry.exiting({
    uptime: Number(uptime),
  });

}

const setupExitHandler = async () => {
  const appWindow = getCurrentWindow();
  if (!appWindow?.listen) return;
  let appQuitInFlight = false;

  const beginAppQuit = async () => {
    if (appQuitInFlight) return;
    appQuitInFlight = true;
    setStatus("App closing");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await appExit();
    try {
      await invoke("finalize_app_quit");
    } catch (err) {
      console.error("Failed to finalize app quit:", err);
      appQuitInFlight = false;
    }
  };

  // Listen for the user clicking the "X"
  await appWindow.listen("tauri://close-requested", async () => {
    await beginAppQuit();
  });

  await appWindow.listen("motionview://app-quit-requested", async () => {
    await beginAppQuit();
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && (event.key === "q" || event.key === "Q")) {
      event.preventDefault();
      void beginAppQuit();
    }
  });
};

// Ensure modals start hidden
if (helpModal) {
  helpModal.setAttribute("hidden", "");
  helpModal.style.display = "none";
}
if (keybindsModal) {
  keybindsModal.setAttribute("hidden", "");
  keybindsModal.style.display = "none";
}
if (settingsModal) {
  settingsModal.setAttribute("hidden", "");
  settingsModal.style.display = "none";
}
if (planTemplateModal) {
  planTemplateModal.setAttribute("hidden", "");
  planTemplateModal.style.display = "none";
}
// Load PROS dir from backend after a short delay to ensure ORIGIN is set
setTimeout(() => {
  try {
    validateConfiguredProsDirWhenReady();
    updateConnectButtonState();
  } catch (e) {
    console.error("Error loading PROS dir:", e);
  }
}, 500);

let bridgeReadyInitInFlight = false;
const bridgeReadyPoll = setInterval(() => {
  if (bridgeReadyInitInFlight) return;
  bridgeReadyInitInFlight = true;
  void (async () => {
    if (!(await ensureBridgeOriginReady())) return;
    if (!(await waitForBackendReady(8000, 250))) return;
    clearInterval(bridgeReadyPoll);
    await validateConfiguredProsDirWhenReady();
  })().finally(() => {
    bridgeReadyInitInFlight = false;
  });
}, 250);
window.addEventListener("resize", () => {
  updateFieldLayout(true); // keep bounds, recompute square sizing
  resizeTimeline();
  resizePlanningTimeline();
  resizeWatchGraphChart();
  scheduleTopBarStatusLayout();
});

if (typeof ResizeObserver === "function") {
  const topBarResizeObserver = new ResizeObserver(() => {
    scheduleTopBarStatusLayout();
  });
  if (topBarEl) topBarResizeObserver.observe(topBarEl);
  if (topBarContentEl) topBarResizeObserver.observe(topBarContentEl);
  if (topBarLeftEl) topBarResizeObserver.observe(topBarLeftEl);
  if (topBarCenterEl) topBarResizeObserver.observe(topBarCenterEl);
  if (topBarRightEl) topBarResizeObserver.observe(topBarRightEl);
}

if (topBarEl) {
  topBarEl.addEventListener("scroll", () => {
    topBarSavedScrollLeft = topBarEl.scrollLeft || 0;
  }, { passive: true });
}

updateFieldLayout(false);
resizeTimeline();
resizePlanningTimeline();
scheduleTopBarStatusLayout();
if (robotImgControlsEl) robotImgControlsEl.hidden = true;
if (settingsRobotImgControls) settingsRobotImgControls.hidden = true;
syncRobotImgTxFromInputs();
loadRobotImage();
drawFirstField();
updatePlanControls();
void setupExitHandler();
