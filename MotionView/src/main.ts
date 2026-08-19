// @ts-nocheck
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import fitIconUrl from "./assets/svg/common/fit.svg?url";
import demoRouteUrl from "./assets/demo/getting-started-route.json?url";
import changeObjectColorIconUrl from "./assets/svg/planning/changeObjectColor.svg?url";
import removePlanningObjectIconUrl from "./assets/svg/planning/removePlanningObject.svg?url";
import { initializeMotionViewApp } from "./app/appRuntime";
import { HelpDom, HelpView } from "./app/help";
import { AppCommands, AppInput } from "./app/input";
import { SettingsDom, SettingsRepository, SettingsView } from "./app/settings";
import { TopBarDom, TopBarView } from "./app/topBar";
import { getMode, setMode, subscribeMode } from "./app/modeController";
import { setStatus } from "./app/status";
import { LiveDom, LiveInput, LiveView } from "./live";
import { FieldRenderer, FIELD_BOUNDS_IN } from "./render/field";
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
} from "./render/field/fieldImages";
import {
  getUtf8ByteLength,
  serializePlanNode,
  PlanningDialogs,
  PlanningCodeExportDialog,
  PlanningDom,
  PlanningInput,
  PlanningView,
} from "./planning";
import { PlanningLayoutView } from "./planning/render/PlanningLayoutView";
import { appTelemetry, exportTelemetry, planningTelemetry, viewingTelemetry } from "./telemetry/createTelemetry";
import {
  buildWaypointState,
  ViewingDom,
  ViewingInput,
  ViewingView,
  normalizeLogs,
  normalizePoses,
  normalizeWatches,
  waypointEventCount,
} from "./viewing";
import { ViewingLayoutView } from "./viewing/render/ViewingLayoutView";

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

const root = document.documentElement;
let persistedAppState = null;
let settingsLoaded = false;

const canvas = document.getElementById("c");

const btnFile = document.getElementById("btnFile");
const btnTogglePlanOverlay = document.getElementById("btnTogglePlanOverlay");
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
const settingsPlanSnapStepLabel = document.getElementById("settingsPlanSnapStepLabel");
const settingsPlanMoveStepLabel = document.getElementById("settingsPlanMoveStepLabel");
const settingsPlanMoveStep = document.getElementById("settingsPlanMoveStep");
const settingsPlanSnapStep = document.getElementById("settingsPlanSnapStep");
const settingsPlanThetaSnapStep = document.getElementById("settingsPlanThetaSnapStep");
const settingsPlanLimitBounds = document.getElementById("settingsPlanLimitBounds");


const MAX_OFFSET_THETA = 359;

const MAX_PLAN_UNDO = 50;      // Max number of undo steps

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

let pendingExportRequest = null;

const fieldRenderer = new FieldRenderer(canvas);
const settingsRepository = new SettingsRepository();
const settingsView = new SettingsView(fieldRenderer, SettingsDom.from(document));
settingsView.bind();
fieldRenderer.setRobotDimensions(robotDimsInches());
fieldRenderer.events.robotImageAvailabilityChanged.subscribe(({ available }) => {
    if (robotImgControlsEl) robotImgControlsEl.hidden = !available;
    if (settingsRobotImgControls) settingsRobotImgControls.hidden = !(fieldRenderer.isRobotImageEnabled() && available);
});
fieldRenderer.events.fieldImageLoaded.subscribe(({ fieldKey }) => {
    syncPlanningProjectionConfiguration();
    viewingTelemetry.fieldImageLoaded({ field: fieldKey });
});

const topBarDom = TopBarDom.from(document);
const topBar = new TopBarView(app, fieldRenderer, topBarDom);
const helpView = new HelpView(app, HelpDom.from(document));
helpView.bind();
settingsView.closing.subscribe(() => {
  syncSettingsToMain();
  void saveSettings();
});
settingsView.robotImageRequested.subscribe(() => topBar.openRobotImagePicker());

const planningDom = PlanningDom.from(document);
const planningDialogs = new PlanningDialogs(planningDom);
const planningCodeExportDialog = new PlanningCodeExportDialog(app.planning, planningDom);
const planningView = new PlanningView(app.planning, fieldRenderer, planningDom, planningDialogs);
const planningInput = new PlanningInput(app.planning, fieldRenderer, planningDialogs);
planningDialogs.bind();
planningCodeExportDialog.bind();
planningCodeExportDialog.changed.subscribe(() => {
  if (settingsLoaded) void saveSettings();
});
planningView.bind();
planningInput.bind();
planningView.render();
fieldRenderer.registerPlanningLayer(planningView);
registerPlanningRenderLayer(planningView);

app.planning.events.documentChanged.subscribe(() => {
  scheduleSavedPathsSave();
  updateExportButtonAvailability();
});

subscribeMode((mode) => {
  document.body.classList.toggle("mode-planning", mode === "planning");
  if (mode === "planning" && app.viewing.playback.isPlaying) app.viewing.playback.pause();
  if (mode === "viewing" && app.planning.playback.isPlaying) app.planning.playback.pause();
  app.planning.selection.clear();
  fieldRenderer.updateFieldLayout(true);
  if (mode === "planning") planningLayout.activate();
  else viewingLayout.activate();
  app.planning.playback.setDistance(app.planning.playback.distance);
  void appTelemetry.modeChanged({
    mode,
  });
});

let savedPathsSaveTimer = null;

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
  viewingLayout.applyPersistedLayout({
    leftSidebarWidth: settings.layoutLeftSidebarWidth,
    sidebarWidth: settings.layoutRightSidebarWidthViewing,
    timelineHeight: settings.layoutTimelineHeight,
  });
  planningLayout.applyPersistedLayout({
    sidebarWidth: settings.layoutRightSidebarWidthPlanning,
    waypointListHeight: settings.layoutPlanningWaypointHeight,
    timelineHeight: settings.layoutPlanningTimelineHeight,
  });

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

function formatLogArgs(args) {
  return args.map((a) => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(" ");
}

// Mirror key console errors into the backend log for shipped apps
const _consoleError = console.error.bind(console);
console.error = (...args) => {
  _consoleError(...args);
  void app.core.bridge.log("ERROR", formatLogArgs(args), "console");
};
const _consoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  _consoleWarn(...args);
  void app.core.bridge.log("WARN", formatLogArgs(args), "console");
};
window.addEventListener("error", (e) => {
  const msg = `${e.message || "Script error"} @ ${e.filename || "unknown"}:${e.lineno || 0}:${e.colno || 0}`;
  void app.core.bridge.log("ERROR", msg, "window");
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason?.stack || e.reason?.message || String(e.reason);
  void app.core.bridge.log("ERROR", `Unhandled rejection: ${reason}`, "window");
});

// -------- canvas/readout helpers --------
function setFieldRotationDeg(deg) {
  fieldRenderer.setFieldRotationDeg(deg);
  if (settingsFieldRotation) settingsFieldRotation.value = String(fieldRenderer.getFieldRotationDeg());
}

// -------- field images --------
function loadFieldOptions() {
  const previousValue = topBar.selectedField;
  const visibleFields = getVisibleFieldImages();
  topBar.setFieldOptions(visibleFields, getValidFieldKey(previousValue));
}

function drawFirstField() {
  loadFieldOptions();
  const nextField = getValidFieldKey(topBar.selectedField || DEFAULT_FIELD_KEY);
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

const viewingDom = ViewingDom.from(document);
viewingView = new ViewingView(app.viewing, fieldRenderer, viewingDom);
viewingInput = new ViewingInput(app.viewing, viewingView);
viewingView.bind();
viewingInput.bind();
viewingView.render();
fieldRenderer.registerViewingLayer(viewingView.fieldLayer);
registerViewingRenderLayer(viewingView.timelineLayer);
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
canvas.addEventListener("contextmenu", (event) => { if (getMode() === "planning") event.preventDefault(); });

// -------- Live streaming presentation --------
const liveDom = LiveDom.from(document);
const liveView = new LiveView(app.live, liveDom);
const liveInput = new LiveInput(app.live);
liveView.bind();
liveInput.bind();

const viewingLayout = new ViewingLayoutView(document, fieldRenderer, viewingView, () => void saveSettings());
const planningLayout = new PlanningLayoutView(document, fieldRenderer, planningView, () => void saveSettings());
viewingLayout.bind();
planningLayout.bind();
const appCommands = new AppCommands(app, fieldRenderer, topBar, planningDialogs, planningLayout, viewingLayout, btnTogglePlanOverlay);
const appInput = new AppInput(appCommands);
appCommands.bind();
appInput.bind();
topBar.events.actionRequested.subscribe((action) => {
  if (action.kind === "file-selected") void openFile(action.file, action.input);
  else if (action.kind === "robot-image-selected") void handleRobotImageFile(action.file, action.input);
  else if (action.kind === "clear-requested") void (action.clearAll ? appCommands.clearAll() : appCommands.clearCurrent());
  else if (action.kind === "settings-requested") {
    syncMainToSettings();
    if (app.live.project.path && !app.live.project.valid) void app.live.project.validate();
    settingsView.open();
  }
  else if (action.kind === "help-requested") helpView.open();
});
topBar.events.settingsChanged.subscribe(() => { void saveSettings(); });

app.live.events.connectionChanged.subscribe(() => {
  updateExportButtonAvailability();
});
app.live.events.streamChanged.subscribe(() => {
  updateExportButtonAvailability();
});
app.live.events.projectChanged.subscribe(() => {
  syncProjectExportLocationOption();
  planningCodeExportDialog.setProjectPath(app.live.project.valid ? app.live.project.path : "");
  if (settingsLoaded && app.core.tauri.isTauriRuntime()) void saveSettings();
});
app.live.events.preferencesChanged.subscribe(() => {
  if (settingsLoaded && app.core.tauri.isTauriRuntime()) void saveSettings();
});

planningView.render();


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
  app.live.loadCapture(text);

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


// Settings modal and JSON persistence
async function loadSettings() {
  try {
    const settings = await settingsRepository.read();
    if (!settings && app.core.tauri.isTauriRuntime()) await saveSettings();

    if (settings) {
      if (settings.appState && typeof settings.appState === "object" && !Array.isArray(settings.appState)) {
        persistedAppState = { ...settings.appState };
      }
      if (settings.prosDir) app.live.project.restore(settings.prosDir);
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
      planningCodeExportDialog.applySettings(settings.planningCodeExport);
      if (settings.refreshIntervalMs !== undefined) {
        app.live.preferences.setRefreshInterval(Number(settings.refreshIntervalMs));
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
      prosDir: app.live.project.path,
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
      planningCodeExport: planningCodeExportDialog.settings,
      refreshIntervalMs: String(app.live.preferences.refreshIntervalMs),
      showPreviousYearFields,
      fieldCompetition,
      playbackSpeed: String(topBar.playbackSpeed),
      selectedField: topBar.selectedField || DEFAULT_FIELD_KEY,
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
    await settingsRepository.write(settings);
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
  }
  fieldRenderer.setRobotDimensions(robotDimsInches());
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
  if (!app.live.project.valid) return "";
  const rawDir = app.live.project.path.trim();
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
  const SelectedField = topBar.selectedField || DEFAULT_FIELD_KEY;
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
  btnExport.disabled = app.live.stream.state !== "idle" || !hasAnyExportData();
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
    fieldRenderer.setRobotDimensions(robotDimsInches());
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
  const exportOpen = exportModal && exportModal.style.display !== "none" && !exportModal.hasAttribute("hidden");
  const routeInfoOpen = routeInfoModal && routeInfoModal.style.display !== "none" && !routeInfoModal.hasAttribute("hidden");
  if (exportOpen) closeExportModal();
  else if (routeInfoOpen) closeRouteInfoModal();
  else if (planningDialogs.cancelOpen()) { /* Planning dialog resolved by its owner. */ }
  else return;
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
  const previousField = topBar.selectedField || DEFAULT_FIELD_KEY;
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
  fieldRenderer.setRobotDimensions(robotDimsInches());
  syncMainToSettings();
  saveSettings();
});

robotHEl.addEventListener("input", () => {
  fieldRenderer.setRobotDimensions(robotDimsInches());
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

sanitizeExportFilename();
// -------- init --------
loadFieldOptions();
await loadSettings();
fieldRenderer.setRobotDimensions(robotDimsInches());
settingsLoaded = true;
void app.live.initialize();
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

  await app.live.finalizeTelemetry();

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

fieldRenderer.updateFieldLayout(false);
viewingLayout.activate();
topBar.bind();
topBar.render();
if (robotImgControlsEl) robotImgControlsEl.hidden = true;
if (settingsRobotImgControls) settingsRobotImgControls.hidden = true;
syncRobotImgTxFromInputs();
fieldRenderer.loadRobotImage();
drawFirstField();
void setupExitHandler();
