// @ts-nocheck
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import fitIconUrl from "./assets/svg/common/fit.svg?url";
import demoRouteUrl from "./assets/demo/getting-started-route.json?url";
import changeObjectColorIconUrl from "./assets/svg/planning/changeObjectColor.svg?url";
import removePlanningObjectIconUrl from "./assets/svg/planning/removePlanningObject.svg?url";
import { initializeMotionViewApp } from "./app/appRuntime";
import { createTopBar } from "./app/createTopBar";
import { getMode, setMode, subscribeMode } from "./app/modeController";
import { setStatus } from "./app/status";
import { applyLiveButtonState } from "./live/liveDomAdapter";
import { LiveActionGate, LivePendingBuffer, LiveWebSocketClient, stripToTag } from "./live/liveCore";
import { LiveConsoleBuffer } from "./live/liveConsole";
import { createFieldRenderer, FIELD_BOUNDS_IN, CANVAS_ZOOM_MIN } from "./render/createFieldRenderer";
import { configureRenderScheduler, registerPlanningRenderLayer, registerViewingRenderLayer, requestDrawAll } from "./render/renderScheduler";
import {
  currentUnitsToInches,
  formatDistanceFromInches,
  getCurrentUnits,
  getUnitsToInchesFactor,
  inchesToCurrentUnits,
  setCurrentUnits,
  subscribeUnits,
} from "./shared/units";
import {
  DEFAULT_FIELD_KEY,
  getValidFieldKey as getValidFieldKeyForOptions,
  getVisibleFieldImages as getVisibleFieldImagesForOptions,
  normalizeFieldCompetition,
} from "./render/fieldImages";
import {
  getUtf8ByteLength,
  serializePlanNode,
  PlanningDialogs,
  PlanningDom,
  PlanningInput,
  PlanningView,
} from "./planning";
import { appTelemetry, exportTelemetry, liveTelemetry, planningTelemetry, viewingTelemetry } from "./telemetry/createTelemetry";
import {
  buildWaypointState,
  ViewingDom,
  ViewingInput,
  ViewingView,
  normalizeLogs,
  normalizePoses,
  normalizeSystemLogMessage,
  normalizeWatches,
  normalizeWaypointType,
  parseWaypointNumber,
  parseWaypointParams,
  waypointEventCount,
} from "./viewing";

const app = initializeMotionViewApp();
void app.start();

const isWindowsPlatform = typeof navigator === "object" && /Windows/.test(navigator.userAgent);

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
// Live streaming state shared across handlers (avoids TDZ issues)
window.__live = window.__live || { connected: false, streaming: false };

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const timelineCanvas = document.getElementById("timelineCanvas");
const tctx = timelineCanvas.getContext("2d");

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
const vSplit = document.getElementById("vSplit");
const hSplit = document.getElementById("hSplit");
const planningTimelineSplit = document.getElementById("planningTimelineSplit");

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
const btnPlanExport = document.getElementById("btnPlanExport");
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
const versionDisplayEl = document.getElementById("versionDisplay");
if (versionDisplayEl) versionDisplayEl.textContent = app.version;
app.core.events.versionChanged.subscribe(({ version }) => {
  if (versionDisplayEl) versionDisplayEl.textContent = version;
});

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

let showPreviousYearFields = true;
let fieldCompetition = "all";

function readPlanSpeed(value, fallback = 127) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(1, Math.min(127, num)) : fallback;
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
let viewingView;
let viewingInput;

const telemetryMetrics = {
  totalPosesReceived: 0,
  totalLogsReceived: 0,
  totalWatchesReceived: 0,
  totalWaypointsReceived: 0,
};
let pendingExportRequest = null;

let playRate = 1;
let playButtonLabel = "▶";

export const topBar = createTopBar({
  onOpenFile: (file, input) => openFile(file, input),
  onRobotImageSelected: (file, input) => handleRobotImageFile(file, input),
  onFitField: () => fieldRenderer.resetFieldPosition(),
  onClearField: (event) => handleClearFieldClick(event),
  onOpenSettings: () => openSettings(),
  onOpenHelp: () => openHelp(),
  onTogglePlayback: () => togglePlaybackForCurrentMode(),
  onPlaybackSpeedChanged: (speed) => {
    playRate = speed;
    app.viewing.playback.setRate(playRate);
    app.planning.playback.setRate(playRate);
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
  const mode = getMode();
  const planningWaypointCount = app.planning.route.length;
  const enabled = !liveConnected && (mode === "planning" ? planningWaypointCount >= 2 : app.viewing.data.poses.length >= 2);
  const playing = label === "⏸";
  topBar.syncPlayback({ enabled, playing, label });
}

const fieldRenderer = createFieldRenderer({
  canvas,
  ctx,
  getRobotDimensions: () => robotDimsInches(),
  fieldHeadingToCanvasRotationDeg,
  heatColorFromNorm,
  onRobotImageAvailabilityChanged: (available) => {
    if (robotImgControlsEl) robotImgControlsEl.hidden = !available;
    if (settingsRobotImgControls) settingsRobotImgControls.hidden = !(fieldRenderer.isRobotImageEnabled() && available);
  },
  onFieldImageLoaded: (field) => {
    syncPlanningProjectionConfiguration();
    viewingTelemetry.fieldImageLoaded({ field });
  },
});

const planningDom = PlanningDom.from(document);
const planningDialogs = new PlanningDialogs(planningDom);
const planningView = new PlanningView(app.planning, fieldRenderer, planningDom, planningDialogs);
const planningInput = new PlanningInput(app.planning, fieldRenderer, planningDialogs);
planningDialogs.bind();
planningView.bind();
planningInput.bind();
planningView.render();
fieldRenderer.registerPlanningLayer(planningView);
registerPlanningRenderLayer(planningView);

app.planning.playback.setRate(playRate);
app.planning.events.playbackChanged.subscribe((change) => {
  if (change.kind === "started") syncTopBarPlayback("⏸");
  else if (change.kind === "paused") syncTopBarPlayback("▶");
});
app.planning.events.documentChanged.subscribe(() => {
  scheduleSavedPathsSave();
  syncTopBarPlayback();
  updateExportButtonAvailability();
});

subscribeMode((mode) => {
  document.body.classList.toggle("mode-planning", mode === "planning");
  syncTimelineBarCollapsedForMode(mode);
  if (mode === "planning" && app.viewing.playback.isPlaying) app.viewing.playback.pause();
  if (mode === "viewing" && app.planning.playback.isPlaying) app.planning.playback.pause();
  app.planning.selection.clear();
  topBar.syncMode(mode);
  fieldRenderer.updateFieldLayout(true);
  viewingView?.resizeTimeline();
  planningView?.resizeTimeline();
  app.planning.playback.setDistance(app.planning.playback.distance);
  void appTelemetry.modeChanged({
    mode,
  });
});

let savedPathsSaveTimer = null;
const DEFAULT_PLANNING_TIMELINE_H_PX = 144;
const LEGACY_PLANNING_TIMELINE_H_PX = 156;

function currentPlanFieldBounds() {
  const bounds = fieldRenderer.getBounds();
  return bounds && [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)
    ? bounds : FIELD_BOUNDS_IN;
}

function syncPlanningProjectionConfiguration() {
  const positionSnapValue = Number(settingsPlanSnapStep?.value || 0);
  const thetaSnapValue = Number(settingsPlanThetaSnapStep?.value || 0);
  app.planning.projection.configure({
    ...currentPlanFieldBounds(),
    limitBounds: settingsPlanLimitBounds?.checked ?? true,
    positionSnap: positionSnapValue > 0 ? distanceSettingToInches(positionSnapValue) : 0,
    thetaSnap: thetaSnapValue > 0 ? thetaSnapValue : 0,
  });
}

function fieldHeadingToCanvasRotationDeg(thetaField) {
  return normalizeDeg(thetaField + fieldRenderer.getFieldRotationDeg() - 90);
}

function hasImportedPlanningWaypoints(obj) {
  return Array.isArray(obj?.["planned-path"]) && obj["planned-path"].length > 0;
}

function hasImportedViewingData(obj) {
  return normalizePoses(obj?.poses || obj?.["robot-path"] || []).length > 0
    || normalizeWatches(obj?.watches || obj?.watch || [], toNumMaybe).length > 0
    || normalizeLogs(obj?.logs || obj?.log || [], toNumMaybe, normalizeLogLevel).length > 0
    || buildWaypointState(obj?.waypoints || []).waypoints.length > 0;
}

function confirmPlanningImportOverride() {
  return planningDialogs.confirm({
    title: "Replace Planning Route",
    message: "This import contains planning points and will replace the current planning route. Continue?",
    confirmLabel: "Replace",
  });
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
    }
  }

  if (layoutChanged) {
    syncTimelineBarCollapsedForMode();
    fieldRenderer.updateFieldLayout(true);
    viewingView?.resizeTimeline();
    planningView?.resizeTimeline();
  }
}

async function loadSavedPaths() {
  try {
    const saved = await invoke("read_saved_paths");
    if (!saved) return;
    const obj = JSON.parse(saved);
    app.planning.load(obj);
    app.viewing.load(obj);
    if (hasLoadedData()) {
      finalizeLoadedData();
      syncTopBarPlayback();
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
  const planningExport = app.planning.exportData();
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
    "robot-path": app.viewing.data.poses.map((p) => ({
      t: p.t ?? null,
      x: p.x, y: p.y,
      theta: p.theta ?? 0,
      l_vel: p.l_vel ?? null,
      r_vel: p.r_vel ?? null,
      speed_raw: p.speed_raw ?? 0,
    })),
    "watches": app.viewing.data.watches.map((w) => ({
      t: w.t ?? null,
      id: Number.isInteger(w.id) ? w.id : null,
      visible: w.visible !== false,
      level: w.level ?? "INFO",
      label: w.label ?? "",
      value: w.value ?? "",
    })),
    "logs": app.viewing.data.logs.map((entry) => ({
      t: entry.t ?? null,
      level: normalizeLogLevel(entry.level),
      label: entry.label ?? "",
      value: entry.message ?? entry.value ?? "",
      isSystem: entry.isSystem === true,
    })),
    "waypoints": app.viewing.data.waypoints.map((waypoint) => ({
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

// offsets: entered in selected units, stored as inches for rendering
const offsetsIn = { x: 0, y: 0, theta: 0 };

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

function normalizeLogLevel(levelRaw) {
  const L = String(levelRaw || "INFO").trim().toUpperCase();
  if (L === "DEBUG" || L === "INFO" || L === "WARN" || L === "ERROR" || L === "FATAL") return L;
  return "INFO";
}

function robotDimsInches() {
  const wVal = robotWEl ? robotWEl.value : (settingsRobotW ? settingsRobotW.value : 12);
  const hVal = robotHEl ? robotHEl.value : (settingsRobotH ? settingsRobotH.value : 12);
  const w = Number(wVal || 12);
  const h = Number(hVal || 12);
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function distanceSettingToInches(value) {
  return currentUnitsToInches(value);
}

function refreshUnitSensitiveRendering() {
  syncPlanningProjectionConfiguration();
  planningView?.render();
  app.planning.playback.setDistance(app.planning.playback.distance);
  updateOffsetsFromInputs();
  requestDrawAll();
}

subscribeUnits(refreshUnitSensitiveRendering);

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

  offsetsIn.x = ux * getUnitsToInchesFactor();
  offsetsIn.y = uy * getUnitsToInchesFactor();
  offsetsIn.theta = ut;
  app.viewing.projection.setTransform({
    unitsToInches: getUnitsToInchesFactor(),
    offsetXInches: offsetsIn.x,
    offsetYInches: offsetsIn.y,
    offsetThetaDegrees: offsetsIn.theta,
  });
  requestDrawAll();
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

const svgIconUrls = {
  "icon-fit": fitIconUrl,
  "icon-removePlanningObject": removePlanningObjectIconUrl,
  "icon-planningChangeObjectColor": changeObjectColorIconUrl,
};

function svgIconHref(iconId) {
  const iconUrl = svgIconUrls[iconId];
  return iconUrl ? `${iconUrl}#${iconId}` : "";
}

function viewingFieldMarkerStyleScale() {
  return clamp(fieldRenderer.getViewZoom(), CANVAS_ZOOM_MIN, 1.75);
}

function scaledPlanFieldNodeSize(basePx, maxIn) {
  return Math.min(basePx * Math.max(fieldRenderer.getViewZoom(), CANVAS_ZOOM_MIN), maxIn * fieldRenderer.getScale());
}

const viewingDom = ViewingDom.from(document);
viewingView = new ViewingView(app.viewing, fieldRenderer, viewingDom);
viewingInput = new ViewingInput(app.viewing);
viewingView.bind();
viewingView.render();
fieldRenderer.registerViewingLayer(viewingView);
registerViewingRenderLayer(viewingView);
app.viewing.events.playbackChanged.subscribe((change) => {
  if (change.kind === "started") syncTopBarPlayback("⏸");
  else if (change.kind === "paused") syncTopBarPlayback("▶");
});
app.viewing.events.dataChanged.subscribe((change) => {
  if (change.kind === "replaced" || change.kind === "cleared" || (change.kind === "appended" && change.result.metadataChanged)) {
    syncImportedRouteMetaUi();
  }
  scheduleSavedPathsSave();
  updateExportButtonAvailability();
});

configureRenderScheduler({
  drawField: () => fieldRenderer.draw(),
});

// -------- view controls (square maximize + pan/zoom) --------
canvas.addEventListener("wheel", (event) => fieldRenderer.handleWheel(event), { passive: false });
canvas.addEventListener("pointerdown", (event) => {
  if (getMode() !== "viewing" || event.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  fieldRenderer.beginPan(event.pointerId, event.clientX - rect.left, event.clientY - rect.top);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (getMode() !== "viewing") return;
  const rect = canvas.getBoundingClientRect();
  fieldRenderer.movePan(event.clientX - rect.left, event.clientY - rect.top, {
    onStart: () => app.viewing.navigation.setTrackHover(null),
  });
});
const endViewingPan = (event) => {
  if (getMode() === "viewing") fieldRenderer.endPan(event.pointerId);
};
canvas.addEventListener("pointerup", endViewingPan);
canvas.addEventListener("pointercancel", endViewingPan);
canvas.addEventListener("contextmenu", (event) => { if (getMode() === "planning") event.preventDefault(); });

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

let leftRefreshTimer = null;
let leftRefreshMs = parseInt(leftRefreshIntervalEl?.value || "500", 10) || 500;

// --- Live incremental processing ---
// Buffer incoming WS lines until Viewing accepts a parsed batch.
let liveLastPoseT = null; // last pose timestamp integrated
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

  return app.viewing.appendLiveBatch(batch);
}

function viewingWillAcceptWaypointEvent(event, targetBatch = null) {
  if (event.type === "CREATED") return true;
  if (app.viewing.data.waypointById.has(event.id)) return true;
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
  app.viewing.navigation.setLiveState(!!leftConnected, !!leftStreaming);
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
  app.viewing.playback.pause();
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

async function doLeftRefresh() {
  // During live mode, refresh means: integrate any pending WS lines into
  // Parse pending transport lines and transfer ownership to Viewing.
  if (!leftConnected) return;
  if (!leftStreaming) {
    // "Stop" pauses drawing; do not let WS backlog grow unbounded.
    clearLivePending();
    return;
  }

  const t0 = performance.now();

  const batch = livePendingBuffer.batch();
  if (!batch) {
    return;
  }

  const parsedViewingBatch = createParsedLiveViewingBatch();

  for (let i = batch.startIndex; i < batch.endIndex; i++) {
    parseLiveLineIntoState(batch.lines[i], parsedViewingBatch);
  }
  const { posesAdded, watchesAdded, logsAdded, waypointsAdded } = app.viewing.appendLiveBatch(parsedViewingBatch);
  livePendingBuffer.markConsumed(batch.endIndex);

  const hasNewData = posesAdded > 0 || watchesAdded > 0 || logsAdded > 0 || waypointsAdded > 0;
  if (!hasNewData) return;

  const t1 = performance.now();
  const dt = t1 - t0;
  if (dt > 100) {
    dbgLive(`doLeftRefresh: ${formatNumberString(dt, 1, "0")}ms (poses=${app.viewing.data.poses.length}, watches=${app.viewing.data.watches.length}, pending=${livePendingBuffer.pendingCount()})`);
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
planningView.render();


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

function syncTimelineBarCollapsedForMode(mode = getMode()) {
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
    startW = (getMode() === "planning") ? getRightSidebarWPlanning() : getRightSidebarWViewing();
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
      if (getMode() !== "planning") return;
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
      if (getMode() !== "planning") return;
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
      viewingView.resizeTimeline();
    }

    if (draggingV) {
      const dx = e.clientX - startX;
      const w = window.innerWidth;
      let next = clamp(startW - dx, 0, Math.max(0, w - 240));

      if (next <= COLLAPSE_PX_SIDEBAR) {
        next = 0;
        if (getMode() === "planning") rightPlanningEl?.classList?.add("isCollapsed");
        else rightViewingEl?.classList?.add("isCollapsed");
      } else {
        if (getMode() === "planning") {
          rightPlanningEl?.classList?.remove("isCollapsed");
          layoutState.lastRightSidebarWPlanning = next;
        } else {
          rightViewingEl?.classList?.remove("isCollapsed");
          layoutState.lastRightSidebarW = next;
        }
      }
      if (getMode() === "planning") setRightSidebarWPlanning(next);
      else setRightSidebarWViewing(next);
      fieldRenderer.resizeCanvas();
      viewingView.resizeTimeline();
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
      viewingView.resizeTimeline();
      fieldRenderer.resizeCanvas();
    }

    if (draggingPlanningTimeline) {
      const nearBottom = e.clientY >= window.innerHeight - COLLAPSE_PX_PLANNING_TIMELINE;
      const draggedDownPastHeight = e.clientY - startPlanningTimelineY >= Math.max(startPlanningTimelineH, DEFAULT_PLANNING_TIMELINE_H_PX) * 0.5;
      setPlanningTimelineCollapsed(nearBottom || draggedDownPastHeight);
      planningView.resizeTimeline();
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
      if (getMode() === "planning") {
        if (getRightSidebarWPlanning() > COLLAPSE_PX_SIDEBAR) rightPlanningEl?.classList?.remove("isCollapsed");
      } else {
        if (getRightSidebarWViewing() > COLLAPSE_PX_SIDEBAR) rightViewingEl?.classList?.remove("isCollapsed");
      }
      syncTimelineBarCollapsedForMode();
      fieldRenderer.resizeCanvas();
      viewingView.resizeTimeline();
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
    viewingView.resizeTimeline();
  });

  vSplit.addEventListener("dblclick", () => {
    if (getMode() === "planning") {
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
    viewingView.resizeTimeline();
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
    viewingView.resizeTimeline();
    fieldRenderer.resetFieldPosition();
    fieldRenderer.resizeCanvas();
  });

  if (planningTimelineSplit) {
    planningTimelineSplit.addEventListener("dblclick", () => {
      setPlanningTimelineCollapsed(!isPlanningTimelineCollapsed());
      planningView.resizeTimeline();
      fieldRenderer.resizeCanvas();
      void saveSettings();
    });
  }
})();

// -------- data load --------
function setData(obj, options = {}) {
  const { replacePlanning = true, replaceViewing = true } = options;
  if (!obj) {
    setStatus("Invalid JSON: missing data object");
    return;
  }

  if (replacePlanning) {
    app.planning.load(obj);
  }

  if (replaceViewing) {
    app.viewing.load(obj);
  }

  if (!hasLoadedData()) {
    setStatus("Invalid JSON: no viewing or planning route data found");
    return;
  }

  finalizeLoadedData();
}

function setDataFromStreamText(text) {
  app.planning.clear();
  liveLastPoseT = null;

  const parsedViewingBatch = createParsedLiveViewingBatch();
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    parseLiveLineIntoState(line, parsedViewingBatch);
  }
  app.viewing.loadParsedBatch(parsedViewingBatch);

  if (!hasLoadedData()) {
    setStatus("No poses, watches, logs, waypoints, or planning data found in file.");
    return;
  }

  finalizeLoadedData();
}

function hasLoadedData() {
  return app.viewing.data.hasData || app.planning.hasData;
}

function finalizeLoadedData() {
  setCurrentUnits(getCurrentUnits());
  updateOffsetsFromInputs();

  scheduleSavedPathsSave();

  // Sync to settings modal and save
  syncMainToSettings();
  saveSettings();

  fieldRenderer.setBounds(FIELD_BOUNDS_IN);

  syncTopBarPlayback();
  topBar.setFieldEnabled(true);
  updateExportButtonAvailability();

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
        setCurrentUnits(settings.units);
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
        app.planning.setExportTemplate(settings.planExportTemplate);
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
        app.viewing.playback.setRate(playRate);
        app.planning.playback.setRate(playRate);
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
      const { minV, maxV } = getMinMaxSpeed();
      app.viewing.setSpeedRange(minV, maxV);
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
      lastSeenAppVersion: upgradeState.currentVersion,
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
      planExportTemplate: app.planning.exportTemplate,
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
  if (settingsUnitsSelect.value !== getCurrentUnits()) {
    setCurrentUnits(settingsUnitsSelect.value);
    updateOffsetsFromInputs();
    refreshUnitSensitiveRendering();
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
    const { minV, maxV } = getMinMaxSpeed();
    app.viewing.setSpeedRange(minV, maxV);
  }
  if (settingsMaxSpeed && maxSpeedEl && settingsMaxSpeed.value !== maxSpeedEl.value) {
    maxSpeedEl.value = settingsMaxSpeed.value;
    const { minV, maxV } = getMinMaxSpeed();
    app.viewing.setSpeedRange(minV, maxV);
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
  const Units = settingsUnitsSelect?.value || unitsSelect?.value || getCurrentUnits() || "in";
  const SelectedField = topBar.getSelectedField() || DEFAULT_FIELD_KEY;
  const poses = app.viewing.data.poses;
  const poseStart = poses[0]?.t ?? null;
  const poseEnd = poses[poses.length - 1]?.t ?? null;

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
    AppVersion: app.version,
    Creator: "MotionView",
    PathName,
    Stats: {
      PoseCount: poses.length,
      WatchCount: app.viewing.data.watches.length,
      LogCount: app.viewing.data.logs.length,
      WaypointCount: app.viewing.data.waypoints.length,
      WaypointEvents: waypointEventCount(app.viewing.data.waypoints),
      PlannedWaypointCount: app.planning.route.length,
      PlannedObjectCount: app.planning.objects.length,
      PlannedNodeCount: app.planning.timeline.length,
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
  return app.viewing.data.hasData;
}

function hasPlanningExportData() {
  return app.planning.hasData;
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
  const planningExport = app.planning.exportData();

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
    const viewingExport = app.viewing.exportData();
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
  const entries = flattenMetaEntries(app.viewing.data.metadata);
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

function syncImportedRouteMetaUi() {
  const metadata = app.viewing.data.metadata;
  if (btnRouteInfo) {
    btnRouteInfo.disabled = !metadata;
  }
  updateExportButtonAvailability();
  if (btnApplyRunSettings) {
    btnApplyRunSettings.disabled = !metadata?.ViewingSettings;
  }
  renderRouteInfoList();
}

async function applyImportedRunSettings() {
  const viewing = app.viewing.data.metadata?.ViewingSettings;
  if (!viewing || typeof viewing !== "object") {
    setStatus("No run settings were found in this route metadata.");
    return;
  }

  if (viewing.Units !== undefined) {
    const nextUnits = inferUnitsFromMeta(viewing.Units);
    if (unitsSelect) unitsSelect.value = nextUnits;
    if (settingsUnitsSelect) settingsUnitsSelect.value = nextUnits;
    setCurrentUnits(nextUnits);
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
  const { minV, maxV } = getMinMaxSpeed();
  app.viewing.setSpeedRange(minV, maxV);
  requestDrawAll();
  await saveSettings();
  setStatus("Applied run settings from imported metadata.");
}

function openRouteInfoModal() {
  if (!routeInfoModal || !app.viewing.data.metadata) return;
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
      setStatus(`Exported ${pendingExportRequest.filename}.`);
      const includesPlanning = pendingExportRequest.exportType === "planning" || pendingExportRequest.exportType === "both";
      const includesViewing = pendingExportRequest.exportType === "viewing" || pendingExportRequest.exportType === "both";
      void exportTelemetry.motionviewJsonExported(app.planning.telemetryProperties({
        export_type: pendingExportRequest.exportType,
        includes_planning: includesPlanning,
        includes_viewing: includesViewing,
        export_location: pendingExportRequest.destination.kind,
        exported_chars: pendingExportRequest.json.length,
        exported_bytes: getUtf8ByteLength(pendingExportRequest.json),
        exported_planning_template_bytes: includesPlanning ? getUtf8ByteLength(app.planning.exportTemplate) : 0,
        exported_viewing_poses: includesViewing ? app.viewing.data.poses.length : 0,
        exported_viewing_watches: includesViewing ? app.viewing.data.watches.length : 0,
        exported_viewing_logs: includesViewing ? app.viewing.data.logs.length : 0,
        exported_viewing_waypoints: includesViewing ? app.viewing.data.waypoints.length : 0,
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

// Global Escape handler: close modals and prevent window-level behavior
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const helpOpen = helpModal && helpModal.style.display !== "none" && !helpModal.hasAttribute("hidden");
  const settingsOpen = settingsModal && settingsModal.style.display !== "none" && !settingsModal.hasAttribute("hidden");
  const exportOpen = exportModal && exportModal.style.display !== "none" && !exportModal.hasAttribute("hidden");
  const routeInfoOpen = routeInfoModal && routeInfoModal.style.display !== "none" && !routeInfoModal.hasAttribute("hidden");
  if (helpOpen) closeHelp();
  else if (settingsOpen) closeSettings();
  else if (exportOpen) closeExportModal();
  else if (routeInfoOpen) closeRouteInfoModal();
  else if (planningDialogs.cancelOpen()) { /* Planning dialog resolved by its owner. */ }
  else if (app.viewing.navigation.selectedWaypointId != null) {
    viewingView.clearWaypointSelection();
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
      setStatus(`PROS directory set to: ${result.dir}`);
      setProsDirStatus(`Using PROS project: ${result.dir}`, "ok");
      saveSettings();
      updateConnectButtonState();
      updateExportUiState();
    } else {
      prosDirValid = false;
      setStatus(`Failed to set PROS directory: ${result.status}`);
      setProsDirStatus(`Invalid PROS directory: ${result.status}`, "error");
      updateConnectButtonState();
      updateExportUiState();
    }
  } catch (e) {
    prosDirValid = false;
    console.error("Error updating PROS directory:", e);
    setStatus(`Error updating PROS directory: ${e.message || e}`);
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
    setStatus("Error loading robot image.");
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
    requestDrawAll();
    saveSettings();
  });
}

function togglePlaybackForCurrentMode() {
  if (getMode() === "planning") {
    if (app.planning.playback.isPlaying) app.planning.playback.pause();
    else app.planning.playback.play();
    requestDrawAll();
    return;
  }
  if (!app.viewing.data.hasData) return;
  app.viewing.playback.toggle();
}

if (btnTogglePlanOverlay) {
  btnTogglePlanOverlay.addEventListener("click", () => {
    const visible = app.planning.toggleOverlay();
    btnTogglePlanOverlay.classList.toggle("isOn", visible);
    topBar.syncPlanOverlay(visible);
    requestDrawAll();
    viewingTelemetry.planOverlayToggled({
      enabled: visible,
    }).catch(err => console.error(err));
  });
  btnTogglePlanOverlay.classList.toggle("isOn", app.planning.overlayVisible);
  topBar.syncPlanOverlay(app.planning.overlayVisible);
}

if (unitsSelect) {
  unitsSelect.addEventListener("change", (e) => {
    if (e.target.value !== getCurrentUnits()) {
      setCurrentUnits(e.target.value);
      updateOffsetsFromInputs();
      refreshUnitSensitiveRendering();
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
  const { minV, maxV } = getMinMaxSpeed();
  app.viewing.setSpeedRange(minV, maxV);
  syncMainToSettings();
  saveSettings();
});

settingsMaxSpeed.addEventListener("input", () => {
  const { minV, maxV } = getMinMaxSpeed();
  app.viewing.setSpeedRange(minV, maxV);
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
    syncPlanningProjectionConfiguration();
    saveSettings();
  });
}
if (settingsPlanThetaSnapStep) {
  settingsPlanThetaSnapStep.addEventListener("change", () => {
    syncPlanningProjectionConfiguration();
    saveSettings();
  });
}
if (settingsPlanLimitBounds) {
  settingsPlanLimitBounds.addEventListener("change", () => {
    syncPlanningProjectionConfiguration();
    saveSettings();
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

function clearAllPosesAndWatches() {
  app.viewing.clear();
  try { watchByLabel = {}; } catch { }
  liveLastPoseT = null;
  try { livePendingBuffer.clear(); } catch { }
}

async function confirmPlanningClear(message, clear): Promise<void> {
  if (!app.planning.hasData || await planningDialogs.confirm({ message })) clear();
}

function handleClearFieldClick(event) {
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault();
    // Clear everything across modes
    const clearAll = () => {
      clearAllPosesAndWatches();
      resetLiveWin();
      app.planning.clear();
      requestDrawAll();
      setStatus("Cleared Field and Planned Path");
    };
    void confirmPlanningClear("Are you sure you want to clear the field and Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearAll);
    return;
  }

  if (getMode() === "planning") {
    const clearPlanOnly = () => {
      app.planning.clear();
      requestDrawAll();
      setStatus("Cleared Planned Path");
    };
    void confirmPlanningClear("Are you sure you want to clear Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearPlanOnly);
  } else {
    clearAllPosesAndWatches();
    resetLiveWin();
    setStatus("Cleared Field");
  }
}


function handleGlobalKeydown(e) {
  const mouseTag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  const isTypingTarget = (mouseTag === "input" || mouseTag === "textarea" || (e.target && e.target.isContentEditable));
  if (isTypingTarget && e.target !== liveWinEl) return;

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
      topBar.openFilePicker();
      return;
    }

    if (e.key === "r" || e.key === "R") {
      if (getMode() !== "viewing") return;
      e.preventDefault();
      btnLeftRefresh?.click();
      return;
    }

    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      if (getMode() !== "viewing") return;
      if (leftConnected) void disconnectLeft();
      else void connectLeft();
      return;
    }
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (getMode() !== "viewing") return;

      if (leftConnected) {
        if (!leftStreaming) void startStreaming();
        else void stopStreaming(false);
      }
      return;
    }

    if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      if (getMode() === "planning") {
        const clearPlanOnly = () => {
          app.planning.clear();
          requestDrawAll();
          setStatus("Cleared Planned Path");
        };
        void confirmPlanningClear("Are you sure you want to clear Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearPlanOnly);
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
      app.planning.clear();
      requestDrawAll();
      setStatus("Cleared Field and Planned Path");
    };
    void confirmPlanningClear("Are you sure you want to clear the field and Planning mode? This will remove all waypoints, objects, methods, and nodes.", clearAll);
    return;
  }

  if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      if (getMode() === "viewing" && btnTogglePlanOverlay) btnTogglePlanOverlay.click();
      return;
    }

    if (e.key === "t" || e.key === "T") {
      viewingView.toggleFloatingInfo();
      return;
    }

    if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      if (getMode() !== "viewing") return;
      viewingView.toggleWatchGraph();
      return;
    }
  }

  if (!e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && (e.key === "N" || e.key === "n")) {
    e.preventDefault();
    viewingView.openFloatingWatch(null);
    return;
  }

  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    fieldRenderer.resetFieldPosition();
    return;
  }

  if (viewingInput.handleKeydown(e)) return;
}

sanitizeExportFilename();
// -------- init --------
loadFieldOptions();
await loadSettings();
syncPlanningProjectionConfiguration();
await loadSavedPaths();
await loadDemoRouteIfUpgraded();
setMode("viewing");
void app.markReady({
  plan_saved: app.planning.route.length > 0,
  plan_points: app.planning.route.length,
});

async function prepareAppExit() {
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

  return {
    uptime: Number(uptime),
  };
}

const setupExitHandler = async () => {
  if (!app.core.tauri.isTauriRuntime()) return;
  const appWindow = getCurrentWindow();
  if (!appWindow?.listen) return;

  const beginAppQuit = async (reason) => {
    if (!app.beginExit(reason)) return;
    setStatus("App closing");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    let exitProperties = {};
    try {
      exitProperties = await prepareAppExit();
    } catch (err) {
      console.error("Failed to prepare app quit:", err);
    }
    try {
      await app.finalizeExit(exitProperties);
    } catch (err) {
      console.error("Failed to finalize app quit:", err);
    }
  };

  // Listen for the user clicking the "X"
  await appWindow.listen("tauri://close-requested", async () => {
    await beginAppQuit("window-close");
  });

  await appWindow.listen("motionview://app-quit-requested", async () => {
    await beginAppQuit("backend-request");
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && (event.key === "q" || event.key === "Q")) {
      event.preventDefault();
      void beginAppQuit("keyboard");
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
  viewingView.resizeTimeline();
  planningView.resizeTimeline();
  viewingView.resizeWatchGraph();
  topBar.scheduleLayout();
});

fieldRenderer.updateFieldLayout(false);
viewingView.resizeTimeline();
planningView.resizeTimeline();
topBar.bindEvents();
topBar.scheduleLayout();
if (robotImgControlsEl) robotImgControlsEl.hidden = true;
if (settingsRobotImgControls) settingsRobotImgControls.hidden = true;
syncRobotImgTxFromInputs();
fieldRenderer.loadRobotImage();
drawFirstField();
syncTopBarPlayback();
void setupExitHandler();
