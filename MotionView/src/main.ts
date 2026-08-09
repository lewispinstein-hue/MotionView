// @ts-nocheck
import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import fitIconUrl from "./assets/svg/common/fit.svg?url";
import demoRouteUrl from "./assets/demo/getting-started-route.json?url";
import changeObjectColorIconUrl from "./assets/svg/planning/changeObjectColor.svg?url";
import removePlanningObjectIconUrl from "./assets/svg/planning/removePlanningObject.svg?url";
import invisibleWatchIconUrl from "./assets/svg/viewing/invisibleWatch.svg?url";
import pinWatchIconUrl from "./assets/svg/viewing/pinWatch.svg?url";
import visibleWatchIconUrl from "./assets/svg/viewing/visibleWatch.svg?url";
import watchGraphIconUrl from "./assets/svg/viewing/watchGraph.svg?url";
import { createTopBar } from "./app/createTopBar";
import { createModeController } from "./app/modeController";
import { applyLiveButtonState } from "./live/liveDomAdapter";
import { LiveActionGate, LivePendingBuffer, LiveWebSocketClient, stripToTag } from "./live/liveCore";
import { LiveConsoleBuffer } from "./live/liveConsole";
import { createFieldRenderer, FIELD_BOUNDS_IN, CANVAS_ZOOM_MIN } from "./render/createFieldRenderer";
import {
  DEFAULT_FIELD_KEY,
  getValidFieldKey as getValidFieldKeyForOptions,
  getVisibleFieldImages as getVisibleFieldImagesForOptions,
  normalizeFieldCompetition,
} from "./render/fieldImages";
import {
  buildPlanExportCode,
  createPlanningMode,
  createPlanMethodId,
  createPlanNodeId,
  createPlanObjectId,
  getContrastTextColor,
  getDefaultPlanObjectColor,
  getDefaultPlanObjectName,
  getPlanMethodById,
  getPlanMethodNumber,
  getPlanMethodTooltipName,
  getPlanNodeEffectiveMethod,
  getPlanObjectById,
  getUtf8ByteLength,
  hasPlanNodeMethodOverride,
  createPlanningSidebarRenderer,
  createPlanningTimelineRenderer,
  normalizePlanNodes,
  normalizePlanObjects,
  serializePlanNode,
  setPlanNodeCodeOverride,
} from "./planning";
import { createPoseStore } from "./state/poseStore";
import { appTelemetry, exportTelemetry, initTelemetry, liveTelemetry, planningTelemetry, telemetryClient, viewingTelemetry } from "./telemetry/createTelemetry";
import {
  buildWaypointState,
  createWatchGraph,
  createViewingLists,
  createViewingFieldOverlayRenderer,
  createViewingFieldInteraction,
  createFloatingInfo,
  createViewingInput,
  createViewingMode,
  createViewingPlayback,
  createViewingRendering,
  createViewingSelection,
  createViewingTimeline,
  createWatchVisibility,
  lastWatchAtTime,
  normalizeLogs,
  normalizeSystemLogMessage,
  normalizeWatches,
  normalizeWaypointType,
  parseWaypointNumber,
  parseWaypointParams,
  scrollIntoViewIfNeeded,
  sortWatchMarkersByTime,
  watchGraphKeyForWatch,
  waypointEventCount,
} from "./viewing";

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

let APP_VERSION = telemetryClient.getAppVersion();

void initTelemetry()
  .then((version) => {
    APP_VERSION = version;
    const versionDisplayEl = document.getElementById("versionDisplay");
    if (versionDisplayEl) versionDisplayEl.textContent = APP_VERSION;
  })
  .catch((err) => {
    console.warn("Telemetry initialization failed:", err);
  });
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

const btnFile = document.getElementById("btnFile");
const btnLeftStop = document.getElementById("btnLeftStop");
const btnLeftConnect = document.getElementById("btnLeftConnect");
const btnLeftRefresh = document.getElementById("btnLeftRefresh");
const btnTogglePlanOverlay = document.getElementById("btnTogglePlanOverlay");
const helpModal = document.getElementById("helpModal");
const btnHelpClose = document.getElementById("btnHelpClose");
const btnHelpKeybinds = document.getElementById("btnHelpKeybinds");
const keybindsModal = document.getElementById("keybindsModal");
const btnKeybindsClose = document.getElementById("btnKeybindsClose");
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
const settingsModal = document.getElementById("settingsModal");
const btnSettingsClose = document.getElementById("btnSettingsClose");
const prosDirInput = document.getElementById("prosDirInput");
const btnProsDirAuto = document.getElementById("btnProsDirAuto");
const btnUploadRobotImage = document.getElementById("btnUploadRobotImage");
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
const settingsPlanSnapStepLabel = document.getElementById("settingsPlanSnapStepLabel");
const settingsPlanMoveStepLabel = document.getElementById("settingsPlanMoveStepLabel");
const settingsPlanMoveStep = document.getElementById("settingsPlanMoveStep");
const settingsPlanSnapStep = document.getElementById("settingsPlanSnapStep");
const settingsPlanThetaSnapStep = document.getElementById("settingsPlanThetaSnapStep");
const settingsPlanLimitBounds = document.getElementById("settingsPlanLimitBounds");
const planSplit = document.getElementById("planSplit");
const planListEl = document.getElementById("planList");
const planCountEl = document.getElementById("planCount");
const planSelIndexEl = document.getElementById("planSelIndex");
const planSelXLabel = document.getElementById("planSelXLabel");
const planSelYLabel = document.getElementById("planSelYLabel");
const planSelXEl = document.getElementById("planSelX");
const planSelYEl = document.getElementById("planSelY");
const planSelThetaEl = document.getElementById("planSelTheta");
const planSelSpeedEl = document.getElementById("planSelSpeed");
const versionDisplayEl = document.getElementById("versionDisplay");
if (versionDisplayEl) versionDisplayEl.textContent = APP_VERSION;

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

const DEFAULT_PLAN_EXPORT_TEMPLATE = "moveToPoint(${x}, ${y}, ${theta});";

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

// FLOATING INFO WINDOW SIZE
const floatingWindowBounds = {
  minWidth: 30,
  minHeight: 49,
  maxWidth: 400,
  maxHeight: 600
}

let data = null;
let showPreviousYearFields = true;
let fieldCompetition = "all";

function readPlanSpeed(value, fallback = 127) {
  const num = Number(value);
  return Number.isFinite(num) ? clampPlanSpeed(num) : fallback;
}

function getVisibleFieldImages() {
  return getVisibleFieldImagesForOptions({
    competition: fieldCompetition,
    showPreviousYearFields,
  });
}

function getValidFieldKey(fieldKey) {
  return getValidFieldKeyForOptions(fieldKey, {
    competition: fieldCompetition,
    showPreviousYearFields,
  });
}

// Raw poses are stored in FILE units; we convert to inches for rendering.
// Fields: t, x, y, theta, l_vel, r_vel, speed_raw, speed_norm
let viewingWatchVisibility = null;
function currentVisibilityForWatch(watch) {
  return viewingWatchVisibility?.currentVisibilityForWatch(watch) ?? true;
}

const viewingMode = createViewingMode({
  createPoseStore,
  toNumMaybe,
  normalizeLogLevel,
  getWatchVisibility: currentVisibilityForWatch,
});
const rawPoses = viewingMode.data.getPoses();

// Watches: normalized
const watches = viewingMode.data.getWatches();
const logs = viewingMode.data.getLogs();
const waypoints = viewingMode.data.getWaypoints();
const waypointsById = viewingMode.data.getWaypointMap();
const watchMarkers = viewingMode.data.getWatchMarkers(); // {watch, t, pose(in), ok, idx, dt}

const viewingSelection = createViewingSelection();
viewingWatchVisibility = createWatchVisibility({
  getWatches: () => watches,
  getFilterValue: () => watchFilterValue(),
  graphKeyForWatch: (watch) => watchGraphKeyForWatch(watch),
  updateButtons: (key, iconId, title) => {
    const buttons = watchList?.querySelectorAll(`.watchVisibilityBtn[data-watch-visibility-key="${key}"]`) ?? [];
    for (const button of buttons) {
      button.dataset.iconId = iconId;
      button.dataset.title = title;
    }
    updateWatchVisibilityButtons(key);
  },
});

let viewingFieldInteraction = null;
let watchGraph = null;

const telemetryMetrics = {
  totalPosesReceived: 0,
  totalLogsReceived: 0,
  totalWatchesReceived: 0,
  totalWaypointsReceived: 0,
};
let pendingExportRequest = null;
let importedRouteMeta = null;

let playRate = 1;

const modeController = createModeController("viewing");
let playButtonLabel = "▶";

const topBar = createTopBar({
  onOpenFile: (file, input) => openFile(file, input),
  onRobotImageSelected: (file, input) => handleRobotImageFile(file, input),
  onFitField: () => fieldRenderer.resetFieldPosition(),
  onClearField: (event) => handleClearFieldClick(event),
  onOpenSettings: () => openSettings(),
  onOpenHelp: () => openHelp(),
  onSetMode: (mode) => modeController.setMode(mode),
  onTogglePlayback: () => togglePlaybackForCurrentMode(),
  onPlaybackSpeedChanged: (speed) => {
    playRate = speed;
    viewingPlayback.setPlayRate(playRate);
    saveSettings();
  },
  onFieldChanged: async (fieldKey) => {
    await fieldRenderer.loadFieldImage(getValidFieldKey(fieldKey));
    saveSettings();
  },
});

function syncTopBarPlayback(label = playButtonLabel) {
  playButtonLabel = label;
  const liveConnected = !!window.__live?.connected;
  const mode = modeController.getMode();
  const planningWaypointCount = planningMode?.state?.getWaypointCount?.() ?? 0;
  const enabled = !liveConnected && (mode === "planning" ? planningWaypointCount >= 2 : rawPoses.length >= 2);
  const playing = label === "⏸";
  topBar.syncPlayback({ enabled, playing, label });
}

const fieldRenderer = createFieldRenderer({
  canvas,
  ctx,
  isTauriRuntime,
  resolveResource,
  invokeCommand: (command, args) => invoke(command, args),
  getMode: modeController.getMode,
  getViewingPathPoses: () => rawPoses.map(poseToInches),
  getViewingPose: () => currentDisplayPose(),
  getPlanningPose: () => planSampleAtDist(planningMode.playback.getPlaybackDistance()),
  getRobotDimensions: () => robotDimsInches(),
  fieldHeadingToCanvasRotationDeg,
  heatColorFromNorm,
  drawViewingOverlay: () => {
    viewingFieldOverlayRenderer.drawWaypointDots();
    viewingFieldOverlayRenderer.drawWatchDots();
  },
  drawPlanningOverlay: (force = false) => planningMode.rendering.drawFieldOverlay(force),
  isPlanningOverlayVisible: () => planningMode.state.isOverlayVisible(),
  drawViewingTimeline: () => viewingTimeline.draw(),
  drawPlanningTimeline: () => planningMode.rendering.drawTimeline(),
  drawWaypointOffsetOverlay: (pose) => drawWaypointOffsetOverlay(pose),
  setStatus: (message) => topBar.setStatus(message),
  onRobotImageAvailabilityChanged: (available) => {
    if (robotImgControlsEl) robotImgControlsEl.hidden = !available;
    if (settingsRobotImgControls) settingsRobotImgControls.hidden = !(fieldRenderer.isRobotImageEnabled() && available);
  },
  onFieldImageLoaded: (field) => viewingTelemetry.fieldImageLoaded({ field }),
});

let planningMode = createPlanningMode({
  getAppMode: modeController.getMode,
  requestDrawAll: fieldRenderer.requestDrawAll,
  setStatus: topBar.setStatus,
  scheduleSavedPathsSave,
  readPlanSpeed,
  clampWaypointX: clampPlanCoordX,
  clampWaypointY: clampPlanCoordY,
  getPlanTotalLength: planTotalLength,
  getPlanSpeedUnitsPerSecAtDistance: getPlanSpeedUnitsPerSecAtDist,
  getPlaybackRate: () => playRate,
  setPlayButtonLabel: syncTopBarPlayback,
  setPlanningDistanceUi: (distanceInches, totalInches, waypointCount) => {
    if (planTimePill) {
      planTimePill.textContent = `Plan: ${formatDistanceFromInches(distanceInches, 2)} / ${formatDistanceFromInches(totalInches, 2)} ${currentUnits}`;
    }
    if (planPointPill) {
      planPointPill.textContent = `Points: ${waypointCount}`;
    }
  },
  setPlanningControlsAvailability: (waypointCount) => {
    syncTopBarPlayback();
    if (btnPlanCopyCode) btnPlanCopyCode.disabled = waypointCount === 0;
  },
  onPlanningDistanceChanged: () => {
    syncPlanObjectLatestValues();
  },
  onPlanningCleared: () => {
    planChanged();
    planningSidebarRenderer.renderPlanObjects();
    planningMode.rendering.renderTimelineDom();
    normalizePlanningTimelineHeightForContent();
  },
  onPlanningDataLoaded: () => {
    pruneInvalidPlanNodes();
    planningSidebarRenderer.renderPlanObjects();
    planningMode.rendering.renderTimelineDom();
    normalizePlanningTimelineHeightForContent();
  },
  onPlanningChanged: (options) => {
    planChanged(options);
  },
}, {
  defaultExportTemplate: DEFAULT_PLAN_EXPORT_TEMPLATE,
  maxUndoSteps: MAX_PLAN_UNDO,
});

modeController.subscribe((mode) => {
  document.body.classList.toggle("mode-planning", mode === "planning");
  syncTimelineBarCollapsedForMode(mode);
  if (mode === "planning" && viewingPlayback.isPlaying()) viewingPlayback.pause();
  if (mode === "viewing" && planningMode.playback.isPlaying()) planningMode.playback.pause();
  planningMode.actions.clearSelection();
  topBar.syncMode(mode);
  fieldRenderer.updateFieldLayout(true);
  resizeTimeline();
  resizePlanningTimeline();
  planningSidebarRenderer.renderPlanList();
  planningMode.playback.updateControls();
  planningMode.playback.setDistance(planningMode.playback.getPlaybackDistance());
  void appTelemetry.modeChanged({
    mode,
  });
});

// -------- planning --------
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
let savedPathsSaveTimer = null;

const PLAN_NODE_TOOLTIP_DELAY_MS = 90;

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

function getPlanNodeById(nodeId) {
  return planningMode.nodes.find((entry) => entry.id === nodeId) || null;
}

function clearPlanNodeSelection() {
  planningMode.selectedNodeId = null;
}

function getSortedPlanNodes() {
  return [...planningMode.nodes].sort((a, b) => {
    if (a.beforeWaypoint !== b.beforeWaypoint) return a.beforeWaypoint - b.beforeWaypoint;
    if (a.index !== b.index) return a.index - b.index;
    return String(a.id).localeCompare(String(b.id));
  });
}

function normalizePlanNodeOrdering() {
  const maxBucket = Math.max(0, planningMode.waypoints.length);
  const buckets = Array.from({ length: maxBucket + 1 }, () => []);
  for (const node of planningMode.nodes) {
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
  if (planningMode.waypoints.length === 0) {
    const hadNodes = planningMode.nodes.length > 0;
    planningMode.nodes = [];
    if (planningMode.selectedNodeId) {
      clearPlanNodeSelection();
      return true;
    }
    return hadNodes;
  }
  const objectIds = new Set(planningMode.objects.map((entry) => entry.id));
  const methodsByObject = new Map(planningMode.objects.map((entry) => [entry.id, new Set(entry.methods.map((method) => method.id))]));
  const maxBucket = Math.max(0, planningMode.waypoints.length);
  let changed = false;
  planningMode.nodes = planningMode.nodes.filter((node) => {
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
  if (planningMode.selectedNodeId && !getPlanNodeById(planningMode.selectedNodeId)) {
    clearPlanNodeSelection();
    changed = true;
  }
  return changed;
}

function getPlanMoveStepIn() {
  const v = Number(settingsPlanMoveStep?.value || 0.5);
  return distanceSettingToInches(isFinite(v) && v > 0 ? v : 0.5);
}

function getPlanSnapStepIn() {
  const v = Number(settingsPlanSnapStep?.value || 0);
  return (isFinite(v) && v > 0) ? distanceSettingToInches(v) : 0;
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

function currentPlanFieldBounds() {
  const currentBounds = fieldRenderer.getBounds();
  const boundsAreFinite = currentBounds
    && Number.isFinite(currentBounds.minX)
    && Number.isFinite(currentBounds.maxX)
    && Number.isFinite(currentBounds.minY)
    && Number.isFinite(currentBounds.maxY);
  return boundsAreFinite ? currentBounds : FIELD_BOUNDS_IN;
}

function getPlanSegmentIndexAtDist(d) {
  if (planningMode.waypoints.length < 2) return -1;
  let rem = clamp(d, 0, planTotalLength());
  for (let i = 0; i < planningMode.waypoints.length - 1; i += 1) {
    const a = planningMode.waypoints[i];
    const b = planningMode.waypoints[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg <= 0.0001) continue;
    if (rem <= seg) return i;
    rem -= seg;
  }
  return Math.max(0, planningMode.waypoints.length - 2);
}

function getPlanSpeedUnitsPerSecAtDist(d) {
  const segIdx = getPlanSegmentIndexAtDist(d);
  if (segIdx < 0) return Math.abs(readPlanSpeed(planningMode.waypoints[0]?.speed, 127));
  return Math.abs(readPlanSpeed(planningMode.waypoints[segIdx]?.speed, 127));
}

function clampPlanCoordX(v) {
  const next = applyPlanSnap(v);
  if (!planLimitBoundsEnabled()) return next;
  const bounds = currentPlanFieldBounds();
  return clamp(next, bounds.minX, bounds.maxX);
}

function clampPlanCoordY(v) {
  const next = applyPlanSnap(v);
  if (!planLimitBoundsEnabled()) return next;
  const bounds = currentPlanFieldBounds();
  return clamp(next, bounds.minY, bounds.maxY);
}

function planSetSelection(indices) {
  planningMode.actions.setWaypointSelection(indices);
}

function planRectSelect() {
  if (!planningMode.selectRect) return;
  const x0 = Math.min(planningMode.selectRect.x0, planningMode.selectRect.x1);
  const x1 = Math.max(planningMode.selectRect.x0, planningMode.selectRect.x1);
  const y0 = Math.min(planningMode.selectRect.y0, planningMode.selectRect.y1);
  const y1 = Math.max(planningMode.selectRect.y0, planningMode.selectRect.y1);
  const picked = [];
  for (let i = 0; i < planningMode.waypoints.length; i++) {
    const p = planningMode.waypoints[i];
    const sp = fieldRenderer.worldToScreen(p.x, p.y);
    if (sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1) {
      picked.push(i);
    }
  }
  planSetSelection(picked);
}

function planThetaDegAt(i) {
  if (i < 0 || i >= planningMode.waypoints.length) return 0;
  const cur = planningMode.waypoints[i];
  const theta = (typeof cur.theta === "number") ? cur.theta : 0;
  return normalizeDeg(theta + offsetsIn.theta);
}

function planThetaDisplayToRaw(thetaDisplay) {
  return normalizeDeg(thetaDisplay - offsetsIn.theta);
}

function fieldHeadingToScreenDeg(thetaField) {
  return normalizeDeg(thetaField + fieldRenderer.getFieldRotationDeg());
}

function fieldHeadingToCanvasRotationDeg(thetaField) {
  return normalizeDeg(fieldHeadingToScreenDeg(thetaField) - 90);
}

function planTotalLength() {
  let total = 0;
  for (let i = 0; i < planningMode.waypoints.length - 1; i++) {
    const a = planningMode.waypoints[i], b = planningMode.waypoints[i + 1];
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
  if (planningMode.waypoints.length === 0) return null;
  if (planningMode.waypoints.length === 1) {
    const p = planningMode.waypoints[0];
    const thetaPlan = planThetaDegAt(0);
    return { x: p.x, y: p.y, theta: thetaPlan };
  }
  let rem = d;
  for (let i = 0; i < planningMode.waypoints.length - 1; i++) {
    const a = planningMode.waypoints[i], b = planningMode.waypoints[i + 1];
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
  const last = planningMode.waypoints[planningMode.waypoints.length - 1];
  const thetaPlan = planThetaDegAt(planningMode.waypoints.length - 1);
  return { x: last.x, y: last.y, theta: thetaPlan };
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
    codeValue: planningMode.state.getExportTemplate(),
    showName: false,
    confirmLabel: "Confirm",
    onConfirm: ({ codeValue }) => {
      const previousTemplate = planningMode.state.getExportTemplate();
      planningMode.actions.setExportTemplate(codeValue);
      saveSettings();
      void planningTelemetry.templateUpdated(planningMode.telemetry.getTelemetryProperties({
        template_changed: previousTemplate !== planningMode.state.getExportTemplate(),
        template_bytes: getUtf8ByteLength(planningMode.state.getExportTemplate()),
      }));
    },
  });
}

function closePlanTemplateModal() {
  if (!planTemplateModal) return;
  planTemplateModal.setAttribute("hidden", "");
  planTemplateModal.style.display = "none";
  if (planTemplateInput) planTemplateInput.value = planningMode.state.getExportTemplate();
  if (planTemplateNameInput) planTemplateNameInput.value = "";
  if (planTemplateValidationEl) {
    planTemplateValidationEl.hidden = true;
    planTemplateValidationEl.textContent = "";
  }
  planningMode.templateModalState = null;
}

function confirmPlanTemplateModal() {
  if (!planningMode.templateModalState) return;
  const nameValue = String(planTemplateNameInput?.value || "").trim().slice(0, 25);
  const codeValue = String(planTemplateInput?.value || "");
  if (planningMode.templateModalState.showName && !nameValue) {
    if (planTemplateValidationEl) {
      planTemplateValidationEl.textContent = "Enter a name to continue.";
      planTemplateValidationEl.hidden = false;
    }
    planTemplateNameInput?.focus();
    return;
  }
  planningMode.templateModalState.onConfirm?.({ nameValue, codeValue });
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
  planningMode.templateModalState = {
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
  const object = planningMode.objects.find((entry) => entry.id === objectId);
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
      const target = planningMode.objects.find((entry) => entry.id === objectId);
      if (!target) return;
      planningMode.actions.pushUndo();
      target.methods.push({
        id: createPlanMethodId(),
        name: nameValue.slice(0, 25),
        code: codeValue,
      });
      savePlanObjectsUi();
      void planningTelemetry.methodCreated(planningMode.telemetry.getTelemetryProperties({
        method_code_chars: String(codeValue || "").length,
        method_code_bytes: getUtf8ByteLength(codeValue),
      }));
    },
  });
}

function openPlanMethodEditModal(objectId, methodId) {
  const object = planningMode.objects.find((entry) => entry.id === objectId);
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
      const targetObject = planningMode.objects.find((entry) => entry.id === objectId);
      const targetMethod = targetObject?.methods?.find((entry) => entry.id === methodId);
      if (!targetMethod) return;
      const previousName = targetMethod.name || "";
      const previousCode = targetMethod.code || "";
      const nextName = nameValue.slice(0, 25);
      if (previousName === nextName && previousCode === codeValue) return;
      planningMode.actions.pushUndo();
      targetMethod.name = nextName;
      targetMethod.code = codeValue;
      savePlanObjectsUi();
      void planningTelemetry.methodUpdated(planningMode.telemetry.getTelemetryProperties({
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
  const object = node ? getPlanObjectById(planningMode.objects, node.objectId) : null;
  const method = getPlanNodeEffectiveMethod(planningMode.objects, node);
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
      if ((targetNode?.code || "") === String(codeValue || "")) return;
      planningMode.actions.pushUndo();
      if (!setPlanNodeCodeOverride(planningMode.objects, targetNode, codeValue)) return;
      savePlanTimelineUi();
      planningSidebarRenderer.renderPlanObjects();
      fieldRenderer.requestDrawAll();
      const effective = getPlanNodeEffectiveMethod(planningMode.objects, targetNode);
      void planningTelemetry.timelineNodeUpdated(planningMode.telemetry.getTelemetryProperties({
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
  for (let i = 0; i < planningMode.waypoints.length; i += 1) {
    if (i > 0) {
      const prev = planningMode.waypoints[i - 1];
      const cur = planningMode.waypoints[i];
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
  return planningMode.timelineLayout || buildPlanTimelineLayout();
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
  const waypointCount = planningMode.waypoints.length;
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
  const layout = planningMode.timelineLayout || buildPlanTimelineLayout();
  if (!layout || planningMode.waypoints.length < 2) return null;
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
  const bucketIndex = clamp(node.beforeWaypoint, 0, planningMode.waypoints.length);
  if (bucketIndex <= 0) return 0;
  if (bucketIndex >= planningMode.waypoints.length) return planTotalLength();
  const distances = getPlanTimelineWaypointDistances();
  const start = distances[bucketIndex - 1] ?? 0;
  const end = distances[bucketIndex] ?? start;
  const segLen = Math.max(0, end - start);
  const count = Math.max(1, bucketNodes.length);
  return start + segLen * (node.index / count);
}

function getLatestPlanMethodNameForObject(objectId) {
  if (planningMode.waypoints.length < 2) return "\u2014";
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
    if (threshold <= planningMode.playDist + 0.0001) latest = node;
  }
  if (!latest) return "\u2014";
  return getPlanNodeEffectiveMethod(planningMode.objects, latest)?.name || "\u2014";
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
  planningMode.rendering.renderTimelineDom();
  syncPlanObjectLatestValues();
  scheduleSavedPathsSave();
}

function normalizePlanningTimelineHeightForContent() {
  if (planningMode.nodes.length > 0) return;
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
  planningMode.selectedNodeId = nodeId || null;
  planningMode.rendering.renderTimelineDom();
  planningSidebarRenderer.renderPlanObjects();
  syncPlanObjectLatestValues();
  fieldRenderer.requestDrawAll();
  if (scrollSidebar && nodeId) {
    const node = getPlanNodeById(nodeId);
    if (node) scrollPlanMethodIntoView(node.objectId, node.methodId);
  }
}

function buildFieldPlanNodeMarkers() {
  if (planningMode.waypoints.length < 2 || !planningMode.nodes.length) return [];

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
    if (bucketIndex <= 0 || bucketIndex >= planningMode.waypoints.length) continue;

    const start = planningMode.waypoints[bucketIndex - 1];
    const end = planningMode.waypoints[bucketIndex];
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
    const markerLongPx = modeController.getMode() === "planning"
      ? Math.max(8, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_MARKER_LONG, PLAN_FIELD_NODE_MARKER_LONG_MAX_IN))
      : Math.min(
        PLAN_FIELD_NODE_VIEWING_MAX_IN * fieldRenderer.getScale(),
        Math.max(8, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_MARKER_LONG, PLAN_FIELD_NODE_MARKER_LONG_MAX_IN)),
      );
    const waypointRadiusPx = modeController.getMode() === "planning"
      ? Math.min(PLAN_POINT_R, PLAN_MARKER_MAX_IN * fieldRenderer.getScale())
      : Math.min(PLAN_OVERLAY_POINT_R, PLAN_MARKER_MAX_IN_VIEWING * fieldRenderer.getScale());
    const startClearanceDist = Math.min(len, (waypointRadiusPx + markerLongPx * 0.3 + 1.5) / Math.max(fieldRenderer.getScale(), 0.0001));

    for (const node of bucketNodes) {
      const object = getPlanObjectById(planningMode.objects, node.objectId);
      if (!object) continue;
      const method = getPlanNodeEffectiveMethod(planningMode.objects, node);
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
    const sp = fieldRenderer.worldToScreen(marker.x, marker.y);
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
  const object = getPlanObjectById(planningMode.objects, objectId);
  const method = getPlanMethodById(planningMode.objects, objectId, methodId);
  const ghost = document.createElement("div");
  ghost.className = "planMethodCard planMethodDragGhost";
  ghost.innerHTML = `
    <div class="planMethodGrip" aria-hidden="true">⋮⋮</div>
    <div class="planMethodIndex">${escapeHtml(String(getPlanMethodNumber(planningMode.objects, objectId, methodId) || ""))}</div>
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
  planningMode.timelineDropTarget = null;
  planningEventTimelineEl?.classList?.remove("isDropActive");
  if (planningTimelineDropLineEl) planningTimelineDropLineEl.hidden = true;
}

function updatePlanTimelineDropTarget(clientX) {
  const next = getPlanTimelineDropTargetFromClientX(clientX);
  planningMode.timelineDropTarget = next;
  if (planningEventTimelineEl) planningEventTimelineEl.classList.toggle("isDropActive", !!next);
  if (!planningTimelineDropLineEl || !next) {
    if (planningTimelineDropLineEl) planningTimelineDropLineEl.hidden = true;
    return;
  }
  planningTimelineDropLineEl.hidden = false;
  planningTimelineDropLineEl.style.left = `${next.lineX}px`;
}

function clearPlanNodeTooltipTimer() {
  if (planningMode.nodeTooltipTimer) {
    clearTimeout(planningMode.nodeTooltipTimer);
    planningMode.nodeTooltipTimer = null;
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
  planningMode.nodeTooltipPointer = null;
  if (!planNodeTooltipEl) return;
  planningMode.nodeTooltipVisible = false;
  planNodeTooltipEl.classList.remove("isVisible");
  planNodeTooltipEl.classList.remove("hasOverride");
  planNodeTooltipEl.setAttribute("aria-hidden", "true");
  if (immediate) {
    planNodeTooltipEl.hidden = true;
    return;
  }
  window.setTimeout(() => {
    if (!planningMode.nodeTooltipVisible && planNodeTooltipEl) planNodeTooltipEl.hidden = true;
  }, 100);
}

function showPlanNodeTooltip(text, clientX, clientY, edited = false) {
  if (!planNodeTooltipEl || !text) return;
  clearPlanNodeTooltipTimer();
  planningMode.nodeTooltipPointer = { clientX, clientY };
  planningMode.nodeTooltipTimer = window.setTimeout(() => {
    if (!planNodeTooltipEl || !planningMode.nodeTooltipPointer) return;
    planNodeTooltipEl.textContent = text;
    planNodeTooltipEl.classList.toggle("hasOverride", !!edited);
    planNodeTooltipEl.hidden = false;
    positionPlanNodeTooltip(planningMode.nodeTooltipPointer.clientX, planningMode.nodeTooltipPointer.clientY);
    planningMode.nodeTooltipVisible = true;
    planNodeTooltipEl.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      if (planningMode.nodeTooltipVisible) planNodeTooltipEl.classList.add("isVisible");
    });
  }, PLAN_NODE_TOOLTIP_DELAY_MS);
}

function updatePlanNodeTooltip(text, clientX, clientY, edited = false) {
  planningMode.nodeTooltipPointer = { clientX, clientY };
  if (!planningMode.nodeTooltipVisible) {
    showPlanNodeTooltip(text, clientX, clientY, edited);
    return;
  }
  if (!planNodeTooltipEl) return;
  if (planNodeTooltipEl.textContent !== text) planNodeTooltipEl.textContent = text;
  planNodeTooltipEl.classList.toggle("hasOverride", !!edited);
  positionPlanNodeTooltip(clientX, clientY);
}

planningMode.rendering.renderTimelineDom = function renderTimelineDom() {
  if (!planningEventTimelineInnerEl || !planningTimelineWaypointLayerEl || !planningTimelineNodeLayerEl || !planningTimelineContent) return;
  hidePlanNodeTooltip({ immediate: true });
  pruneInvalidPlanNodes();
  planningMode.timelineLayout = buildPlanTimelineLayout();
  const layout = planningMode.timelineLayout;
  if (!layout) return;

  planningTimelineContent.style.width = `${Math.ceil(layout.contentWidth)}px`;
  planningEventTimelineInnerEl.style.width = `${Math.ceil(layout.contentWidth)}px`;

  const canPlace = planningMode.waypoints.length >= 2;
  if (planningEventTimelineHintEl) {
    planningEventTimelineHintEl.hidden = canPlace;
  }

  planningTimelineWaypointLayerEl.innerHTML = "";
  planningTimelineNodeLayerEl.innerHTML = "";
  if (!canPlace) {
    syncPlanningTimelineCanvasSize();
    clearPlanTimelineDropTarget();
    planningMode.rendering.drawTimeline();
    return;
  }

  for (const x of layout.waypointX) {
    const connector = document.createElement("div");
    connector.className = "planningTimelineWaypointConnector";
    connector.style.left = `${x}px`;
    planningTimelineWaypointLayerEl.appendChild(connector);
  }

  for (const node of getSortedPlanNodes()) {
    const object = getPlanObjectById(planningMode.objects, node.objectId);
    const methodNumber = getPlanMethodNumber(planningMode.objects, node.objectId, node.methodId);
    const method = getPlanNodeEffectiveMethod(planningMode.objects, node);
    const bucket = layout.buckets[node.beforeWaypoint];
    if (!object || !methodNumber || !method || !bucket) continue;
    const nodeEl = document.createElement("button");
    nodeEl.type = "button";
    nodeEl.className = "planningTimelineNode";
    if (method.hasOverride) nodeEl.classList.add("hasOverride");
    if (planningMode.selectedNodeId === node.id) nodeEl.classList.add("isSelected");
    nodeEl.draggable = false;
    nodeEl.dataset.nodeId = node.id;
    nodeEl.dataset.objectId = node.objectId;
    nodeEl.dataset.methodId = node.methodId;
    nodeEl.style.left = `${bucket.nodeStart + node.index * PLAN_TIMELINE_NODE_SLOT}px`;
    nodeEl.style.background = object.color || getDefaultPlanObjectColor(planningMode.objects.length);
    nodeEl.style.color = getContrastTextColor(object.color || getDefaultPlanObjectColor(planningMode.objects.length));
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
      updatePlanNodeTooltip(tooltipText, e.clientX, e.clientY, method.hasOverride);
    });
    nodeEl.addEventListener("pointermove", (e) => {
      updatePlanNodeTooltip(tooltipText, e.clientX, e.clientY, method.hasOverride);
    });
    nodeEl.addEventListener("pointerleave", () => {
      hidePlanNodeTooltip();
    });
    nodeEl.addEventListener("focus", () => {
      const rect = nodeEl.getBoundingClientRect();
      updatePlanNodeTooltip(tooltipText, rect.left + rect.width / 2, rect.top + rect.height / 2, method.hasOverride);
    });
    nodeEl.addEventListener("blur", () => {
      hidePlanNodeTooltip({ immediate: true });
    });
    planningTimelineNodeLayerEl.appendChild(nodeEl);
  }

  if (planningMode.timelineDropTarget) {
    updatePlanTimelineDropTarget((planningEventTimelineInnerEl.getBoundingClientRect().left || 0) + planningMode.timelineDropTarget.lineX);
  } else {
    clearPlanTimelineDropTarget();
  }
  syncPlanningTimelineCanvasSize();
  planningMode.rendering.drawTimeline();
};

function startPlanObjectNameEdit(objectId, selectAll = false) {
  const object = planningMode.objects.find((entry) => entry.id === objectId);
  if (!object) return;
  planningMode.editingObjectId = objectId;
  planningMode.editingObjectOriginalName = object.name || "";
  planningMode.objectEditSelectAll = !!selectAll;
  planningSidebarRenderer.renderPlanObjects();
}

function clearPlanObjectEditState() {
  planningMode.editingObjectId = null;
  planningMode.editingObjectOriginalName = "";
  planningMode.objectEditSelectAll = false;
}

function savePlanObjectsUi() {
  planningSidebarRenderer.renderPlanObjects();
  planningMode.rendering.renderTimelineDom();
  syncPlanObjectLatestValues();
  fieldRenderer.requestDrawAll();
  scheduleSavedPathsSave();
}

function cancelPlanObjectNameEdit() {
  clearPlanObjectEditState();
  planningSidebarRenderer.renderPlanObjects();
}

function commitActivePlanObjectEdit() {
  if (!planningMode.editingObjectId) return;
  const activeInput = planObjectListEl?.querySelector?.(".planObjectNameEditor");
  const nextValue = activeInput ? activeInput.value : planningMode.editingObjectOriginalName;
  commitPlanObjectNameEdit(planningMode.editingObjectId, nextValue);
}

function commitPlanObjectNameEdit(objectId, nextNameRaw) {
  const object = planningMode.objects.find((entry) => entry.id === objectId);
  if (!object) {
    cancelPlanObjectNameEdit();
    return;
  }
  const nextName = String(nextNameRaw || "").trim();
  const objectIndex = planningMode.objects.findIndex((entry) => entry.id === objectId);
  const resolvedName = nextName || planningMode.editingObjectOriginalName || getDefaultPlanObjectName(objectIndex);
  if (object.name !== resolvedName) planningMode.actions.pushUndo();
  object.name = resolvedName;
  clearPlanObjectEditState();
  savePlanObjectsUi();
}

function getPlanObjectLatestValue(object) {
  if (!object) return "\u2014";
  return getLatestPlanMethodNameForObject(object.id);
}

function setPlanObjectColor(objectId, color) {
  const object = planningMode.objects.find((entry) => entry.id === objectId);
  if (!object) return;
  const nextColor = String(color || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(nextColor)) return;
  if (object.color === nextColor) return;
  planningMode.actions.pushUndo();
  object.color = nextColor;
  savePlanObjectsUi();
}

function addPlanObject() {
  planningMode.actions.pushUndo();
  const next = {
    id: createPlanObjectId(),
    name: "",
    color: getDefaultPlanObjectColor(planningMode.objects.length),
    latestMethod: "",
    methods: [],
  };
  planningMode.objects.push(next);
  planningMode.editingObjectId = next.id;
  planningMode.editingObjectOriginalName = "";
  planningMode.objectEditSelectAll = false;
  savePlanObjectsUi();
  void planningTelemetry.objectCreated(planningMode.telemetry.getTelemetryProperties({
    object_methods: next.methods.length,
  }));
}

function removePlanObject(objectId) {
  const idx = planningMode.objects.findIndex((entry) => entry.id === objectId);
  if (idx < 0) return;
  planningMode.actions.pushUndo();
  const removedObject = planningMode.objects[idx];
  const removedMethodIds = new Set((removedObject.methods || []).map((method) => method.id));
  const removedNodeCount = planningMode.nodes.filter((entry) => entry.objectId === objectId || removedMethodIds.has(entry.methodId)).length;
  planningMode.objects.splice(idx, 1);
  planningMode.nodes = planningMode.nodes.filter((entry) => entry.objectId !== objectId);
  if (planningMode.selectedNodeId && !getPlanNodeById(planningMode.selectedNodeId)) clearPlanNodeSelection();
  if (planningMode.editingObjectId === objectId) clearPlanObjectEditState();
  savePlanObjectsUi();
  void planningTelemetry.objectRemoved(planningMode.telemetry.getTelemetryProperties({
    removed_methods: removedMethodIds.size,
    removed_nodes: removedNodeCount,
  }));
}

function hasAnyPlanningData() {
  return planningMode.state.hasData();
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
  planningMode.pendingObjectRemovalId = null;
  planningMode.pendingObjectDeleteAction = typeof onConfirm === "function" ? onConfirm : null;
  planningMode.pendingObjectDeleteCancelAction = typeof onCancel === "function" ? onCancel : null;
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
  const object = planningMode.objects.find((entry) => entry.id === objectId);
  if (!object) return;
  cancelPlanObjectNameEdit();
  if (!object.methods.length) {
    removePlanObject(objectId);
    return;
  }
  planningMode.pendingObjectRemovalId = objectId;
  openPlanDangerConfirmModal(`Are you sure you want to remove Object ${object.name}?`, () => removePlanObject(objectId));
}

function closePlanObjectDeleteModal() {
  planningMode.pendingObjectRemovalId = null;
  planningMode.pendingObjectDeleteAction = null;
  planningMode.pendingObjectDeleteCancelAction = null;
  if (!planObjectDeleteModal) return;
  planObjectDeleteModal.setAttribute("hidden", "");
  planObjectDeleteModal.style.display = "none";
}

function cancelPlanObjectDeleteModal() {
  const cancelAction = planningMode.pendingObjectDeleteCancelAction;
  closePlanObjectDeleteModal();
  if (cancelAction) cancelAction();
}

function confirmPlanObjectRemoval() {
  if (planningMode.pendingObjectDeleteAction) planningMode.pendingObjectDeleteAction();
  else if (planningMode.pendingObjectRemovalId) removePlanObject(planningMode.pendingObjectRemovalId);
  closePlanObjectDeleteModal();
}

function hasImportedPlanningWaypoints(obj) {
  return Array.isArray(obj?.["planned-path"]) && obj["planned-path"].length > 0;
}

function hasImportedViewingData(obj) {
  return normalizePoseArray(obj?.poses || obj?.["robot-path"] || []).length > 0
    || normalizeWatches(obj?.watches || obj?.watch || [], toNumMaybe).length > 0
    || normalizeLogs(obj?.logs || obj?.log || [], toNumMaybe, normalizeLogLevel).length > 0
    || normalizeWaypoints(obj?.waypoints || []).length > 0;
}

function applyImportedViewingData(obj) {
  viewingMode.actions.loadViewingData(obj);
    setImportedRouteMeta(viewingMode.getExportData().meta);
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
  const object = planningMode.objects.find((entry) => entry.id === objectId);
  if (!object) return;
  const idx = object.methods.findIndex((entry) => entry.id === methodId);
  if (idx < 0) return;
  planningMode.actions.pushUndo();
  const removedNodeCount = planningMode.nodes.filter((entry) => entry.objectId === objectId && entry.methodId === methodId).length;
  object.methods.splice(idx, 1);
  planningMode.nodes = planningMode.nodes.filter((entry) => !(entry.objectId === objectId && entry.methodId === methodId));
  if (planningMode.selectedNodeId && !getPlanNodeById(planningMode.selectedNodeId)) clearPlanNodeSelection();
  savePlanObjectsUi();
  void planningTelemetry.methodRemoved(planningMode.telemetry.getTelemetryProperties({
    removed_nodes: removedNodeCount,
  }));
}

function insertPlanNode(objectId, methodId, beforeWaypoint, index) {
  const object = getPlanObjectById(planningMode.objects, objectId);
  const method = getPlanMethodById(planningMode.objects, objectId, methodId);
  if (!object || !method || planningMode.waypoints.length < 2) return null;
  const node = {
    id: createPlanNodeId(),
    objectId,
    methodId,
    beforeWaypoint: clamp(Math.round(beforeWaypoint || 0), 0, planningMode.waypoints.length),
    index: Math.max(0, Math.round(index || 0)),
  };
  const bucketNodes = planningMode.nodes
    .filter((entry) => entry.beforeWaypoint === node.beforeWaypoint)
    .sort((a, b) => a.index - b.index);
  for (const entry of bucketNodes) {
    if (entry.index >= node.index) entry.index += 1;
  }
  planningMode.nodes.push(node);
  normalizePlanNodeOrdering();
  return node;
}

function movePlanNode(nodeId, beforeWaypoint, index) {
  const node = getPlanNodeById(nodeId);
  if (!node) return null;
  const originalBucket = node.beforeWaypoint;
  const originalIndex = node.index;
  const targetBucket = clamp(Math.round(beforeWaypoint || 0), 0, planningMode.waypoints.length);
  let targetIndex = Math.max(0, Math.round(index || 0));

  if (originalBucket === targetBucket && targetIndex > originalIndex) targetIndex -= 1;
  planningMode.nodes = planningMode.nodes.filter((entry) => entry.id !== nodeId);
  normalizePlanNodeOrdering();
  node.beforeWaypoint = targetBucket;
  node.index = targetIndex;
  const bucketNodes = planningMode.nodes
    .filter((entry) => entry.beforeWaypoint === targetBucket)
    .sort((a, b) => a.index - b.index);
  for (const entry of bucketNodes) {
    if (entry.index >= targetIndex) entry.index += 1;
  }
  planningMode.nodes.push(node);
  normalizePlanNodeOrdering();
  return node;
}

function removePlanNode(nodeId) {
  const idx = planningMode.nodes.findIndex((entry) => entry.id === nodeId);
  if (idx < 0) return;
  planningMode.actions.pushUndo();
  const removedNode = planningMode.nodes[idx];
  planningMode.nodes.splice(idx, 1);
  normalizePlanNodeOrdering();
  if (planningMode.selectedNodeId === nodeId) clearPlanNodeSelection();
  savePlanTimelineUi();
  normalizePlanningTimelineHeightForContent();
  planningSidebarRenderer.renderPlanObjects();
  void planningTelemetry.timelineNodeRemoved(planningMode.telemetry.getTelemetryProperties({
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

const planningSidebarRenderer = createPlanningSidebarRenderer({
  planListEl,
  planCountEl,
  planObjectListEl,
  planEventsHintEl,
  getPlanWaypoints: () => planningMode.state.getWaypoints(),
  getPlanObjects: () => planningMode.state.getObjects(),
  isPlanWaypointSelected: (index) => planningMode.state.isWaypointSelected(index),
  getSelectedNode: () => getPlanNodeById(planningMode.state.getSelectedNodeId()),
  getEditingObjectId: () => planningMode.state.getEditingObjectId(),
  getPlanOpenColorPickerObjectId: () => planningMode.state.getOpenColorPickerObjectId(),
  getPlanObjectEditSelectAll: () => planningMode.state.shouldSelectAllObjectEdit(),
  planThetaDegAt,
  readPlanSpeed,
  fmtNum,
  formatDistanceFromInches,
  escapeHtml,
  svgIconHref,
  getDefaultPlanObjectName,
  getDefaultPlanObjectColor,
  getPlanObjectLatestValue,
  planToggleSelection: planningMode.actions.toggleWaypointSelection,
  planSelectSingle: planningMode.actions.selectWaypoint,
  requestDrawAll: fieldRenderer.requestDrawAll,
  renderPlanList: () => planningSidebarRenderer.renderPlanList(),
  updatePlanSelectionPanel,
  commitPlanObjectNameEdit,
  cancelPlanObjectNameEdit,
  startPlanObjectNameEdit,
  attachPlanMethodCardDragHandlers,
  openPlanMethodEditModal,
});

const planningTimelineRenderer = createPlanningTimelineRenderer({
  planningTimelineCanvas,
  context: pctx,
  getAppMode: modeController.getMode,
  getCurrentPlanTimelineLayout,
  getPlanTotalLength: planTotalLength,
  getPlanPlayDistance: () => planningMode.playback.getPlaybackDistance(),
  getPlanTimelineXFromDistance,
  timelinePadX: PLAN_TIMELINE_PAD_X,
});

planningMode.rendering.renderSidebar = function renderSidebar() {
  planningSidebarRenderer.renderPlanList();
  planningSidebarRenderer.renderPlanObjects();
};

planningMode.rendering.render = function renderPlanningMode() {
  planningMode.rendering.renderSidebar();
  planningMode.rendering.renderTimelineDom();
};

planningMode.rendering.drawTimeline = function drawTimeline() {
  planningTimelineRenderer.draw();
};

const viewingFieldOverlayRenderer = createViewingFieldOverlayRenderer({
  context: ctx,
  getWatchMarkers: () => watchMarkers,
  getWaypoints: () => waypoints,
  getSelectedWatch: () => viewingSelection.selectedWatch,
  getSelectedWaypointId: () => viewingSelection.selectedWaypointId,
  getHoverWatch: () => viewingFieldInteraction?.getHoverWatch(),
  isWatchMarkerVisible,
  waypointFilterMatches,
  worldToScreen: fieldRenderer.worldToScreen,
  levelFillWithAlpha,
  scaledViewingFieldRadius,
  viewingFieldMarkerStyleScale,
});

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
    }
  }

  if (layoutChanged) {
    syncTimelineBarCollapsedForMode();
    fieldRenderer.updateFieldLayout(true);
    resizeTimeline();
    resizePlanningTimeline();
    layoutTimelineCanvas();
  }
}

function planChanged(opts = {}) {
  pruneInvalidPlanNodes();
  planningSidebarRenderer.renderPlanList();
  planningMode.playback.updateControls();
  planningMode.playback.setDistance(planningMode.playback.getPlaybackDistance());
  planningMode.rendering.renderTimelineDom();
  syncPlanObjectLatestValues();
  if (opts.renderPlanObjects) planningSidebarRenderer.renderPlanObjects();
  updateExportButtonAvailability();
  if (!opts.skipSelectionPanel) updatePlanSelectionPanel();
  scheduleSavedPathsSave();
}

async function loadSavedPaths() {
  try {
    const saved = await invoke("read_saved_paths");
    if (!saved) return;
    const obj = JSON.parse(saved);
    planningMode.loadImportedData(obj);
    viewingMode.actions.loadViewingData(obj);
    if (hasLoadedData()) {
      finalizeLoadedData();
      planningMode.playback.updateControls();
      fieldRenderer.updateFieldLayout(true);
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
  const planningExport = planningMode.getExportData();
  return JSON.stringify({
    "planned-path": planningExport.waypoints.map((p) => ({ x: p.x, y: p.y, theta: p.theta ?? 0, speed: readPlanSpeed(p.speed, 127) })),
    "planned-export-template": planningExport.template,
    "planned-objects": planningExport.objects.map((obj) => ({
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
    "planned-nodes": planningExport.nodes.map(serializePlanNode),
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
  const selectedPlanIndex = planningMode.state.getSelectedWaypointIndex();
  const selectedWaypoint = planningMode.state.getSelectedWaypoint();
  if (!selectedWaypoint) {
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
  const p = selectedWaypoint;
  planSelIndexEl.textContent = `#${selectedPlanIndex + 1}`;
  planSelXEl.disabled = false;
  planSelYEl.disabled = false;
  planSelThetaEl.disabled = false;
  planSelSpeedEl.disabled = false;
  if (active === planSelXEl || active === planSelYEl || active === planSelThetaEl || active === planSelSpeedEl) {
    return;
  }
  const xVal = String(formatDistanceFromInches(p.x, 2));
  const yVal = String(formatDistanceFromInches(p.y, 2));
  const tVal = String(fmtNum(planThetaDegAt(selectedPlanIndex) ?? 0, 1));
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

planningMode.rendering.hitTestField = function hitTestField(mx, my) {
  let best = { idx: -1, dist2: Infinity };
  for (let i = 0; i < planningMode.waypoints.length; i++) {
    const p = planningMode.waypoints[i];
    const sp = fieldRenderer.worldToScreen(p.x, p.y);
    const dx = sp.x - mx;
    const dy = sp.y - my;
    const d2 = dx * dx + dy * dy;
    if (d2 < best.dist2) best = { idx: i, dist2: d2 };
  }
  const HIT_PX = 12;
  return (best.idx >= 0 && best.dist2 <= HIT_PX * HIT_PX) ? best.idx : -1;
}

function planThetaHandlePos(i) {
  const p = planningMode.waypoints[i];
  if (!p) return null;
  const sp = fieldRenderer.worldToScreen(p.x, p.y);
  const theta = fieldHeadingToScreenDeg(planThetaDegAt(i)) * Math.PI / 180;
  const baseR = modeController.getMode() !== "planning" ? PLAN_OVERLAY_POINT_R : PLAN_POINT_R;
  const r = modeController.getMode() === "viewing"
    ? Math.min(baseR, PLAN_MARKER_MAX_IN_VIEWING * fieldRenderer.getScale())
    : Math.min(baseR, PLAN_MARKER_MAX_IN * fieldRenderer.getScale());
  const handleOffset = PLAN_THETA_HANDLE_OFFSET * Math.max(fieldRenderer.getViewZoom(), CANVAS_ZOOM_MIN);
  const dist = r + handleOffset;
  return {
    x: sp.x + Math.sin(theta) * dist,
    y: sp.y - Math.cos(theta) * dist,
  };
}

function planThetaHandleHit(mx, my) {
  for (const i of planningMode.selectedSet) {
    const hp = planThetaHandlePos(i);
    if (!hp) continue;
    const dx = hp.x - mx;
    const dy = hp.y - my;
    if (dx * dx + dy * dy <= PLAN_THETA_HANDLE_R * PLAN_THETA_HANDLE_R) return i;
  }
  return -1;
}

function updatePlanThetaFromPointer(idx, mx, my) {
  const p = planningMode.waypoints[idx];
  if (!p) return;
  const sp = fieldRenderer.worldToScreen(p.x, p.y);
  const dx = mx - sp.x;
  const dy = my - sp.y;
  if (dx === 0 && dy === 0) return;
  const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
  const thetaPlan = normalizeDeg(angle - fieldRenderer.getFieldRotationDeg());
  if (planningMode.thetaDragBase && planningMode.thetaDragBase.length) {
    const delta = normalizeDeg(thetaPlan - planningMode.thetaDragStart);
    for (const entry of planningMode.thetaDragBase) {
      const next = normalizeDeg(entry.theta + delta);
      planningMode.waypoints[entry.i].theta = planThetaDisplayToRaw(applyPlanThetaSnapDeg(next));
    }
  } else {
    p.theta = planThetaDisplayToRaw(applyPlanThetaSnapDeg(thetaPlan));
  }
  planningSidebarRenderer.renderPlanList();
  updatePlanSelectionPanel();
  fieldRenderer.requestDrawAll();
}

function isInField(w) {
  if (!w || typeof w.x !== "number" || typeof w.y !== "number") return false;
  const sp = fieldRenderer.worldToScreen(w.x, w.y);
  if (!Number.isFinite(sp.x) || !Number.isFinite(sp.y)) return false;
  const rect = canvas.getBoundingClientRect();
  return sp.x >= 0 && sp.x <= rect.width && sp.y >= 0 && sp.y <= rect.height;
}

function isPointInFieldBounds(point) {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") return false;
  const bounds = currentPlanFieldBounds();
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

planningMode.rendering.drawFieldOverlay = function drawFieldOverlay(force = false) {
  if (!force && modeController.getMode() !== "planning") return;
  if (modeController.getMode() !== "planning" && !planningMode.overlayVisible) return;
  if (!planningMode.waypoints.length) return;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(120,180,255,0.7)";
  ctx.fillStyle = "rgba(120,180,255,0.9)";

  // lines
  ctx.beginPath();
  for (let i = 0; i < planningMode.waypoints.length; i++) {
    const p = planningMode.waypoints[i];
    const sp = fieldRenderer.worldToScreen(p.x, p.y);
    if (i === 0) ctx.moveTo(sp.x, sp.y);
    else ctx.lineTo(sp.x, sp.y);
  }
  ctx.stroke();

  if (modeController.getMode() === "planning" || (modeController.getMode() !== "planning" && planningMode.overlayVisible)) {
    const markers = buildFieldPlanNodeMarkers();
    for (const marker of markers) {
      const sp = fieldRenderer.worldToScreen(marker.x, marker.y);
      const startScreen = fieldRenderer.worldToScreen(marker.x - marker.tx, marker.y - marker.ty);
      const endScreen = fieldRenderer.worldToScreen(marker.x + marker.tx, marker.y + marker.ty);
      const segAngle = Math.atan2(endScreen.y - startScreen.y, endScreen.x - startScreen.x);
      const normalAngle = segAngle + Math.PI / 2;
      const longLenRaw = Math.max(8, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_MARKER_LONG, PLAN_FIELD_NODE_MARKER_LONG_MAX_IN));
      const thickRaw = Math.max(3, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_MARKER_THICK, PLAN_FIELD_NODE_MARKER_THICK_MAX_IN));
      const tickLenRaw = Math.max(10, scaledPlanFieldNodeSize(PLAN_FIELD_NODE_TICK_LEN, PLAN_FIELD_NODE_TICK_MAX_IN));
      const viewingCapPx = PLAN_FIELD_NODE_VIEWING_MAX_IN * fieldRenderer.getScale();
      const longLen = modeController.getMode() === "planning" ? longLenRaw : Math.min(viewingCapPx, longLenRaw);
      const thick = modeController.getMode() === "planning" ? thickRaw : Math.min(viewingCapPx, thickRaw);
      const tickLen = modeController.getMode() === "planning" ? tickLenRaw : Math.min(viewingCapPx, tickLenRaw);
      const color = marker.object.color || getDefaultPlanObjectColor(planningMode.objects.length);
      const isSelected = planningMode.selectedNodeId === marker.node.id;
      const isHover = planningMode.fieldHoverNodeId === marker.node.id;
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
  for (let i = 0; i < planningMode.waypoints.length; i++) {
    const p = planningMode.waypoints[i];
    const sp = fieldRenderer.worldToScreen(p.x, p.y);
    const isSel = planningMode.selectedSet.has(i);
    const baseR = (modeController.getMode() !== "planning") ? PLAN_OVERLAY_POINT_R : PLAN_POINT_R;
    
    let r = 0;
    if (modeController.getMode() === "viewing") r = Math.min(baseR, PLAN_MARKER_MAX_IN_VIEWING * fieldRenderer.getScale());
    else r = Math.min(baseR, PLAN_MARKER_MAX_IN * fieldRenderer.getScale());

    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.fillStyle = (i === planningMode.selected) ? "rgba(180,220,255,1)" : (isSel ? "rgba(150,200,255,0.95)" : "rgba(120,180,255,0.9)");
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
      if (modeController.getMode() === "viewing") var handleR = Math.min(PLAN_THETA_HANDLE_R, PLAN_MARKER_MAX_IN_VIEWING * fieldRenderer.getScale());
      else var handleR = Math.min(PLAN_THETA_HANDLE_R, PLAN_MARKER_MAX_IN * fieldRenderer.getScale());

      const handleOffset = PLAN_THETA_HANDLE_OFFSET * Math.max(fieldRenderer.getViewZoom(), CANVAS_ZOOM_MIN);
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

  if (planningMode.selecting && planningMode.selectRect) {
    const x0 = Math.min(planningMode.selectRect.x0, planningMode.selectRect.x1);
    const x1 = Math.max(planningMode.selectRect.x0, planningMode.selectRect.x1);
    const y0 = Math.min(planningMode.selectRect.y0, planningMode.selectRect.y1);
    const y1 = Math.max(planningMode.selectRect.y0, planningMode.selectRect.y1);
    ctx.strokeStyle = "rgba(140,200,255,0.8)";
    ctx.fillStyle = "rgba(140,200,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
};

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

function getPinnedWatchReferenceTimeMs() {
  if (viewingPlayback.isPlaying()) return viewingPlayback.getPlayTimeMs() ?? null;
  if (viewingSelection.hoverTimelineTime != null) return viewingSelection.hoverTimelineTime;
  if (!viewingPlayback.isPlaying() && viewingSelection.trackHover?.pose?.t != null) return viewingSelection.trackHover.pose.t;
  if (!viewingPlayback.isPlaying() && viewingSelection.trackLockActive && viewingSelection.trackLockPose?.t != null) return viewingSelection.trackLockPose.t;
  if (!rawPoses.length) return null;
  const idx = clamp(viewingSelection.selectedIndex, 0, Math.max(0, rawPoses.length - 1));
  return rawPoses[idx]?.t ?? null;
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

function inchesToCurrentUnits(inches) {
  const numericValue = Number(inches);
  if (!Number.isFinite(numericValue)) return null;
  return numericValue / (unitsToInFactor || 1);
}

function currentUnitsToInches(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return numericValue * (unitsToInFactor || 1);
}

function distanceSettingToInches(value) {
  return currentUnitsToInches(value);
}

function formatDistanceFromInches(inches, decimals = 2) {
  const converted = inchesToCurrentUnits(inches);
  return converted == null ? "—" : fmtNum(converted, decimals);
}

function refreshUnitSensitiveRendering() {
  planningSidebarRenderer?.renderPlanList?.();
  updatePlanSelectionPanel();
  planningMode?.playback?.setDistance?.(planningMode.playback.getPlaybackDistance());
  updatePoseReadout();
  fieldRenderer?.requestDrawAll?.();
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
  fieldRenderer.draw();
  updatePoseReadout();
  viewingTimeline.draw();
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
  // Display normalized speed on a 0-100 fieldRenderer.getScale() so min/max changes shift the value.
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

// -------- canvas/readout helpers --------
function setFieldRotationDeg(deg) {
  fieldRenderer.setFieldRotationDeg(deg);
  if (settingsFieldRotation) settingsFieldRotation.value = String(fieldRenderer.getFieldRotationDeg());
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
  const w = fieldRenderer.screenToWorld(mx, my);
  setCursorPills(`Cursor: X ${formatDistanceFromInches(w.x, 2)} Y ${formatDistanceFromInches(w.y, 2)}`);
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
  viewingTimeline.draw();
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
  planningMode.rendering.renderTimelineDom();
  syncPlanningTimelineCanvasSize();
  planningMode.rendering.drawTimeline();
}

// -------- field images --------
function loadFieldOptions() {
  const previousValue = topBar.getSelectedField();
  const visibleFields = getVisibleFieldImages();
  topBar.setFieldOptions(visibleFields, getValidFieldKey(previousValue));
}

function drawFirstField() {
  loadFieldOptions();
  const nextField = getValidFieldKey(topBar.getSelectedField() || DEFAULT_FIELD_KEY);
  if (nextField) void fieldRenderer.loadFieldImage(nextField);
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
function fmtSecondsToString(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return null;
  return `${formatNumberString(ms / 1000, 2)}s`;
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
    const target = [`X: ${formatNumberString(params.tarX)}`, `Y: ${formatNumberString(params.tarY)}`];
    if (params.tarT != null) target.push(`θ: ${formatNumberString(params.tarT)}`);

    const lines = [`Target: ${target.join(", ")}`];
    const tolerances = [];
    if (params.linearTol != null) tolerances.push(`Linear: ${formatNumberString(params.linearTol)}`);
    if (params.thetaTol != null) tolerances.push(`Angular: ${formatNumberString(params.thetaTol)}`);
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

function normalizeWaypoints(arr) {
  const normalized = buildWaypointState(arr);
  waypointsById.clear();
  for (const [id, waypoint] of normalized.waypointsById) waypointsById.set(id, waypoint);
  waypoints.length = 0;
  waypoints.push(...normalized.waypoints);
  return waypoints;
}

function waypointFilterValue() {
  return waypointFilter?.value || "all";
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
  watchMarkers.length = 0;
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
  watchMarkersByTime = sortWatchMarkersByTime(watchMarkers);
}

watchGraph = createWatchGraph({
  selection: viewingSelection,
  panel: watchGraphPanel,
  header: watchGraphHeader,
  resizer: watchGraphResizer,
  closeButton: btnCloseWatchGraph,
  subtitle: watchGraphSubtitle,
  title: watchGraphTitle,
  compareSelect: watchGraphCompareSelect,
  latest: watchGraphLatest,
  compareLatest: watchGraphCompareLatest,
  count: watchGraphCount,
  avg: watchGraphAvg,
  min: watchGraphMin,
  max: watchGraphMax,
  compareCount: watchGraphCompareCount,
  compareAvg: watchGraphCompareAvg,
  compareMin: watchGraphCompareMin,
  compareMax: watchGraphCompareMax,
  canvas: watchGraphCanvas,
  empty: watchGraphEmpty,
  getData: () => data,
  getWatches: () => watches,
  getWatchMarkers: () => watchMarkers,
  getWatchMarkersByTime: () => watchMarkersByTime,
  getReferenceTimeMs: () => getPinnedWatchReferenceTimeMs(),
  getCurrentPoseTimeMs: () => currentDisplayPose()?.t ?? null,
  getLatestRobotTimeMs: () => rawPoses[rawPoses.length - 1]?.t ?? null,
  isPlaying: () => viewingPlayback.isPlaying(),
  isLivestreaming: () => !!(window.__live && window.__live.streaming),
  lastWatchAtTime,
  formatNumber: formatNumberString,
  clamp,
  selectWatchMarker,
  updatePoseReadout,
  requestDrawAll: fieldRenderer.requestDrawAll,
});
watchGraph.bindEvents();

const viewingLists = createViewingLists({
  elements: {
    watchList,
    watchFilter,
    watchSort,
    watchCount,
    poseList,
    poseCount,
    waypointList,
    waypointCount,
    waypointFilter,
    logList,
    logCount,
    logSort,
  },
  getWatchMarkers: () => watchMarkers,
  getWatches: () => watches,
  getLogs: () => logs,
  getWaypoints: () => waypoints,
  getVisibleWaypointEvents: waypointVisibleEvents,
  getSelectedWatch: () => viewingSelection.selectedWatch,
  getSelectedPoseIndex: () => viewingSelection.selectedIndex,
  getPoseCount: () => rawPoses.length,
  getPose: (index) => rawPoses[index],
  getSelectedWaypointId: () => viewingSelection.selectedWaypointId,
  getSelectedWaypointEventTime: () => viewingSelection.selectedWaypointEventTime,
  getSelectedLogTime: () => viewingSelection.selectedLogTime,
  setSelectedLogTime: (time) => { viewingSelection.selectedLogTime = time; },
  clearWaypointSelectionState: () => {
    viewingSelection.selectedWaypointId = null;
    viewingSelection.selectedWaypointEventTime = null;
  },
  onPoseSelected: (index) => {
    viewingPlayback.pause();
    viewingSelection.clearTrackHover(true);
    viewingSelection.clearTrackLock();
    viewingSelection.selectedWatch = null;
    viewingSelection.selectedLogTime = null;
    viewingSelection.selectedWaypointId = null;
    viewingSelection.selectedWaypointEventTime = null;
    viewingLists.highlightWaypoint(null, null, false);
    viewingSelection.selectedIndex = index;
    if (leftConnected && leftStreaming) liveAutoFollowHead = false;
    lastPoseIndex = viewingSelection.selectedIndex;
    topBar.setStatus(`Jumped to pose #${index + 1}.`);
    viewingLists.highlightPose();
    updatePoseReadout();
    fieldRenderer.requestDrawAll();
  },
  onWaypointEventSelected: (waypoint, event) => selectWaypointEvent(waypoint, event, true),
  selectWatchMarker,
  toggleFloatingWatch: (watchId) => floatingInfo.toggleWatch(watchId),
  toggleWatchVisibilityForWatch,
  openOrToggleWatchGraphPanel: (marker) => watchGraph.openOrTogglePanel(marker),
  refreshWatchGraphPanelData: () => watchGraph.refreshPanelData(),
  requestDrawAll: fieldRenderer.requestDrawAll,
  jumpToEventTime,
  setStatus: topBar.setStatus,
  getRawPoseTime: (index) => rawPoses[index]?.t,
  poseToInches,
  formatNumberString,
  fmtNum,
  escapeHtml,
  levelStyle,
  levelSortRank,
  watchSortValueKey,
  watchFilterKeyForWatch,
  watchFilterMatches,
  watchFilterLabelForWatch,
  watchVisibilityKeyForWatch,
  watchVisibilityIconId,
  watchVisibilityTitle,
  isGraphableWatchValue: (value) => watchGraph.isGraphableValue(value),
  svgIconHref,
  setSvgUseHref,
  waypointTypeStyle,
  waypointEventLines,
  fmtSecondsToString,
  scrollIntoViewIfNeeded,
  watchToleranceMs: WATCH_TOL_MS,
});
viewingLists.bindEvents();
const {
  watchListRenderer,
  poseListRenderer,
  waypointListRenderer,
  logListRenderer,
} = viewingLists.renderers;

const viewingRendering = createViewingRendering({
  watchListRenderer,
  logListRenderer,
  waypointListRenderer,
  poseListRenderer,
  updatePoseReadout,
});

const viewingPlayback = createViewingPlayback({
  selection: viewingSelection,
  getPoses: () => rawPoses,
  getPlayRate: () => playRate,
  isLivestreaming: () => !!(window.__live && window.__live.streaming),
  setPlayButtonLabel: syncTopBarPlayback,
  setStatus: topBar.setStatus,
  formatTimeSeconds: (ms) => formatNumberString((ms ?? 0) / 1000, 1, "0"),
  interpolatePoseAtTime,
  findFloorIndexByTime,
  lastWatchAtTime: (timeMs) => lastWatchAtTime(watchMarkersByTime, timeMs),
  highlightWatch: (timeMs, doScroll) => watchListRenderer.highlight(timeMs, doScroll),
  updatePoseReadout,
  requestDrawAll: fieldRenderer.requestDrawAll,
});

const viewingInput = createViewingInput({
  hasData: () => !!data,
  isLiveConnected: () => leftConnected,
  getLiveAutoFollowHead: () => liveAutoFollowHead,
  setLiveAutoFollowHead: (enabled) => { liveAutoFollowHead = enabled; },
  getSelectedIndex: () => viewingSelection.selectedIndex,
  getPoseCount: () => rawPoses.length,
  setSelectedIndex: (index) => {
    viewingSelection.selectedIndex = clamp(index, 0, Math.max(0, rawPoses.length - 1));
  },
  setLastPoseIndex: (index) => { lastPoseIndex = index; },
  clearTransientSelection: () => {
    viewingSelection.clearSelectedDetail();
    viewingSelection.clearTimelineHover(false);
    viewingSelection.clearTrackHover(false);
    viewingSelection.clearTrackLock();
    waypointListRenderer.highlight(null, null, false);
  },
  clearTrackHover: () => viewingSelection.clearTrackHover(true),
  clearTrackLock: () => viewingSelection.clearTrackLock(),
  isPlaying: () => viewingPlayback.isPlaying(),
  play: viewingPlayback.play,
  pause: viewingPlayback.pause,
  highlightPoseList: () => poseListRenderer.highlight(),
  updatePoseReadout,
  requestDrawAll: fieldRenderer.requestDrawAll,
  setStatus: topBar.setStatus,
});

const viewingTimeline = createViewingTimeline({
  canvas: timelineCanvas,
  context: tctx,
  timelineBar,
  selection: viewingSelection,
  hasData: () => !!data,
  getPoses: () => rawPoses,
  getWatchMarkers: () => watchMarkers,
  isPlaying: () => viewingPlayback.isPlaying(),
  getPlayTimeMs: () => viewingPlayback.getPlayTimeMs(),
  isLivestreaming: () => !!(window.__live && window.__live.streaming),
  findFloorIndexByTime,
  isWatchMarkerVisible,
  selectWatchMarker,
  clearTrackHover: (restore) => viewingSelection.clearTrackHover(restore),
  clearTrackLock: () => viewingSelection.clearTrackLock(),
  clearWaypointHighlight: () => waypointListRenderer.highlight(null, null, false),
  setLastPoseIndex: (index) => { lastPoseIndex = index; },
  highlightPoseList: () => poseListRenderer.highlight(),
  updatePoseReadout,
  requestDrawAll: fieldRenderer.requestDrawAll,
  clamp,
  heatColorFromNorm,
  levelFillWithAlpha,
});
viewingTimeline.bindEvents();

viewingFieldInteraction = createViewingFieldInteraction({
  canvas,
  selection: viewingSelection,
  getData: () => data,
  isPlaying: () => viewingPlayback.isPlaying(),
  isPanning: () => fieldRenderer.isPanning(),
  isLivestreaming: () => !!(window.__live && window.__live.streaming),
  getPoses: () => rawPoses,
  getWatchMarkers: () => watchMarkers,
  getWaypoints: () => waypoints,
  worldToScreen: fieldRenderer.worldToScreen,
  poseToInches,
  angLerpDeg,
  trackHoverTolerancePx: HOVER_PIXEL_TOL + TRACK_HOVER_PAD_PX,
  scaledViewingFieldRadius,
  isWatchMarkerVisible,
  waypointFilterMatches,
  updateCursorPillsFromClient,
  setCursorPills,
  getAppMode: () => modeController.getMode(),
  handlePlanningMouseMove: (event) => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const waypointHit = planningMode.rendering.hitTestField(mx, my) >= 0;
    const thetaHandleHit = planThetaHandleHit(mx, my) >= 0;
    const nodeHit = (!waypointHit && !thetaHandleHit) ? hitTestPlanFieldNodeAtClient(event.clientX, event.clientY) : null;
    if (nodeHit) {
      if (planningMode.fieldHoverNodeId !== nodeHit.node.id) {
        planningMode.fieldHoverNodeId = nodeHit.node.id;
        fieldRenderer.requestDrawAll();
      }
      canvas.style.cursor = "pointer";
      updatePlanNodeTooltip(nodeHit.tooltipText, event.clientX, event.clientY, !!nodeHit.method?.hasOverride);
    } else {
      const hadHover = planningMode.fieldHoverNodeId != null;
      planningMode.fieldHoverNodeId = null;
      canvas.style.cursor = "";
      hidePlanNodeTooltip();
      if (hadHover) fieldRenderer.requestDrawAll();
    }
  },
  handlePlanningMouseLeave: () => {
    const hadHover = planningMode.fieldHoverNodeId != null;
    planningMode.fieldHoverNodeId = null;
    hidePlanNodeTooltip({ immediate: true });
    canvas.style.cursor = "";
    if (hadHover) fieldRenderer.requestDrawAll();
  },
  selectWatchMarker,
  selectWaypointEvent,
  clearWaypointSelection,
  renderWaypointList: () => viewingRendering.renderWaypointList(),
  clearWaypointHighlight: () => waypointListRenderer.highlight(null, null, false),
  pausePlayback: () => viewingPlayback.pause(),
  setLastPoseIndex: (index) => { lastPoseIndex = index; },
  highlightPoseList: () => poseListRenderer.highlight(),
  updatePoseReadout,
  requestDrawAll: fieldRenderer.requestDrawAll,
  setStatus: topBar.setStatus,
  getSuppressNextClick: () => fieldRenderer.getSuppressNextClick(),
  consumeSuppressNextClick: () => fieldRenderer.consumeSuppressNextClick(),
});
viewingFieldInteraction.bindEvents();

function jumpToEventTime(tMs, {
  exactStatus,
  interpolatedStatus,
  noPoseStatus,
  clearWatchSelection = false,
} = {}) {
  // Clicking an event should override track lock/hover to avoid confusion.
  viewingSelection.clearTrackHover(true);
  viewingSelection.clearTrackLock();

  if (leftConnected && leftStreaming) liveAutoFollowHead = false;

  if (!rawPoses.length) {
    viewingSelection.selectedIndex = 0;
    lastPoseIndex = 0;

    viewingPlayback.pause();
    viewingSelection.hoverTimelineTime = null;
    viewingSelection.timelineHoverSaved = null;

    if (clearWatchSelection) {
      viewingSelection.selectedWatch = null;
      watchListRenderer.highlight(null, false);
      hideWatchPopup();
    }

    if (typeof noPoseStatus === "function") noPoseStatus();

    poseListRenderer.highlight();
    updatePoseReadout();
    fieldRenderer.requestDrawAll();
    return;
  }

  const near = nearestIndexWithinTol(tMs, WATCH_TOL_MS);
  if (near) {
    viewingSelection.selectedIndex = near.idx;
    if (typeof exactStatus === "function") exactStatus(near);
  } else {
    viewingSelection.selectedIndex = findFloorIndexByTime(tMs);
    if (typeof interpolatedStatus === "function") interpolatedStatus();
  }
  lastPoseIndex = viewingSelection.selectedIndex;

  viewingPlayback.pause();
  viewingSelection.hoverTimelineTime = null;
  viewingSelection.timelineHoverSaved = null;

  if (clearWatchSelection) {
    viewingSelection.selectedWatch = null;
    watchListRenderer.highlight(null, false);
    hideWatchPopup();
  }

  poseListRenderer.highlight();
  updatePoseReadout();
  fieldRenderer.requestDrawAll();
}

// --- Watch popup (tiny, click to show, click elsewhere to dismiss) ---
const watchPopup = document.getElementById("watchPopup");
let watchPopupOpen = false;

function hideWatchPopup() {
  if (!watchPopup) return;
  watchPopup.hidden = true;
  watchPopupOpen = false;
}

function watchFilterValue() {
  return watchFilter?.value || "all";
}

function watchVisibilityKeyForWatch(w) {
  return viewingWatchVisibility.keyForWatch(w);
}

function watchFilterKeyForWatch(w) {
  return viewingWatchVisibility.filterKeyForWatch(w);
}

function watchFilterMatches(watch) {
  return viewingWatchVisibility.filterMatches(watch);
}

function watchFilterLabelForWatch(watch) {
  return viewingWatchVisibility.filterLabelForWatch(watch);
}

function isWatchMarkerVisible(marker) {
  return viewingWatchVisibility.isMarkerVisible(marker);
}

function watchVisibilityIconId(w) {
  return viewingWatchVisibility.iconId(w);
}

function watchVisibilityTitle(w) {
  return viewingWatchVisibility.title(w);
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
  fieldRenderer.requestDrawAll();
}

function toggleWatchVisibilityForWatch(watch) {
  viewingWatchVisibility.toggleWatchVisibilityForWatch(watch);
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

function watchSortValueKey(value) {
  if (value == null) return { t: 2, n: 0, s: "" };
  if (typeof value === "boolean") return { t: 0, n: value ? 1 : 0, s: String(value) };
  if (typeof value === "number") return { t: 1, n: value, s: "" };
  return { t: 0, n: 0, s: String(value) };
}

function clearWaypointSelection() {
  viewingSelection.selectedWaypointId = null;
  viewingSelection.selectedWaypointEventTime = null;
  waypointListRenderer.highlight(null, null, false);
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
  viewingSelection.selectedWaypointId = waypoint.id;
  viewingSelection.selectedWaypointEventTime = event?.t ?? waypoint.latestActiveEvent?.t ?? waypoint.createdTime ?? null;
  viewingSelection.selectedWatch = null;
  viewingSelection.selectedLogTime = null;
  watchListRenderer.highlight(null, false);
  logListRenderer.highlight(null, false);
  hideWatchPopup();

  if (leftConnected && leftStreaming) {
    fieldRenderer.requestDrawAll();
    topBar.setStatus(`Waypoint: ${waypoint.name || waypoint.id} selected.`);
    waypointListRenderer.highlight(waypoint.id, viewingSelection.selectedWaypointEventTime, fromUserClick);
    return;
  }

  const poseIdx = waypointPoseIndexForSelection(waypoint, viewingSelection.selectedWaypointEventTime);
  if (poseIdx != null) {
    viewingSelection.clearTrackHover(true);
    viewingSelection.clearTrackLock();
    viewingPlayback.pause();
    viewingSelection.hoverTimelineTime = null;
    viewingSelection.timelineHoverSaved = null;
    viewingSelection.selectedIndex = poseIdx;
    lastPoseIndex = viewingSelection.selectedIndex;
    poseListRenderer.highlight();
    updatePoseReadout();
    fieldRenderer.requestDrawAll();
    topBar.setStatus(`Waypoint: ${waypoint.name || waypoint.id} mapped to pose @${rawPoses[poseIdx].t}ms.`);
  } else {
    topBar.setStatus(`Waypoint: ${waypoint.name || waypoint.id} has no poses while active.`);
    fieldRenderer.requestDrawAll();
  }

  waypointListRenderer.highlight(waypoint.id, viewingSelection.selectedWaypointEventTime, fromUserClick);
}

function selectWatchMarker(marker, fromUserClick = false, clickPos = null) {
  viewingSelection.selectedWatch = { marker };
  viewingSelection.selectedLogTime = null;
  viewingSelection.selectedWaypointId = null;
  viewingSelection.selectedWaypointEventTime = null;

  const timeStr = (marker.t != null) ? `${fmtNum(marker.t / 1000)}s` : "—";;

  jumpToEventTime(marker.t, {
    exactStatus: (near) => topBar.setStatus(`Watch @${timeStr} mapped to pose `
      + `@${((rawPoses[near.idx].t != null) ? `${fmtNum(rawPoses[near.idx].t / 1000)}s` : "—")} (Δ=${fmtNum(near.dt / 1000, 2)}s).`),
    interpolatedStatus: () => topBar.setStatus(`Watch @${timeStr} shown via interpolation (no pose within ±${WATCH_TOL_MS}ms).`),
    noPoseStatus: () => topBar.setStatus(`Watch @${timeStr} selected (no poses loaded).`),
  });

  watchListRenderer.highlight(marker.t, fromUserClick);
  logListRenderer.highlight(null, false);
  waypointListRenderer.highlight(null, null, false);

  if (fromUserClick) showWatchPopup(marker, clickPos);
  else hideWatchPopup();
}

// -------- drawing helpers --------
function normalizeSignedDeg(d) {
  if (typeof d !== "number" || !isFinite(d)) return null;
  return ((d + 180) % 360 + 360) % 360 - 180;
}

function formatUnitsParts(inches, decimals = 1) {
  if (typeof inches !== "number" || !isFinite(inches)) return [{ text: "—", kind: "value" }];
  return [
    { text: formatDistanceFromInches(inches, decimals), kind: "value" },
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
  return clamp(fieldRenderer.getViewZoom(), 0.25, 1);
}

function viewingFieldMarkerScale() {
  return Math.max(fieldRenderer.getViewZoom(), CANVAS_ZOOM_MIN);
}

function viewingFieldMarkerStyleScale() {
  return clamp(fieldRenderer.getViewZoom(), CANVAS_ZOOM_MIN, 1.75);
}

function scaledViewingFieldDiameter(baseDiameterPx, maxDiameterPx = Infinity) {
  return Math.min(baseDiameterPx * viewingFieldMarkerScale(), maxDiameterPx);
}

function scaledViewingFieldRadius(baseDiameterPx, maxDiameterPx = Infinity) {
  return scaledViewingFieldDiameter(baseDiameterPx, maxDiameterPx) / 2;
}

function scaledPlanFieldNodeSize(basePx, maxIn) {
  return Math.min(basePx * Math.max(fieldRenderer.getViewZoom(), CANVAS_ZOOM_MIN), maxIn * fieldRenderer.getScale());
}

function waypointByIdLike(id) {
  if (id == null) return null;
  return waypointsById.get(Number(id))
    || waypoints.find((waypoint) => String(waypoint?.id) === String(id))
    || null;
}

function selectedWaypointForOverlay() {
  if (modeController.getMode() !== "viewing") return null;
  const filter = waypointFilterValue();
  const overlayWaypointId = (filter !== "all" && filter !== "active")
    ? filter
    : viewingSelection.selectedWaypointId;
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
  ctx.fieldRenderer.getScale()(textScaleX, 1);
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

  const waypointScreen = fieldRenderer.worldToScreen(waypoint.target.x, waypoint.target.y);
  const robotScreen = fieldRenderer.worldToScreen(pose.x, pose.y);
  const elbowScreen = fieldRenderer.worldToScreen(pose.x, waypoint.target.y);

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

function currentDisplayPose() {
  // priority:
  // viewingPlayback.isPlaying() > timeline hover > track hover > track lock > viewingSelection.selectedIndex
  if (viewingPlayback.isPlaying()) return viewingPlayback.getPlayPose() || interpolatePoseAtTime(viewingPlayback.getPlayTimeMs());
  if (!viewingPlayback.isPlaying() && viewingSelection.hoverTimelineTime != null) return interpolatePoseAtTime(viewingSelection.hoverTimelineTime);
  if (!viewingPlayback.isPlaying() && viewingSelection.trackHover?.pose) return viewingSelection.trackHover.pose;
  if (!viewingPlayback.isPlaying() && viewingSelection.trackLockActive && viewingSelection.trackLockPose) return viewingSelection.trackLockPose;
  const poses = rawPoses.map(poseToInches);
  return poses[viewingSelection.selectedIndex] || null;
}

// Timeline time readout
function updateDeltaReadout() {
  if (!data || !rawPoses.length) return;
  const lockedTime = rawPoses[viewingSelection.selectedIndex]?.t || 0;

  // viewingSelection.hoverTimelineTime is the time currently under the cursor
  const hoveredTime = viewingSelection.hoverTimelineTime !== null ? viewingSelection.hoverTimelineTime : lockedTime;
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
const floatingInfo = createFloatingInfo({
  floatWindow: floatWin,
  toggleButton: btnToggleFloat,
  closeButton: btnCloseFloat,
  header: floatHeader,
  resizer: floatResizer,
  pinnedHost: pinnedWatchHost,
  pinnedTemplate: pinnedWatchTemplate,
  bounds: floatingWindowBounds,
  getWatches: () => watches,
  getReferenceTimeMs: () => getPinnedWatchReferenceTimeMs(),
  getLockedTimeMs: () => rawPoses[viewingSelection.selectedIndex]?.t ?? null,
  getHoverTimeMs: () => viewingSelection.hoverTimelineTime,
  hasData: () => !!data,
  hasPoses: () => rawPoses.length > 0,
  isWatchMarkerVisibleForClosestWatch: () => true,
  speedFromNorm,
  normFromSpeedRaw,
  formatNumber: formatNumberString,
  setPlayTimeMs: (timeMs) => viewingPlayback.setPlayTimeMs(timeMs),
  pausePlayback: () => viewingPlayback.pause(),
  setSelectedIndex: (index) => { viewingSelection.selectedIndex = index; },
  findFloorIndexByTime,
  updatePoseReadout,
  requestDrawAll: fieldRenderer.requestDrawAll,
  levelStyle,
  normalizeLogLevel,
  onToggle: (enabled) => {
    viewingTelemetry.floatingInfoToggled({ enabled }).catch(err => console.error(err));
  },
});

window.addEventListener("mousemove", (e) => {
  floatingInfo.handleWindowMouseMove(e);
  watchGraph?.handleWindowMouseMove(e);
});

window.addEventListener("mouseup", () => {
  floatingInfo.handleWindowMouseUp();
  watchGraph?.handleWindowMouseUp();
});

// -------- pose readout --------
function updatePoseReadout() {
  if (!data || !rawPoses.length) {
    timePill.textContent = "Time: —";
    pointPill.textContent = "Point: —/—";
    posePill.textContent = "X: —  Y: — θ: —  Speed: —";
    floatingInfo.refreshPinnedPanels();
    return;
  }
  if (viewingSelection.selectedIndex < 0) viewingSelection.selectedIndex = 0;
  if (viewingSelection.selectedIndex >= rawPoses.length) viewingSelection.selectedIndex = Math.max(0, rawPoses.length - 1);
  let idx = viewingSelection.selectedIndex;
  let t = rawPoses[idx]?.t ?? null;
  let p = null;
  if (viewingPlayback.isPlaying()) {
    t = viewingPlayback.getPlayTimeMs();
    idx = findFloorIndexByTime(viewingPlayback.getPlayTimeMs());
    p = interpolatePoseAtTime(viewingPlayback.getPlayTimeMs());

  } else if (viewingSelection.hoverTimelineTime != null) {
    t = viewingSelection.hoverTimelineTime;
    idx = findFloorIndexByTime(viewingSelection.hoverTimelineTime);
    p = interpolatePoseAtTime(viewingSelection.hoverTimelineTime);

  } else if (!viewingPlayback.isPlaying() && viewingSelection.trackHover?.pose) {
    // if hover pose has a time, use interpolation (smooth) instead of the raw cached pose (snappy)
    const ht = viewingSelection.trackHover.pose.t ?? null;

    if (ht != null) {
      t = ht;
      idx = findFloorIndexByTime(ht);
      p = interpolatePoseAtTime(ht);
    } else {
      // fallback to old behavior if hover time isn"t available
      p = viewingSelection.trackHover.pose;
      idx = viewingSelection.trackHover.idxNearest ?? viewingSelection.selectedIndex;
      t = rawPoses[idx]?.t ?? null;
    }

  } else if (!viewingPlayback.isPlaying() && viewingSelection.trackLockActive && viewingSelection.trackLockPose) {
    p = viewingSelection.trackLockPose;
    idx = viewingSelection.trackLockIndex ?? viewingSelection.selectedIndex;
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
    ? `X: ${formatDistanceFromInches(p.x, 1)}  Y: ${formatDistanceFromInches(p.y, 1)}  θ: ${fmtNum(p.theta, 1)}°  Speed: ${spDisp == null ? "—" : fmtNum(spDisp, 2)}`
    : "X: —  Y: —  θ: —  Speed: —";
  updateDeltaReadout();
  floatingInfo.updateInfo(p, idx);
  watchGraph.refreshPanelData();
  floatingInfo.refreshPinnedPanels();
}

// -------- view controls (square maximize + pan/zoom) --------
canvas.addEventListener("wheel", (event) => {
  fieldRenderer.handleWheel(event);
}, { passive: false });

let planningEmptyFieldPress = null;
let planningWaypointDragState = null;

canvas.addEventListener("pointerdown", (e) => {
  if (modeController.getMode() === "planning") {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    planningEmptyFieldPress = null;
    planningWaypointDragState = null;
    if (e.button === 2) {
      // right-drag to select multiple waypoints
      planningMode.selecting = true;
      planningMode.selectRect = { x0: mx, y0: my, x1: mx, y1: my };
      planningMode.pointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      fieldRenderer.requestDrawAll();
      return;
    }
    if (e.button !== 0) return;
    const hit = planningMode.rendering.hitTestField(mx, my);
    const thetaHit = planThetaHandleHit(mx, my);
    const nodeHit = (hit < 0 && thetaHit < 0) ? hitTestPlanFieldNodeAtClient(e.clientX, e.clientY) : null;
    if (nodeHit) {
      hidePlanNodeTooltip({ immediate: true });
      selectPlanNode(nodeHit.node.id, { scrollSidebar: true });
      return;
    }
    if (thetaHit >= 0) {
      planningMode.actions.pushUndo();
      planningMode.thetaDragging = true;
      planningMode.thetaDragIdx = thetaHit;
      planningMode.pointerId = e.pointerId;
      planningMode.thetaDragBase = Array.from(planningMode.selectedSet).map((i) => ({ i, theta: planThetaDegAt(i) }));
      planningMode.thetaDragStart = planThetaDegAt(thetaHit);
      canvas.setPointerCapture(e.pointerId);
      updatePlanThetaFromPointer(thetaHit, mx, my);
      return;
    }
    const w = fieldRenderer.screenToWorld(mx, my);
    if (hit >= 0) {
      if (e.shiftKey) {
        planningMode.actions.toggleWaypointSelection(hit);
        planningSidebarRenderer.renderPlanList();
        updatePlanSelectionPanel();
        fieldRenderer.requestDrawAll();
        return;
      }
      if (!planningMode.selectedSet.has(hit)) {
        planningMode.actions.selectWaypoint(hit);
        planningSidebarRenderer.renderPlanList();
        updatePlanSelectionPanel();
        fieldRenderer.requestDrawAll();
      }
    } else {
      const pending = (isInField(w) && isPointInFieldBounds(w))
        ? {
          pointerId: e.pointerId,
          startX: mx,
          startY: my,
          world: w,
          clearMultiSelection: planningMode.selectedSet.size > 1,
          moved: false,
        }
        : null;
      planningEmptyFieldPress = pending;
      planningMode.pendingCanvasClick = pending
        ? { world: pending.world, clearMultiSelection: pending.clearMultiSelection }
        : null;
      fieldRenderer.beginPan(e.pointerId, mx, my);
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    planningMode.dragging = true;
    planningMode.pointerId = e.pointerId;
    planningMode.dragStart.x = w.x;
    planningMode.dragStart.y = w.y;
    const dragIndices = Array.from(planningMode.selectedSet);
    if (!dragIndices.includes(hit)) dragIndices.push(hit);
    planningMode.dragOrig = dragIndices
      .filter((i) => planningMode.waypoints[i])
      .map((i) => ({ i, x: planningMode.waypoints[i].x, y: planningMode.waypoints[i].y }));
    if (!planningMode.dragOrig.length && planningMode.waypoints[hit]) {
      planningMode.dragOrig = [{ i: hit, x: planningMode.waypoints[hit].x, y: planningMode.waypoints[hit].y }];
    }
    planningWaypointDragState = {
      pointerId: e.pointerId,
      start: { x: w.x, y: w.y },
      originalWaypoints: planningMode.dragOrig.map((point) => ({ ...point })),
    };
    planningMode.dragUndoCaptured = false;
    canvas.setPointerCapture(e.pointerId);
    fieldRenderer.requestDrawAll();
    return;
  }

  if (e.button !== 0) return; // left only

  // Arm panning on any press. If this turns into a drag, we pan the view.
  // If it remains a click (little/no movement), existing click logic selects watches/track points.
  const rect = canvas.getBoundingClientRect();
  fieldRenderer.beginPan(e.pointerId, e.clientX - rect.left, e.clientY - rect.top);

  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (modeController.getMode() === "planning") {
    if (planningMode.thetaDragging && planningMode.pointerId === e.pointerId) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      updatePlanThetaFromPointer(planningMode.thetaDragIdx, mx, my);
      return;
    }
    if (planningMode.selecting && planningMode.pointerId === e.pointerId && planningMode.selectRect) {
      const rect = canvas.getBoundingClientRect();
      planningMode.selectRect.x1 = e.clientX - rect.left;
      planningMode.selectRect.y1 = e.clientY - rect.top;
      planningSidebarRenderer.renderPlanList();
      updatePlanSelectionPanel();
      fieldRenderer.requestDrawAll();
      return;
    }
    if (planningMode.dragging && planningMode.pointerId === e.pointerId) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = fieldRenderer.screenToWorld(mx, my);
      const dragState = planningWaypointDragState?.pointerId === e.pointerId ? planningWaypointDragState : null;
      const dragStart = dragState?.start ?? planningMode.dragStart;
      const dragOrig = dragState?.originalWaypoints ?? planningMode.dragOrig;
      const dx = w.x - dragStart.x;
      const dy = w.y - dragStart.y;
      if (!planningMode.dragUndoCaptured && (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001)) {
        planningMode.actions.pushUndo();
        planningMode.dragUndoCaptured = true;
      }
      for (const p of dragOrig) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        planningMode.waypoints[p.i].x = clampPlanCoordX(nx);
        planningMode.waypoints[p.i].y = clampPlanCoordY(ny);
      }
      planningSidebarRenderer.renderPlanList();
      planningMode.rendering.renderTimelineDom();
      updatePlanSelectionPanel();
      fieldRenderer.requestDrawAll();
      return;
    }
  }
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (modeController.getMode() === "planning" && planningEmptyFieldPress?.pointerId === e.pointerId) {
    const dx = x - planningEmptyFieldPress.startX;
    const dy = y - planningEmptyFieldPress.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) planningEmptyFieldPress.moved = true;
  }
  fieldRenderer.movePan(x, y, {
    onStart: () => {
      // If a hover-preview was active, clear it so the view feels stable while panning.
    if (viewingSelection.trackHover) {
      viewingSelection.clearTrackHover(!viewingSelection.trackLockActive);
      poseListRenderer.highlight();
      updatePoseReadout();
    }
    },
  });
});

function endPan(e) {
  if (modeController.getMode() === "planning") {
    if (planningMode.thetaDragging && (planningMode.pointerId === e.pointerId || planningMode.pointerId == null)) {
      planningMode.thetaDragging = false;
      planningMode.thetaDragIdx = -1;
      planningMode.thetaDragBase = null;
      try { canvas.releasePointerCapture(planningMode.pointerId ?? e.pointerId); } catch { }
      planningMode.pointerId = null;
      planChanged();
      return;
    }
    if (planningMode.selecting && (planningMode.pointerId === e.pointerId || planningMode.pointerId == null)) {
      planningMode.selecting = false;
      planRectSelect();
      planChanged();
      planningMode.selectRect = null;
      try { canvas.releasePointerCapture(planningMode.pointerId ?? e.pointerId); } catch { }
      planningMode.pointerId = null;
      fieldRenderer.requestDrawAll();
      return;
    }
    if (planningMode.dragging && (planningMode.pointerId === e.pointerId || planningMode.pointerId == null)) {
      planningMode.dragging = false;
      planningMode.dragUndoCaptured = false;
      planningWaypointDragState = null;
      try { canvas.releasePointerCapture(planningMode.pointerId ?? e.pointerId); } catch { }
      planningMode.pointerId = null;
      planChanged();
      return;
    }
  }
  if (modeController.getMode() === "planning") {
    const pending = planningEmptyFieldPress?.pointerId === e.pointerId
      ? planningEmptyFieldPress
      : planningMode.pendingCanvasClick;
    planningEmptyFieldPress = null;
    planningMode.pendingCanvasClick = null;
    const wasPanning = fieldRenderer.endPan(e.pointerId);
    if (e.type !== "pointercancel" && !wasPanning && !pending?.moved && pending) {
      if (pending.clearMultiSelection) {
        planningMode.actions.clearSelection();
        planChanged();
        fieldRenderer.requestDrawAll();
        return;
      }
      planningMode.actions.pushUndo();
      const previous = planningMode.waypoints[planningMode.waypoints.length - 1];
      planningMode.waypoints.push({
        x: clampPlanCoordX(pending.world.x),
        y: clampPlanCoordY(pending.world.y),
        theta: 0,
        speed: previous ? readPlanSpeed(previous.speed, 127) : 127,
      });
      planningMode.actions.selectWaypoint(planningMode.waypoints.length - 1);
      planChanged();
      planningMode.dragging = false;
      planningSidebarRenderer.renderPlanList();
      updatePlanSelectionPanel();
      fieldRenderer.requestDrawAll();
    }
    return;
  }

  fieldRenderer.endPan(e.pointerId);
}

canvas.addEventListener("pointerup", endPan);
canvas.addEventListener("pointercancel", endPan);
canvas.addEventListener("contextmenu", (e) => {
  if (modeController.getMode() === "planning") e.preventDefault();
});

// -------- timeline interactions --------
function isInsideTimelineC(cursor) {
  if (!cursor) return false;
  const x = (typeof cursor.clientX === "number") ? cursor.clientX : cursor.x;
  const y = (typeof cursor.clientY === "number") ? cursor.clientY : cursor.y;
  if (typeof x !== "number" || typeof y !== "number") return false;

  const isPlanning = modeController.getMode() === "planning";
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

if (planningTimelineCanvas) {
  const onPlanScrub = (e) => {
    const rect = planningTimelineCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    planningMode.playback.setDistance(planDistFromX(x));
  };
  planningTimelineCanvas.addEventListener("pointerdown", (e) => {
    if (modeController.getMode() !== "planning") return;
    planningMode.scrubbing = true;
    planningTimelineCanvas.setPointerCapture(e.pointerId);
    onPlanScrub(e);
  });
  planningTimelineCanvas.addEventListener("pointermove", (e) => {
    if (!planningMode.scrubbing) return;
    onPlanScrub(e);
  });
  planningTimelineCanvas.addEventListener("pointerup", (e) => {
    if (!planningMode.scrubbing) return;
    planningMode.scrubbing = false;
    try { planningTimelineCanvas.releasePointerCapture(e.pointerId); } catch { }
  });
  planningTimelineCanvas.addEventListener("pointercancel", () => {
    planningMode.scrubbing = false;
  });
}

canvas.addEventListener("dblclick", (e) => {
  if (modeController.getMode() !== "planning") return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (planningMode.rendering.hitTestField(mx, my) >= 0 || planThetaHandleHit(mx, my) >= 0) return;
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
document.addEventListener("keydown", handleGlobalKeydown);

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

function createParsedLiveViewingBatch() {
  return { poses: [], watches: [], logs: [], waypointEvents: [] };
}

function appendParsedLiveRecords(batch, targetBatch = null) {
  if (targetBatch) {
    if (batch.poses?.length) targetBatch.poses.push(...batch.poses);
    if (batch.watches?.length) targetBatch.watches.push(...batch.watches);
    if (batch.logs?.length) targetBatch.logs.push(...batch.logs);
    if (batch.waypointEvents?.length) targetBatch.waypointEvents.push(...batch.waypointEvents);
    return {
      posesAdded: batch.poses?.length || 0,
      watchesAdded: batch.watches?.length || 0,
      logsAdded: batch.logs?.length || 0,
      waypointsAdded: batch.waypointEvents?.length || 0,
      hasNewData: !!(batch.poses?.length || batch.watches?.length || batch.logs?.length || batch.waypointEvents?.length),
    };
  }

  const result = viewingMode.actions.appendLiveBatch(batch);
    return result;
}

function viewingWillAcceptWaypointEvent(event, targetBatch = null) {
  if (event.type === "CREATED") return true;
  if (waypointsById.has(event.id)) return true;
  return !!targetBatch?.waypointEvents?.some((queuedEvent) => queuedEvent.type === "CREATED" && queuedEvent.id === event.id);
}

function parseLiveLineIntoState(line, targetBatch = null) {
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

    const pose = {
      t, x, y,
      theta: (theta == null) ? 0 : theta,
      l_vel: (l_vel == null) ? null : l_vel,
      r_vel: (r_vel == null) ? null : r_vel,
      speed_raw,
      speed_norm: 0,
    };
    telemetryMetrics.totalPosesReceived += 1;
    liveLastPoseT = t;
    return appendParsedLiveRecords({ poses: [pose] }, targetBatch);
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
    telemetryMetrics.totalWatchesReceived += 1;
    return appendParsedLiveRecords({ watches: [nextWatch] }, targetBatch);
  }

  if (s.startsWith("[LOG],")) {
    const parts = s.split(",");
    if (parts.length < 4) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const t = toNumMaybe(parts[1]);
    if (t == null) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const parsed = normalizeSystemLogMessage(parts.slice(3).join(","));
    if (!parsed.message) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const logEntry = {
      t,
      level: normalizeLogLevel(parts[2]),
      label: "",
      value: parsed.message,
      message: parsed.message,
      isSystem: parsed.isSystem,
    };
    telemetryMetrics.totalLogsReceived += 1;
    return appendParsedLiveRecords({ logs: [logEntry] }, targetBatch);
  }

  if (s.startsWith("[WPOINT],")) {
    const parsed = parseWaypointLine(s);
    if (!parsed.ok) return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    const event = parsed.waypointEvent;
    if (!viewingWillAcceptWaypointEvent(event, targetBatch)) {
      return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
    }
    telemetryMetrics.totalWaypointsReceived += 1;
    return appendParsedLiveRecords({ waypointEvents: [event] }, targetBatch);
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
    playButton: null,
    fileButton: btnFile,
  }, {
    connected: leftConnected,
    streaming: leftStreaming,
    actionInFlight: liveActionGate.active,
  });
  syncTopBarPlayback();
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
    topBar.setStatus("Cannot connect: set a valid PROS directory in Settings first.");
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
  viewingPlayback.pause();
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
    if (liveAutoFollowHead && rawPoses.length && viewingSelection.hoverTimelineTime == null && !viewingPlayback.isPlaying() && !viewingSelection.trackLockActive && !(viewingSelection.trackHover && (viewingSelection.trackHover.pose || viewingSelection.trackHover.t))) {
      viewingSelection.selectedIndex = rawPoses.length - 1;
      lastPoseIndex = viewingSelection.selectedIndex;
      updatePoseReadout();
    } else if (!liveAutoFollowHead && rawPoses.length && viewingSelection.hoverTimelineTime == null && !viewingPlayback.isPlaying() && !viewingSelection.trackLockActive && !(viewingSelection.trackHover && (viewingSelection.trackHover.pose || viewingSelection.trackHover.t))) {
      viewingSelection.selectedIndex = lastPoseIndex;
    }
    return;
  }

  const parsedViewingBatch = createParsedLiveViewingBatch();

  for (let i = batch.startIndex; i < batch.endIndex; i++) {
    parseLiveLineIntoState(batch.lines[i], parsedViewingBatch);
  }
  const { posesAdded, watchesAdded, logsAdded, waypointsAdded } = viewingMode.actions.appendLiveBatch(parsedViewingBatch);
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
    viewingRendering.renderWatchFilter();
    viewingRendering.renderWatchList();
    floatingInfo.refreshPinnedPanels();
  }

  if (logsAdded > 0) {
    viewingRendering.renderLogList();
  }
  if (waypointsAdded > 0) {
    viewingRendering.renderWaypointFilter();
    viewingRendering.renderWaypointList();
  }

  if (posesAdded > 0) {
    viewingRendering.renderPoseList();
    // If not hovering timeline/track, keep the robot on the most recent pose.
    if (liveAutoFollowHead && viewingSelection.hoverTimelineTime == null && !viewingPlayback.isPlaying() && !viewingSelection.trackLockActive && !(viewingSelection.trackHover && (viewingSelection.trackHover.pose || viewingSelection.trackHover.t))) {
      viewingSelection.selectedIndex = rawPoses.length - 1;
    } else if (!liveAutoFollowHead && rawPoses.length && viewingSelection.hoverTimelineTime == null && !viewingPlayback.isPlaying() && !viewingSelection.trackLockActive && !(viewingSelection.trackHover && (viewingSelection.trackHover.pose || viewingSelection.trackHover.t))) {
      viewingSelection.selectedIndex = lastPoseIndex;
    }
    poseListRenderer.highlight();
  }

  updatePoseReadout();
  if (
    rawPoses.length !== liveLastPoseCount
    || watches.length !== liveLastWatchCount
    || livePendingBuffer.consumedIndex !== liveLastRenderAt
  ) {
    fieldRenderer.requestDrawAll();
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

// Initialize UI on load
leftSetUI("");
planningSidebarRenderer.renderPlanObjects();
planningMode.rendering.renderTimelineDom();


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

function syncTimelineBarCollapsedForMode(mode = modeController.getMode()) {
  if (!timelineBar) return;
  const collapsed = mode === "planning"
    ? isPlanningTimelineCollapsed()
    : getTimelineH() <= COLLAPSE_PX_TIMELINE;
  timelineBar.classList.toggle("isCollapsed", collapsed);
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
    startW = (modeController.getMode() === "planning") ? getRightSidebarWPlanning() : getRightSidebarWViewing();
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
      if (modeController.getMode() !== "planning") return;
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
      if (modeController.getMode() !== "planning") return;
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
      fieldRenderer.resizeCanvas();
      resizeTimeline();
    }

    if (draggingV) {
      const dx = e.clientX - startX;
      const w = window.innerWidth;
      let next = clamp(startW - dx, 0, Math.max(0, w - 240));

      if (next <= COLLAPSE_PX_SIDEBAR) {
        next = 0;
        if (modeController.getMode() === "planning") rightPlanningEl?.classList?.add("isCollapsed");
        else rightViewingEl?.classList?.add("isCollapsed");
      } else {
        if (modeController.getMode() === "planning") {
          rightPlanningEl?.classList?.remove("isCollapsed");
          layoutState.lastRightSidebarWPlanning = next;
        } else {
          rightViewingEl?.classList?.remove("isCollapsed");
          layoutState.lastRightSidebarW = next;
        }
      }
      if (modeController.getMode() === "planning") setRightSidebarWPlanning(next);
      else setRightSidebarWViewing(next);
      fieldRenderer.resizeCanvas();
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
      fieldRenderer.resizeCanvas();
    }

    if (draggingPlanningTimeline) {
      const nearBottom = e.clientY >= window.innerHeight - COLLAPSE_PX_PLANNING_TIMELINE;
      const draggedDownPastHeight = e.clientY - startPlanningTimelineY >= Math.max(startPlanningTimelineH, DEFAULT_PLANNING_TIMELINE_H_PX) * 0.5;
      setPlanningTimelineCollapsed(nearBottom || draggedDownPastHeight);
      resizePlanningTimeline();
      fieldRenderer.resizeCanvas();
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
      if (modeController.getMode() === "planning") {
        if (getRightSidebarWPlanning() > COLLAPSE_PX_SIDEBAR) rightPlanningEl?.classList?.remove("isCollapsed");
      } else {
        if (getRightSidebarWViewing() > COLLAPSE_PX_SIDEBAR) rightViewingEl?.classList?.remove("isCollapsed");
      }
      syncTimelineBarCollapsedForMode();
      fieldRenderer.resizeCanvas();
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
    fieldRenderer.resizeCanvas();
    resizeTimeline();
  });

  vSplit.addEventListener("dblclick", () => {
    if (modeController.getMode() === "planning") {
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
    fieldRenderer.resetFieldPosition();
    fieldRenderer.resizeCanvas();
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
    fieldRenderer.resetFieldPosition();
    fieldRenderer.resizeCanvas();
    layoutTimelineCanvas();
  });

  if (planningTimelineSplit) {
    planningTimelineSplit.addEventListener("dblclick", () => {
      setPlanningTimelineCollapsed(!isPlanningTimelineCollapsed());
      resizePlanningTimeline();
      fieldRenderer.resizeCanvas();
      void saveSettings();
    });
  }
})();

// -------- data load --------
function setData(obj, options = {}) {
  const { replacePlanning = true, replaceViewing = true } = options;
  data = obj;
  if (!obj) {
    topBar.setStatus("Invalid JSON: missing data object");
    return;
  }

  if (replacePlanning) {
    planningMode.loadImportedData(obj);
  }

  if (replaceViewing) {
    applyImportedViewingData(obj);
  }

  if (!hasLoadedData()) {
    topBar.setStatus("Invalid JSON: no viewing or planning route data found");
    return;
  }

  finalizeLoadedData();
}

function setDataFromStreamText(text) {
  planningMode.clear();
  viewingMode.actions.clear();
    liveLastPoseT = null;

  const parsedViewingBatch = createParsedLiveViewingBatch();
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    parseLiveLineIntoState(line, parsedViewingBatch);
  }
  viewingMode.actions.appendLiveBatch(parsedViewingBatch);
  
  watches.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  logs.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  waypoints.sort((a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0));
  data = { poses: rawPoses, watches, logs, waypoints, meta: {} };
  setImportedRouteMeta(null);

  if (!hasLoadedData()) {
    topBar.setStatus("No poses, watches, logs, waypoints, or planning data found in file.");
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
  return viewingMode.data.hasData() || planningMode.state.hasData();
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

  viewingSelection.selectedWatch = null;
  watchGraph.hidePanel();
  viewingSelection.selectedLogTime = null;
  viewingSelection.selectedWaypointId = null;
  viewingSelection.selectedWaypointEventTime = null;
  viewingSelection.selectedIndex = 0;
  viewingSelection.hoverTimelineTime = null;
  viewingSelection.timelineHoverSaved = null;
  viewingFieldInteraction?.clearHoverWatch();

  viewingSelection.clearTrackHover(true);
  viewingSelection.clearTrackLock();
  viewingPlayback.pause();

  recomputeWatchMarkers();
  rebuildWatchMarkersByTime();
  viewingRendering.renderWatchFilter();
  viewingRendering.renderWatchList();
  floatingInfo.refreshPinnedPanels();
  viewingRendering.renderLogList();
  viewingRendering.renderWaypointFilter();
  viewingRendering.renderWaypointList();
  viewingRendering.renderPoseList();

  fieldRenderer.setBounds(FIELD_BOUNDS_IN);

  topBar.setStatus(`Loaded ${rawPoses.length} poses, ${watches.length} watches, ${logs.length} logs, ${waypointVisibleEvents().length} waypoints.`);
  syncTopBarPlayback();
  topBar.setFieldEnabled(true);
  updateExportButtonAvailability();

  updatePoseReadout();
  fieldRenderer.requestDrawAll();
}

async function handleFile(file) {
  try {
    const fileName = file?.name?.toLowerCase?.() ?? "";
    const text = await file.text();
    topBar.setStatus(`Loaded ${file.name}`);
    if (fileName.endsWith(".json")) {
      const obj = JSON.parse(text);
      const incomingHasPlanning = hasImportedPlanningWaypoints(obj);
      const incomingHasViewing = hasImportedViewingData(obj);
      const currentHasPlanning = hasPlanningExportData();
      if (incomingHasPlanning && currentHasPlanning) {
        const confirmed = await confirmPlanningImportOverride();
        if (!confirmed) {
          topBar.setStatus("Import cancelled.");
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
    topBar.setStatus("Unsupported file type");
  } catch (e) {
    console.error(e);
    topBar.setStatus(`Failed to load: ${e?.message || e}`);
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
    topBar.setStatus("Invalid file type.");
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
btnFile.addEventListener("click", () => topBar.openFilePicker());


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
        planningMode.actions.setExportTemplate(settings.planExportTemplate);
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
      if (settings.robotImageEnabled !== undefined) {
        fieldRenderer.setRobotImageEnabled(!!settings.robotImageEnabled);
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
      if (settings.playbackSpeed !== undefined) {
        topBar.setPlaybackSpeed(Number(settings.playbackSpeed) || 1);
        playRate = topBar.getPlaybackSpeed();
        viewingPlayback.setPlayRate(playRate);
      }
      if (settings.selectedField !== undefined) {
        const nextField = getValidFieldKey(settings.selectedField);
        topBar.setFieldOptions(getVisibleFieldImages(), nextField);
        void fieldRenderer.loadFieldImage(nextField);
      }
      if (settings.robotImgScale !== undefined) {
        fieldRenderer.setRobotImageTransform({ scale: Number(settings.robotImgScale) || 1 });
        if (robotImgScaleEl) robotImgScaleEl.value = settings.robotImgScale;
        if (settingsRobotImgScale) settingsRobotImgScale.value = settings.robotImgScale;
      }
      if (settings.robotImgOffX !== undefined) {
        fieldRenderer.setRobotImageTransform({ offXIn: Number(settings.robotImgOffX) || 0 });
        if (robotImgOffXEl) robotImgOffXEl.value = settings.robotImgOffX;
        if (settingsRobotImgOffX) settingsRobotImgOffX.value = settings.robotImgOffX;
      }
      if (settings.robotImgOffY !== undefined) {
        fieldRenderer.setRobotImageTransform({ offYIn: Number(settings.robotImgOffY) || 0 });
        if (robotImgOffYEl) robotImgOffYEl.value = settings.robotImgOffY;
        if (settingsRobotImgOffY) settingsRobotImgOffY.value = settings.robotImgOffY;
      }
      if (settings.robotImgRot !== undefined) {
        fieldRenderer.setRobotImageTransform({ rotDeg: Number(settings.robotImgRot) || 0 });
        if (robotImgRotEl) robotImgRotEl.value = settings.robotImgRot;
        if (settingsRobotImgRot) settingsRobotImgRot.value = settings.robotImgRot;
      }
      if (settings.robotImgAlpha !== undefined) {
        const alpha = clamp(Number(settings.robotImgAlpha) || 100, 0, 100) / 100;
        fieldRenderer.setRobotImageTransform({ alpha });
        if (robotImgAlphaEl) robotImgAlphaEl.value = String(Math.round(alpha * 100));
        if (settingsRobotImgAlpha) settingsRobotImgAlpha.value = String(Math.round(alpha * 100));
      }
      if (settings.fieldRotation !== undefined) {
        setFieldRotationDeg(Number(settings.fieldRotation) || 0);
      }
      if (settings.robotImage?.path) {
        fieldRenderer.setRobotImagePath(settings.robotImage.path);
      }
      if (settings.robotImage?.dataUrl) {
        fieldRenderer.setRobotImageDataUrl(settings.robotImage.dataUrl);
      }
      if (fieldRenderer.isRobotImageEnabled()) {
        if (fieldRenderer.getRobotImageDataUrl()) fieldRenderer.loadRobotImageFromDataUrl(fieldRenderer.getRobotImageDataUrl());
        else if (fieldRenderer.getRobotImagePath()) await fieldRenderer.loadRobotImageFromPath(fieldRenderer.getRobotImagePath());
      }
      if (fieldRenderer.getRobotImageDataUrl() && invoke && !fieldRenderer.getRobotImagePath()) {
        try {
          const savedPath = await invoke("save_robot_image", { dataUrl: fieldRenderer.getRobotImageDataUrl() });
          if (savedPath) {
            fieldRenderer.setRobotImagePath(savedPath);
            await saveSettings();
          }
        } catch (e) {
          console.warn("Failed to persist robot image to app data:", e);
        }
      }
      applySavedLayout(settings);
      updateOffsetsFromInputs();
      computeSpeedNormRange();
      if (robotImageToggle) robotImageToggle.checked = fieldRenderer.isRobotImageEnabled();
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
    topBar.setStatus("Loaded getting started demo route after app upgrade.");
    return true;
  } catch (e) {
    console.warn("Failed to load upgrade demo route:", e);
    return false;
  }
}

async function saveSettings() {
  try {
    const robotImageTransform = fieldRenderer.getRobotImageTransform();
    const settings = {
      prosDir: prosDirInput ? prosDirInput.value : "",
      robotImageEnabled: fieldRenderer.isRobotImageEnabled(),
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
      planExportTemplate: planningMode.state.getExportTemplate(),
      refreshIntervalMs: leftRefreshIntervalEl ? leftRefreshIntervalEl.value : "0",
      liveDebug: settingsLiveDebug ? settingsLiveDebug.checked : liveDebugEnabled,
      showPreviousYearFields,
      fieldCompetition,
      playbackSpeed: String(topBar.getPlaybackSpeed()),
      selectedField: topBar.getSelectedField() || DEFAULT_FIELD_KEY,
      robotImgScale: robotImageTransform.scale,
      robotImgOffX: robotImageTransform.offXIn,
      robotImgOffY: robotImageTransform.offYIn,
      robotImgRot: robotImageTransform.rotDeg,
      robotImgAlpha: Math.round(clamp(Number(robotImageTransform.alpha) || 1, 0, 1) * 100),
      robotImage: {
        path: fieldRenderer.getRobotImagePath() || null,
        dataUrl: fieldRenderer.getRobotImagePath() ? null : (fieldRenderer.getRobotImageDataUrl() || null),
      },
      fieldRotation: fieldRenderer.getFieldRotationDeg(),
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
    refreshUnitSensitiveRendering();
  }
  if (settingsRobotW && robotWEl && settingsRobotW.value !== robotWEl.value) {
    robotWEl.value = settingsRobotW.value;
    fieldRenderer.requestDrawAll();
  }
  if (settingsRobotH && robotHEl && settingsRobotH.value !== robotHEl.value) {
    robotHEl.value = settingsRobotH.value;
    fieldRenderer.requestDrawAll();
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
    fieldRenderer.requestDrawAll();
    updatePoseReadout();
  }
  if (settingsMaxSpeed && maxSpeedEl && settingsMaxSpeed.value !== maxSpeedEl.value) {
    maxSpeedEl.value = settingsMaxSpeed.value;
    computeSpeedNormRange();
    recomputeWatchMarkers();
    rebuildWatchMarkersByTime();
    fieldRenderer.requestDrawAll();
    updatePoseReadout();
  }
  if (settingsRobotImgScale && robotImgScaleEl && settingsRobotImgScale.value !== robotImgScaleEl.value) {
    robotImgScaleEl.value = settingsRobotImgScale.value;
    syncRobotImgTxFromInputs();
    fieldRenderer.requestDrawAll();
  }
  if (settingsRobotImgOffX && robotImgOffXEl && settingsRobotImgOffX.value !== robotImgOffXEl.value) {
    robotImgOffXEl.value = settingsRobotImgOffX.value;
    syncRobotImgTxFromInputs();
    fieldRenderer.requestDrawAll();
  }
  if (settingsRobotImgOffY && robotImgOffYEl && settingsRobotImgOffY.value !== robotImgOffYEl.value) {
    robotImgOffYEl.value = settingsRobotImgOffY.value;
    syncRobotImgTxFromInputs();
    fieldRenderer.requestDrawAll();
  }
  if (settingsRobotImgRot && robotImgRotEl && settingsRobotImgRot.value !== robotImgRotEl.value) {
    robotImgRotEl.value = settingsRobotImgRot.value;
    syncRobotImgTxFromInputs();
    fieldRenderer.requestDrawAll();
  }
  if (settingsRobotImgAlpha && robotImgAlphaEl && settingsRobotImgAlpha.value !== robotImgAlphaEl.value) {
    robotImgAlphaEl.value = settingsRobotImgAlpha.value;
    syncRobotImgTxFromInputs();
    fieldRenderer.requestDrawAll();
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
    settingsRobotImgControls.hidden = !(fieldRenderer.isRobotImageEnabled() && fieldRenderer.isRobotImageReady());
  }
  if (robotImageToggle) {
    robotImageToggle.checked = fieldRenderer.isRobotImageEnabled();
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
  if (value === "project") return "Project Folder";
  if (value === "custom") return "Custom Folder";
  return "Downloads";
}

function prosProjectExportDir() {
  if (!prosDirValid) return "";
  const rawDir = prosDirInput ? prosDirInput.value.trim() : "";
  if (!rawDir || rawDir === "None") return "";
  const separator = rawDir.includes("\\") && !rawDir.includes("/") ? "\\" : "/";
  return `${rawDir.replace(/[\\/]+$/, "")}${separator}MotionView-Routes`;
}

function syncProjectExportLocationOption() {
  if (!exportLocationSelect) return;
  const existing = exportLocationSelect.querySelector('option[value="project"]');
  const projectDir = prosProjectExportDir();
  if (!projectDir) {
    if (exportLocationSelect.value === "project") exportLocationSelect.value = "downloads";
    existing?.remove();
    return;
  }
  if (existing) return;
  const option = document.createElement("option");
  option.value = "project";
  option.textContent = "Project Folder";
  const customOption = exportLocationSelect.querySelector('option[value="custom"]');
  exportLocationSelect.insertBefore(option, customOption);
}

function getExportLocationPath() {
  syncProjectExportLocationOption();
  const location = exportLocationSelect ? exportLocationSelect.value : "downloads";
  const customPath = exportCustomPathInput ? exportCustomPathInput.value.trim() : "";
  const projectPath = prosProjectExportDir();
  return {
    kind: location,
    label: exportLocationLabel(location),
    customPath: location === "custom" ? customPath : (location === "project" ? projectPath : null),
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
  const SelectedField = topBar.getSelectedField() || DEFAULT_FIELD_KEY;
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
      PlannedWaypointCount: planningMode.state.getWaypointCount(),
      PlannedObjectCount: planningMode.state.getObjectCount(),
      PlannedNodeCount: planningMode.state.getNodeCount(),
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
  return planningMode.state.hasData();
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
  const planningExport = planningMode.getExportData();

  const payload = {
    meta: buildExportMetadata(pathName),
  };

  if (includePlanning) {
    payload["planned-path"] = planningExport.waypoints.map((p) => ({
      x: p.x,
      y: p.y,
      theta: p.theta ?? 0,
      speed: readPlanSpeed(p.speed, 127),
    }));
    payload["planned-export-template"] = planningExport.template;
    payload["planned-objects"] = planningExport.objects.map((obj) => ({
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
    payload["planned-nodes"] = planningExport.nodes.map(serializePlanNode);
  }

  if (includeViewing) {
    const viewingExport = viewingMode.getExportData();
    payload.poses = viewingExport.poses.map(serializeExportPose);
    payload.watches = viewingExport.watches.map(serializeExportWatch);
    payload.logs = viewingExport.logs.map(serializeExportLog);
    payload.waypoints = viewingExport.waypoints.map(serializeExportWaypoint);
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
    topBar.setStatus("No run settings were found in this route metadata.");
    return;
  }

  if (viewing.Units !== undefined) {
    const nextUnits = inferUnitsFromMeta(viewing.Units);
    if (unitsSelect) unitsSelect.value = nextUnits;
    if (settingsUnitsSelect) settingsUnitsSelect.value = nextUnits;
    setUnitsFactorFromSelect(nextUnits);
  }

  if (viewing.SelectedField !== undefined) {
    const nextField = getValidFieldKey(viewing.SelectedField);
    topBar.setFieldOptions(getVisibleFieldImages(), nextField);
    await fieldRenderer.loadFieldImage(nextField);
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
  viewingRendering.renderPoseList();
  viewingRendering.renderWatchFilter();
  viewingRendering.renderWatchList();
  viewingRendering.renderLogList();
  viewingRendering.renderWaypointFilter();
  viewingRendering.renderWaypointList();
  viewingRendering.updatePoseReadout();
  fieldRenderer.requestDrawAll();
  await saveSettings();
  topBar.setStatus("Applied run settings from imported metadata.");
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
  syncProjectExportLocationOption();
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
    exportCustomPathHint.textContent = exportLocation === "project"
      ? `Exports to ${prosProjectExportDir() || "the PROS project MotionView-Routes folder"}.`
      : "Enter a folder path."
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
      topBar.setStatus(`Exported ${pendingExportRequest.filename}.`);
      const includesPlanning = pendingExportRequest.exportType === "planning" || pendingExportRequest.exportType === "both";
      const includesViewing = pendingExportRequest.exportType === "viewing" || pendingExportRequest.exportType === "both";
      void exportTelemetry.motionviewJsonExported(planningMode.telemetry.getTelemetryProperties({
        export_type: pendingExportRequest.exportType,
        includes_planning: includesPlanning,
        includes_viewing: includesViewing,
        export_location: pendingExportRequest.destination.kind,
        exported_chars: pendingExportRequest.json.length,
        exported_bytes: getUtf8ByteLength(pendingExportRequest.json),
        exported_planning_template_bytes: includesPlanning ? getUtf8ByteLength(planningMode.state.getExportTemplate()) : 0,
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
      planningMode.actions.toggleObjectColorPicker(objectId);
      planningSidebarRenderer.renderPlanObjects();
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
    planningMode.actions.openObjectColorPicker(objectId);
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
  return planningMode.state.hasTimelineDropTarget() && modeController.getMode() === "planning" && planningMode.state.getWaypointCount() >= 2;
}

function commitPlanTimelineDragTarget(context, target) {
  if (!context || !target) return null;
  if (context.source === "sidebar") {
    const object = getPlanObjectById(planningMode.objects, context.objectId);
    const method = getPlanMethodById(planningMode.objects, context.objectId, context.methodId);
    if (!object || !method || planningMode.waypoints.length < 2) return null;
  } else if (context.source === "node") {
    if (!getPlanNodeById(context.nodeId)) return null;
  } else {
    return null;
  }
  planningMode.actions.pushUndo();
  let node = null;
  if (context.source === "sidebar") {
    node = insertPlanNode(context.objectId, context.methodId, target.beforeWaypoint, target.index);
  } else if (context.source === "node") {
    node = movePlanNode(context.nodeId, target.beforeWaypoint, target.index);
  }
  if (!node) return null;
  savePlanTimelineUi();
  selectPlanNode(node.id, { scrollSidebar: true });
  void (context.source === "sidebar" ? planningTelemetry.timelineNodeCreated : planningTelemetry.timelineNodeMoved).call(planningTelemetry, planningMode.telemetry.getTelemetryProperties({
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
  planningMode.pointerDragState = {
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
  const state = planningMode.pointerDragState;
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
  const state = planningMode.pointerDragState;
  if (!state) return;
  ensurePlanPointerDragStarted(clientX, clientY);
  if (state.mode !== "dragging") return;
  positionPlanMethodDragGhost(state.ghost, clientX, clientY);
  if (planningMode.state.getWaypointCount() >= 2 && isClientInsidePlanningTimelineViewport(clientX, clientY)) {
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
  const state = planningMode.pointerDragState;
  if (!state) return;
  hidePlanNodeTooltip({ immediate: true });
  if (state.mode === "dragging") {
    if (planningMode.state.getWaypointCount() >= 2 && hasValidPlanTimelineDropTarget()) {
      commitPlanTimelineDragTarget({
        source: state.source,
        objectId: state.objectId,
        methodId: state.methodId,
        nodeId: state.nodeId,
      }, planningMode.state.getTimelineDropTarget());
    } else if (state.source === "node" && isClientInsidePlanningSidebar(clientX, clientY) && state.nodeId) {
      removePlanNode(state.nodeId);
    }
  }
  if (state.ghost) state.ghost.remove();
  state.sourceEl?.classList?.remove("isDragging");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  planningMode.pointerDragState = null;
  clearPlanTimelineDropTarget();
}

if (planningEventTimelineEl) {
  planningEventTimelineEl.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest(".planningTimelineNode")) return;
    clearPlanNodeSelection();
    planningMode.rendering.renderTimelineDom();
    planningSidebarRenderer.renderPlanObjects();
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
  if (!planningMode.state.hasOpenObjectColorPicker()) return;
  if (e.target instanceof Element && e.target.closest(".planObjectColorWrap")) return;
  planningMode.actions.closeObjectColorPicker();
  planningSidebarRenderer.renderPlanObjects();
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
    const planningExport = planningMode.getExportData();
    const code = buildPlanExportCode({
      template: planningExport.template,
      waypoints: planningExport.waypoints,
      nodes: planningExport.nodes,
      objects: planningExport.objects,
      readPlanSpeed,
      formatTemplateNumber,
      planThetaDegAt,
      getSortedPlanNodes,
    });
    if (!code) {
      topBar.setStatus("Add at least one waypoint and a template before copying code.");
      return;
    }
    try {
      await copyTextToClipboard(code);
      const waypointCount = planningMode.state.getWaypointCount();
      topBar.setStatus(`Copied generated code for ${waypointCount} waypoint${waypointCount === 1 ? "" : "s"}.`);
      void planningTelemetry.templateExported(planningMode.telemetry.getTelemetryProperties({
        export_surface: "clipboard",
        exported_chars: code.length,
        exported_bytes: getUtf8ByteLength(code),
      }));
    } catch (err) {
      console.error("Failed to copy planning export code:", err);
      topBar.setStatus(`Failed to copy code: ${err?.message || err}`);
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
  else if (viewingSelection.selectedWaypointId != null) {
    clearWaypointSelection();
    fieldRenderer.requestDrawAll();
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
  const previousField = topBar.getSelectedField() || DEFAULT_FIELD_KEY;
  loadFieldOptions();
  const nextField = getValidFieldKey(previousField);
  topBar.setFieldOptions(getVisibleFieldImages(), nextField);
  await fieldRenderer.loadFieldImage(nextField);
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
    updateExportUiState();
    return;
  }

  if (dir === "None" /*None is default state */) { return; }
  try {
    const origin = refreshBridgeOrigin();
    if (!origin || !(await ensureBackendReady())) {
      prosDirValid = false;
      setProsDirStatus("Bridge not ready yet. Retrying...", "error");
      updateConnectButtonState();
      updateExportUiState();
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
      topBar.setStatus(`PROS directory set to: ${result.dir}`);
      setProsDirStatus(`Using PROS project: ${result.dir}`, "ok");
      saveSettings();
      updateConnectButtonState();
      updateExportUiState();
    } else {
      prosDirValid = false;
      topBar.setStatus(`Failed to set PROS directory: ${result.status}`);
      setProsDirStatus(`Invalid PROS directory: ${result.status}`, "error");
      updateConnectButtonState();
      updateExportUiState();
    }
  } catch (e) {
    prosDirValid = false;
    console.error("Error updating PROS directory:", e);
    topBar.setStatus(`Error updating PROS directory: ${e.message || e}`);
    setProsDirStatus(`Error validating PROS directory: ${e.message || e}`, "error");
    updateConnectButtonState();
    updateExportUiState();
  }
}

if (prosDirInput) {
  let prosDirTimeout = null;
  prosDirInput.addEventListener("input", () => {
    prosDirValid = false;
    updateConnectButtonState();
    updateExportUiState();
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
      updateExportUiState();
    } else {
      prosDirValid = false;
      updateExportUiState();
    }
  } catch (e) {
    prosDirValid = false;
    console.error("Error loading PROS directory from API:", e);
    updateExportUiState();
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
    topBar.openRobotImagePicker();
  });
}

async function handleRobotImageFile(file, inputEl) {
  if (!file) return;
  try {
    await fieldRenderer.loadRobotImageFromFile(file);
    await saveSettings();
  } catch (err) {
    console.error("Error loading robot image:", err);
    topBar.setStatus("Error loading robot image.");
  } finally {
    if (inputEl) inputEl.value = "";
  }
}

// Robot image toggle
if (robotImageToggle) {
  robotImageToggle.addEventListener("change", (e) => {
    fieldRenderer.setRobotImageEnabled(e.target.checked);
    if (settingsRobotImgControls) {
      settingsRobotImgControls.hidden = !(fieldRenderer.isRobotImageEnabled() && fieldRenderer.isRobotImageReady());
    }
    fieldRenderer.requestDrawAll();
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

function togglePlaybackForCurrentMode() {
  if (modeController.getMode() === "planning") {
    if (planningMode.playback.isPlaying()) planningMode.playback.pause();
    else planningMode.playback.play();
    fieldRenderer.requestDrawAll();
    return;
  }
  if (!data) return;
  if (viewingPlayback.isPlaying()) { viewingPlayback.pause(); updatePoseReadout(); fieldRenderer.requestDrawAll(); }
  else viewingPlayback.play();
}

if (btnTogglePlanOverlay) {
  btnTogglePlanOverlay.addEventListener("click", () => {
    const visible = planningMode.actions.toggleOverlay();
    btnTogglePlanOverlay.classList.toggle("isOn", visible);
    topBar.syncPlanOverlay(visible);
    fieldRenderer.requestDrawAll();
    viewingTelemetry.planOverlayToggled({
      enabled: visible,
    }).catch(err => console.error(err));
  });
  btnTogglePlanOverlay.classList.toggle("isOn", planningMode.state.isOverlayVisible());
  topBar.syncPlanOverlay(planningMode.state.isOverlayVisible());
}

if (unitsSelect) {
  unitsSelect.addEventListener("change", (e) => {
    if (e.target.value !== currentUnits) {
      setUnitsFactorFromSelect(e.target.value);
      updateOffsetsFromInputs();
      refreshUnitSensitiveRendering();
    }
    syncMainToSettings();
    saveSettings();
  });
}

robotWEl.addEventListener("input", () => {
  fieldRenderer.requestDrawAll();
  syncMainToSettings();
  saveSettings();
});

robotHEl.addEventListener("input", () => {
  fieldRenderer.requestDrawAll();
  syncMainToSettings();
  saveSettings();
});

function syncRobotImgTxFromInputs() {
  const scaleEl = robotImgScaleEl || settingsRobotImgScale;
  const offXEl = robotImgOffXEl || settingsRobotImgOffX;
  const offYEl = robotImgOffYEl || settingsRobotImgOffY;
  const rotEl = robotImgRotEl || settingsRobotImgRot;
  const alphaEl = robotImgAlphaEl || settingsRobotImgAlpha;

  fieldRenderer.setRobotImageTransform({
    scale: clamp(Number(scaleEl?.value || 1), 0.05, 20),
    offXIn: Number(offXEl?.value || 0),
    offYIn: Number(offYEl?.value || 0),
    rotDeg: Number(rotEl?.value || 0),
    alpha: clamp(Number(alphaEl?.value || 100), 0, 100) / 100,
  });
}

const onRobotImgInput = () => {
  syncRobotImgTxFromInputs();
  fieldRenderer.requestDrawAll();
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
  fieldRenderer.requestDrawAll();
  updatePoseReadout();
  syncMainToSettings();
  saveSettings();
});

settingsMaxSpeed.addEventListener("input", () => {
  computeSpeedNormRange();
  recomputeWatchMarkers();
  rebuildWatchMarkersByTime();
  fieldRenderer.requestDrawAll();
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
    if (modeController.getMode() === "planning" && planningMode.state.getSelectedWaypoint() && !el.dataset.undoSession) {
      planningMode.actions.pushUndo();
      el.dataset.undoSession = "1";
    }
  });
  el.addEventListener("input", () => {
    if (!planningMode.state.getSelectedWaypoint()) return;
    if (el.value.trim() === "") return; // allow clearing while typing
    const v = Number(el.value);
    if (!isFinite(v)) return;
    setter(v);
    planChanged({ skipSelectionPanel: true });
    fieldRenderer.requestDrawAll();
  });
  el.addEventListener("blur", () => {
    if (!planningMode.state.getSelectedWaypoint()) return;
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
  const normalizedInt = intPart.replace(/(?!^)-/g, "");
  const trimmedInt = normalizedInt.slice(0, maxDigits + (normalizedInt.startsWith("-") ? 1 : 0));
  el.value = fracPart.length ? `${trimmedInt}.${fracPart}` : trimmedInt;
}

bindPlanField(
  planSelXEl,
  () => formatDistanceFromInches(planningMode.state.getSelectedWaypoint()?.x ?? 0, 2),
  (v) => { planningMode.actions.updateSelectedWaypointField("x", clampPlanCoordX(currentUnitsToInches(v))); }
);
bindPlanField(
  planSelYEl,
  () => formatDistanceFromInches(planningMode.state.getSelectedWaypoint()?.y ?? 0, 2),
  (v) => { planningMode.actions.updateSelectedWaypointField("y", clampPlanCoordY(currentUnitsToInches(v))); }
);
bindPlanField(
  planSelThetaEl,
  () => fmtNum(planThetaDegAt(planningMode.state.getSelectedWaypointIndex()), 1),
  (v) => { planningMode.actions.updateSelectedWaypointField("theta", planThetaDisplayToRaw(v)); }
);
bindPlanField(
  planSelSpeedEl,
  () => fmtNum(readPlanSpeed(planningMode.state.getSelectedWaypoint()?.speed, 127), 0),
  (v) => { planningMode.actions.updateSelectedWaypointField("speed", clampPlanSpeed(v)); }
);

if (planSelXEl) {
  planSelXEl.addEventListener("input", () => clampDigits(planSelXEl, 4));
}
if (planSelYEl) {
  planSelYEl.addEventListener("input", () => clampDigits(planSelYEl, 4));
}
if (planSelThetaEl) {
  planSelThetaEl.addEventListener("input", () => clampDigits(planSelThetaEl, 3));
  planSelThetaEl.addEventListener("blur", () => {
    if (!planningMode.state.getSelectedWaypoint()) return;
    const v = Number(planSelThetaEl.value);
    if (isFinite(v)) {
      planningMode.actions.updateSelectedWaypointField("theta", planThetaDisplayToRaw(v));
      updatePlanSelectionPanel();
      fieldRenderer.requestDrawAll();
    }
  });
}
if (planSelSpeedEl) {
  planSelSpeedEl.addEventListener("input", () => clampDigits(planSelSpeedEl, 3));
  planSelSpeedEl.addEventListener("blur", () => {
    if (!planningMode.state.getSelectedWaypoint()) return;
    const v = Number(planSelSpeedEl.value);
    if (isFinite(v)) {
      planningMode.actions.updateSelectedWaypointField("speed", clampPlanSpeed(v));
      updatePlanSelectionPanel();
      fieldRenderer.requestDrawAll();
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

if (watchSort) watchSort.addEventListener("change", () => { viewingRendering.renderWatchList(); fieldRenderer.requestDrawAll(); });
if (watchFilter) watchFilter.addEventListener("change", () => {
  viewingRendering.renderWatchList();
  fieldRenderer.requestDrawAll();
});
if (logSort) logSort.addEventListener("change", () => { viewingRendering.renderLogList(); });
if (waypointFilter) waypointFilter.addEventListener("change", () => {
  viewingRendering.renderWaypointList();
  fieldRenderer.requestDrawAll();
});

function clearAllPosesAndWatches() {
  // Stop playback/hover/locks so UI doesn’t reference stale indices
  try { viewingPlayback.pause(); } catch { }
  try { viewingSelection.hoverTimelineTime = null; } catch { }
  try { viewingSelection.trackHover = null; } catch { }
  try { viewingSelection.trackLockActive = false; } catch { }

  // Clear core data
  viewingMode.actions.clear();
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

  try { viewingRendering.renderPoseList(); } catch { }
  try { viewingRendering.renderWatchList(); } catch { }
  try { floatingInfo.refreshPinnedPanels(); } catch { }
  try { viewingRendering.renderLogList(); } catch { }
  try { viewingRendering.renderWaypointFilter(); } catch { }
  try { viewingRendering.renderWaypointList(); } catch { }
  try { viewingRendering.updatePoseReadout(); } catch { }
  try { floatingInfo.updateInfo(null, 0); } catch { }
  try { fieldRenderer.requestDrawAll(); } catch { }
}

function handleClearFieldClick(event) {
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault();
    // Clear everything across modes
    const clearAll = () => {
      clearAllPosesAndWatches();
      resetLiveWin();
      if (modeController.getMode() === "planning") planningMode.actions.pushUndo();
      planningMode.clear();
      fieldRenderer.requestDrawAll();
      topBar.setStatus("Cleared Field and Planned Path");
    };
    if (hasAnyPlanningData()) {
      openPlanDangerConfirmModal("Are you sure you want to clear the field and Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearAll);
      return;
    }
    clearAll();
    return;
  }

  if (modeController.getMode() === "planning") {
    const clearPlanOnly = () => {
      planningMode.actions.pushUndo();
      planningMode.clear();
      fieldRenderer.requestDrawAll();
      topBar.setStatus("Cleared Planned Path");
    };
    if (hasAnyPlanningData()) {
      openPlanDangerConfirmModal("Are you sure you want to clear Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearPlanOnly);
      return;
    }
    clearPlanOnly();
  } else {
    clearAllPosesAndWatches();
    resetLiveWin();
    topBar.setStatus("Cleared Field");
  }
}


function handleGlobalKeydown(e) {
  if (handlePlanningHistoryKeydown(e)) return;

  const mouseTag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  const isTypingTarget = (mouseTag === "input" || mouseTag === "textarea" || (e.target && e.target.isContentEditable));
  if (isTypingTarget && e.target !== liveWinEl) return;

  const selectedPlanNodeId = planningMode.state.getSelectedNodeId();
  if (modeController.getMode() === "planning" && selectedPlanNodeId && (e.key === "Backspace" || e.key === "Delete")) {
    const planTemplateOpen = planTemplateModal && planTemplateModal.style.display !== "none" && !planTemplateModal.hasAttribute("hidden");
    const planObjectDeleteOpen = planObjectDeleteModal && planObjectDeleteModal.style.display !== "none" && !planObjectDeleteModal.hasAttribute("hidden");
    if (!planTemplateOpen && !planObjectDeleteOpen) {
      e.preventDefault();
      removePlanNode(selectedPlanNodeId);
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
    if (e.key === "1") {
      e.preventDefault();
      modeController.setMode("viewing");
      return;
    }

    if (e.key === "2") {
      e.preventDefault();
      modeController.setMode("planning");
      return;
    }

    if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      topBar.openFilePicker();
      return;
    }

    if (e.key === "r" || e.key === "R") {
      if (modeController.getMode() !== "viewing") return;
      e.preventDefault();
      btnLeftRefresh?.click();
      return;
    }

    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      if (modeController.getMode() !== "viewing") return;
      if (leftConnected) void disconnectLeft();
      else void connectLeft();
      return;
    }
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (modeController.getMode() !== "viewing") return;

      if (leftConnected) {
        if (!leftStreaming) void startStreaming();
        else void stopStreaming(false);
      }
      return;
    }

    if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      if (modeController.getMode() === "planning") {
        const clearPlanOnly = () => {
          planningMode.actions.pushUndo();
          planningMode.clear();
          fieldRenderer.requestDrawAll();
          topBar.setStatus("Cleared Planned Path");
        };
        if (hasAnyPlanningData()) {
          openPlanDangerConfirmModal("Are you sure you want to clear Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearPlanOnly);
          return;
        }
        clearPlanOnly();
      } else {
        clearAllPosesAndWatches();
        resetLiveWin();
        topBar.setStatus("Cleared Field");
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
      if (modeController.getMode() === "planning") planningMode.actions.pushUndo();
      planningMode.clear();
      fieldRenderer.requestDrawAll();
      topBar.setStatus("Cleared Field and Planned Path");
    };
    if (hasAnyPlanningData()) {
      openPlanDangerConfirmModal("Are you sure you want to clear the field and Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearAll);
      return;
    }
    clearAll();
    return;
  }

  if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      if (modeController.getMode() === "viewing" && btnTogglePlanOverlay) btnTogglePlanOverlay.click();
      return;
    }

    if (e.key === "t" || e.key === "T") {
      floatingInfo.toggleInfo();
      return;
    }

    if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      if (modeController.getMode() !== "viewing") return;
      watchGraph.toggleCurrentPanel();
      return;
    }
  }

  if (!e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && (e.key === "N" || e.key === "n")) {
    e.preventDefault();
    floatingInfo.openWatch(null);
    return;
  }

  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    fieldRenderer.resetFieldPosition();
    return;
  }

  if (modeController.getMode() === "planning") {
    if (e.code === "Space") {
      e.preventDefault();
      if (planningMode.playback.isPlaying()) planningMode.playback.pause();
      else planningMode.playback.play();
      fieldRenderer.requestDrawAll();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && planningMode.state.getSelectedWaypointCount() > 0) {
      e.preventDefault();
      planningMode.actions.pushUndo();
      planningMode.actions.deleteSelectedWaypoints();
      planChanged();
      fieldRenderer.requestDrawAll();
      return;
    }
    const step = getPlanMoveStepIn();
    if (planningMode.state.getSelectedWaypointCount() > 0) {
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
        planningMode.actions.pushUndo();
        // Adjust movement for field rotation so arrows follow screen directions.
        const fieldRotationRad = fieldRenderer.getFieldRotationDeg() * Math.PI / 180;
        const c = Math.cos(fieldRotationRad);
        const s = Math.sin(fieldRotationRad);
        const rdx = dx * c - dy * s;
        const rdy = dx * s + dy * c;
        planningMode.actions.moveSelectedWaypointsBy(rdx, rdy);
        planChanged();
        fieldRenderer.requestDrawAll();
        sanitizeOffsetInputs();
        return;
      }
    }
  }
  if (viewingInput.handleKeydown(e)) return;
}

function handlePlanningHistoryKeydown(e) {
  if (modeController.getMode() !== "planning" || e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const key = String(e.key || "").toLowerCase();
  const wantsUndo = key === "z" && !e.shiftKey;
  const wantsRedo = (key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey);
  if (wantsUndo || wantsRedo) {
    e.preventDefault();
    e.stopPropagation();
    if (wantsUndo) planningMode.actions.undo();
    else planningMode.actions.redo();
    return true;
  }
  return false;
}

sanitizeExportFilename();
// -------- init --------
loadFieldOptions();
await loadSettings();
await loadSavedPaths();
await loadDemoRouteIfUpgraded();
modeController.setMode("viewing");
void appTelemetry.loaded({
  plan_saved: planningMode.state.getWaypointCount() > 0,
  plan_points: planningMode.state.getWaypointCount(),
}).catch((err) => {
  console.warn("App loaded telemetry failed:", err);
});

async function appExit() {
  try {
    if (fieldRenderer.getRobotImageDataUrl() && invoke && !fieldRenderer.getRobotImagePath()) {
      try {
        const savedPath = await invoke("save_robot_image", { dataUrl: fieldRenderer.getRobotImageDataUrl() });
        if (savedPath) fieldRenderer.setRobotImagePath(savedPath);
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
    topBar.setStatus("App closing");
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
  fieldRenderer.updateFieldLayout(true); // keep bounds, recompute square sizing
  resizeTimeline();
  resizePlanningTimeline();
  watchGraph.resizeChart();
  topBar.scheduleLayout();
});

fieldRenderer.updateFieldLayout(false);
resizeTimeline();
resizePlanningTimeline();
topBar.bindEvents();
topBar.scheduleLayout();
if (robotImgControlsEl) robotImgControlsEl.hidden = true;
if (settingsRobotImgControls) settingsRobotImgControls.hidden = true;
syncRobotImgTxFromInputs();
fieldRenderer.loadRobotImage();
drawFirstField();
planningMode.playback.updateControls();
void setupExitHandler();
