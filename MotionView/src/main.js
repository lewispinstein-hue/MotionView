const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;
if (!invoke) console.warn("Tauri API not available; running in browser?");

let ORIGIN = window.__BRIDGE_ORIGIN__ ?? null;
let WS_ORIGIN = ORIGIN ? ORIGIN.replace(/^http/, "ws") : null;

const root = document.documentElement;
// Live streaming state shared across handlers (avoids TDZ issues)
window.__live = window.__live || { connected: false, streaming: false };

const canvas = document.getElementById('c');
// Track last mouse position (for small popups)
let lastMouseClient = { x: 20, y: 20 };
window.addEventListener('mousemove', (e) => { lastMouseClient = { x: e.clientX, y: e.clientY }; }, { passive: true });

const ctx = canvas.getContext('2d');
const timelineCanvas = document.getElementById('timelineCanvas');
const tctx = timelineCanvas.getContext('2d');
const planningTimelineBar = document.getElementById('planningTimelineBar');
const planningTimelineCanvas = document.getElementById('planningTimelineCanvas');
const planTimePill = document.getElementById('planTimePill');
const planPointPill = document.getElementById('planPointPill');
const pctx = planningTimelineCanvas ? planningTimelineCanvas.getContext('2d') : null;

const statusEl = document.getElementById('status');
const fileEl = document.getElementById('file');
const btnPlay = document.getElementById('btnPlay');
const btnFit = document.getElementById('btnFit');
const btnFile = document.getElementById('btnFile');
const btnHelp = document.getElementById('btnHelp');
const btnLeftStop = document.getElementById('btnLeftStop');
const btnLeftConnect = document.getElementById('btnLeftConnect');
const btnLeftRefresh = document.getElementById('btnLeftRefresh');
const leftRefreshInterval = document.getElementById('leftRefreshInterval');
const liveWin = document.getElementById('liveWin');
const btnTogglePlanOverlay = document.getElementById('btnTogglePlanOverlay');
const helpModal = document.getElementById('helpModal');
const btnHelpClose = document.getElementById('btnHelpClose');
const speedSelect = document.getElementById('speedSelect');
const watchSort = document.getElementById('watchSort');
const vSplit = document.getElementById('vSplit');
const hSplit = document.getElementById('hSplit');
const timePill = document.getElementById('timePill');
const deltaPill = document.getElementById('deltaPill');
const pointPill = document.getElementById('pointPill');
const posePill = document.getElementById('posePill');

const rightEl = document.getElementById('right');
const leftEl = document.getElementById('left');
const vSplitL = document.getElementById('vSplitL');
const rowGrid = document.querySelector('.row');

const timelineBar = document.getElementById('timelineBar');
const timelineTop = document.getElementById('timelineTop');
const timelineHint = document.getElementById('timelineHint');

// Removed: runName, runMeta, fmt (were in Config section)
const watchList = document.getElementById('watchList');
const watchCount = document.getElementById('watchCount');
const secWatches = document.getElementById('secWatches');
const fieldSelect = document.getElementById('fieldSelect');

const poseList = document.getElementById('poseList');
const poseCount = document.getElementById('poseCount');

const offXEl = document.getElementById('settingsOffX');
const offYEl = document.getElementById('settingsOffY');
const offThetaEl = document.getElementById('settingsOffTheta');
const unitsSelect = document.getElementById('unitsSelect');
const robotWEl = document.getElementById('settingsRobotW');
const robotHEl = document.getElementById('settingsRobotH');
const robotImgControlsEl = document.getElementById('robotImgControls');
const robotImgScaleEl = document.getElementById('robotImgScale');
const robotImgOffXEl = document.getElementById('robotImgOffX');
const robotImgOffYEl = document.getElementById('robotImgOffY');
const robotImgRotEl = document.getElementById('robotImgRot');
const minSpeedEl = document.getElementById('settingsMinSpeed');
const maxSpeedEl = document.getElementById('settingsMaxSpeed');

// Settings modal elements
const btnSettings = document.getElementById('btnSettings');
const settingsModal = document.getElementById('settingsModal');
const btnSettingsClose = document.getElementById('btnSettingsClose');
const modeViewingBtn = document.getElementById('modeViewing');
const modePlanningBtn = document.getElementById('modePlanning');
const prosDirInput = document.getElementById('prosDirInput');
const btnProsDirAuto = document.getElementById('btnProsDirAuto');
const btnUploadRobotImage = document.getElementById('btnUploadRobotImage');
const robotImageFile = document.getElementById('robotImageFile');
const robotImageToggle = document.getElementById('robotImageToggle');
const settingsRobotImgControls = document.getElementById('settingsRobotImgControls');
const settingsRobotImgScale = document.getElementById('settingsRobotImgScale');
const settingsRobotImgOffX = document.getElementById('settingsRobotImgOffX');
const settingsRobotImgOffY = document.getElementById('settingsRobotImgOffY');
const settingsRobotImgRot = document.getElementById('settingsRobotImgRot');
const settingsFieldRotation = document.getElementById('settingsFieldRotation');
const settingsUnitsSelect = document.getElementById('settingsUnitsSelect');
const settingsRobotW = document.getElementById('settingsRobotW');
const settingsRobotH = document.getElementById('settingsRobotH');
const settingsOffX = document.getElementById('settingsOffX');
const settingsOffY = document.getElementById('settingsOffY');
const settingsOffTheta = document.getElementById('settingsOffTheta');
const settingsMinSpeed = document.getElementById('settingsMinSpeed');
const settingsMaxSpeed = document.getElementById('settingsMaxSpeed');
const settingsPlanMoveStep = document.getElementById('settingsPlanMoveStep');
const settingsPlanSnapStep = document.getElementById('settingsPlanSnapStep');
const settingsPlanSpeed = document.getElementById('settingsPlanSpeed');
const planListEl = document.getElementById('planList');
const planCountEl = document.getElementById('planCount');
const planSelIndexEl = document.getElementById('planSelIndex');
const planSelXEl = document.getElementById('planSelX');
const planSelYEl = document.getElementById('planSelY');
const planSelThetaEl = document.getElementById('planSelTheta');

const prosDirStatusEl = document.getElementById('prosDirStatus');
const prosDirAutoStatusEl = document.getElementById('prosDirAutoStatus');
const prosDirAutoResultsEl = document.getElementById('prosDirAutoResults');
let prosDirValid = false;
let prosDirRetryTimer = null;
let prosDirRetryAttempts = 0;
let prosDirFromSettings = false;

// --- FIELD IMAGES ---
const FIELD_IMAGES = [
  { key: "./assets/match_field_2025-2026_pushback.png", label: "Field: Match Field" },
  { key: "./assets/skills_field_2025-2026_pushback.png", label: "Field: Skills Field" },
];

// Default field image
const DEFAULT_FIELD_KEY = FIELD_IMAGES[0].key;

// Field bounds in INCHES (default view when no Fit)
const FIELD_BOUNDS_IN = { minX: -72, maxX: 72, minY: -72, maxY: 72, pad: 30 };

const WATCH_TOL_MS = 40; // Controls the ± time that determines which pose a watch attaches to
const COLLAPSE_PX_TIMELINE = 140; // When the timeline collapses away
const COLLAPSE_PX_SIDEBAR = 275; 

const COLLAPSE_PX_LEFTSIDEBAR = 370; // When the left sidebar collapses away
const DBLCLICK_COLLAPSE_LEFTSIDEBAR = true;
const MAX_PX_LIVEWIN = 650; // Max width for left live window panel

const MAX_TIMELINE_H_PX = 350; // Height at which timeline stops growing
const MAX_SIDEBAR_W_PX = 400; // Width at which sidebar stops growing

const HOVER_PIXEL_TOL = 14;
const TRACK_HOVER_PAD_PX = 12; // How close to the track before snapping on

const OFFSET_MAX = 100; // Max offset in either direction

const CANVAS_ZOOM_MAX = 12; // Max zoom in
const CANVAS_ZOOM_MIN = 0.7; // Max zoom out

const minW = 50, maxW = 400;
const minH = 49, maxH = 600; // Bring minH back to 241
let data = null;

// Raw poses are stored in FILE units; we convert to inches for rendering.
// Fields: t, x, y, theta, l_vel, r_vel, speed_raw, speed_norm
let rawPoses = [];

// Watches: normalized
let watches = [];
let watchMarkers = []; // {watch, t, pose(in), ok, idx, dt}

let selectedWatch = null;       // { marker }
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
// optional robot image (./robot_image.png)
let robotImg = null;
let robotImgOk = false;
let robotImgLoadTried = false;
let robotImageEnabled = true; // toggle for showing/hiding robot image
let robotImagePath = null;
let robotImageDataUrl = null;

const robotImgTx = { scale: 1, offXIn: 0, offYIn: 0, rotDeg: 0 };
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

let appMode = "viewing";

// -------- planning --------
let planWaypoints = []; // {x,y} in inches
let planSelected = -1;
let planDragging = false;
let planPointerId = null;
let planDragOffset = { x: 0, y: 0 };
let planSelectedSet = new Set();
let planDragStart = { x: 0, y: 0 };
let planDragOrig = [];
let planSelecting = false;
let planSelectRect = null; // {x0,y0,x1,y1} in screen px
let planThetaDragging = false;
let planThetaDragIdx = -1;
let planPlaying = false;
let planRaf = null;
let planPlayDist = 0;
let planLastWall = null;
const PLAN_SPEED = 1; // units per second
const PLAN_POINT_R = 11;
const PLAN_THETA_HANDLE_R = 6;
const PLAN_THETA_HANDLE_OFFSET = 25;
let planScrubbing = false;
let planOverlayVisible = false;
let savedPathsSaveTimer = null;

function getPlanMoveStepIn() {
  const v = Number(settingsPlanMoveStep?.value || 0.5);
  return (isFinite(v) && v > 0) ? v : 0.5;
}

function getPlanSnapStepIn() {
  const v = Number(settingsPlanSnapStep?.value || 0);
  return (isFinite(v) && v > 0) ? v : 0;
}

function getPlanSpeedUnitsPerSec() {
  const pct = clamp(Number(settingsPlanSpeed?.value || 0), 0, 100);
  const { maxV } = getMinMaxSpeed();
  return (maxV || 0) * (pct / 100);
}

function applyPlanSnap(v) {
  const step = getPlanSnapStepIn();
  if (!step) return v;
  return Math.round(v / step) * step;
}

function clampPlanCoord(v) {
  return clampMax(applyPlanSnap(v), MAX_OFFSET_XY);
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
  return normalizeDeg(theta + fieldRotationDeg);
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
  const total = planTotalLength();
  const t = clamp((x - 6) / (W - 12), 0, 1);
  return total * t;
}

function planSampleAtDist(d) {
  if (planWaypoints.length === 0) return null;
  if (planWaypoints.length === 1) {
    const p = planWaypoints[0];
    const thetaPlan = normalizeDeg(p.theta ?? 0);
    const thetaField = thetaPlan + fieldRotationDeg;
    const thetaRobot = thetaField - 90;
    return { x: p.x, y: p.y, theta: thetaRobot };
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
      const theta0 = normalizeDeg(a.theta ?? 0);
      const theta1 = normalizeDeg(b.theta ?? 0);
      const diff = ((theta1 - theta0 + 540) % 360) - 180;
      const thetaPlan = theta0 + diff * t;
      const thetaField = thetaPlan + fieldRotationDeg;
      const thetaRobot = thetaField - 90;
      return { x, y, theta: thetaRobot };
    }
    rem -= seg;
  }
  const last = planWaypoints[planWaypoints.length - 1];
  const thetaPlan = normalizeDeg(last.theta ?? 0);
  const thetaField = thetaPlan + fieldRotationDeg;
  const thetaRobot = thetaField - 90;
  return { x: last.x, y: last.y, theta: thetaRobot };
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
  requestDrawAll();
}

function updatePlanControls() {
  if (!btnPlay) return;
  if (appMode === "planning") {
    btnPlay.disabled = planWaypoints.length < 2;
  } else {
    btnPlay.disabled = rawPoses.length < 2;
  }
}

function renderPlanList() {
  if (!planListEl) return;
  planListEl.innerHTML = '';
  if (planCountEl) planCountEl.textContent = `${planWaypoints.length}`;
  for (let i = 0; i < planWaypoints.length; i++) {
    const p = planWaypoints[i];
    const item = document.createElement('div');
    item.className = 'planItem' + (planSelectedSet.has(i) ? ' selected' : '');
    item.dataset.idx = String(i);
    const theta = planThetaDegAt(i);
    item.innerHTML = `
      <div class="muted">#${i + 1}</div>
      <div>X: ${fmtNum(p.x, 2)}  Y: ${fmtNum(p.y, 2)}  θ: ${fmtNum(theta, 1)}°</div>
    `;
    item.addEventListener('click', () => {
      planSelectSingle(i);
      requestDrawAll();
      renderPlanList();
      updatePlanSelectionPanel();
    });
    planListEl.appendChild(item);
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
  renderPlanList();
  updatePlanControls();
  setPlanDist(planPlayDist);
  if (!opts.skipSelectionPanel) updatePlanSelectionPanel();
  scheduleSavedPathsSave();
}

async function loadSavedPaths() {
  if (!invoke) return;
  try {
    const saved = await invoke('read_saved_paths');
    if (!saved) return;
    const obj = JSON.parse(saved);
    if (Array.isArray(obj?.["planned-path"])) {
      planWaypoints = obj["planned-path"].map((p) => ({
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        theta: Number(p.theta) || 0,
      }));
      planSetSelection([]);
      planPlayDist = 0;
      planChanged();
    }
    if (Array.isArray(obj?.["robot-path"])) {
      const poses = obj["robot-path"]
        .map((p) => ({
          t: (typeof p.t === "number") ? p.t : (toNumMaybe(p.t) ?? null),
          x: p.x, y: p.y,
          theta: (typeof p.theta === "number") ? p.theta : (toNumMaybe(p.theta) ?? 0),
          l_vel: (typeof p.l_vel === "number") ? p.l_vel : (toNumMaybe(p.l_vel) ?? null),
          r_vel: (typeof p.r_vel === "number") ? p.r_vel : (toNumMaybe(p.r_vel) ?? null),
          speed_raw: (typeof p.speed_raw === "number") ? p.speed_raw : (toNumMaybe(p.speed_raw) ?? 0),
          speed_norm: 0,
        }))
        .filter(p => typeof p.x === "number" && typeof p.y === "number");
      if (poses.length) {
        rawPoses = poses.sort((a,b) => (a.t ?? 0) - (b.t ?? 0));
        data = { poses: rawPoses, watches: [], meta: {} };
        computeSpeedNorm();
        syncMainToSettings();
        try { renderPoseList?.(); } catch {}
        try { renderWatchList?.(); } catch {}
        updateFieldLayout(true);
        updatePoseReadout();
        requestDrawAll();
      }
    }
  } catch (e) {
    console.warn('Failed to load saved paths:', e);
  }
}

function scheduleSavedPathsSave() {
  if (!invoke) return;
  if (savedPathsSaveTimer) clearTimeout(savedPathsSaveTimer);
  savedPathsSaveTimer = setTimeout(async () => {
    try {
      const payload = JSON.stringify({
        "planned-path": planWaypoints.map((p) => ({ x: p.x, y: p.y, theta: p.theta ?? 0 })),
        "robot-path": rawPoses.map((p) => ({
          t: p.t ?? null,
          x: p.x, y: p.y,
          theta: p.theta ?? 0,
          l_vel: p.l_vel ?? null,
          r_vel: p.r_vel ?? null,
          speed_raw: p.speed_raw ?? 0,
        })),
      });
      await invoke('write_saved_paths', { contents: payload });
    } catch (e) {
      console.warn('Failed to save paths:', e);
    }
  }, 300);
}

function updatePlanSelectionPanel() {
  if (!planSelXEl || !planSelYEl || !planSelThetaEl || !planSelIndexEl) return;
  const active = document.activeElement;
  if (planSelected < 0 || planSelected >= planWaypoints.length) {
    planSelIndexEl.textContent = "—";
    planSelXEl.value = "";
    planSelYEl.value = "";
    planSelThetaEl.value = "";
    planSelXEl.disabled = true;
    planSelYEl.disabled = true;
    planSelThetaEl.disabled = true;
    return;
  }
  const p = planWaypoints[planSelected];
  planSelIndexEl.textContent = `#${planSelected + 1}`;
  planSelXEl.disabled = false;
  planSelYEl.disabled = false;
  planSelThetaEl.disabled = false;
  if (active === planSelXEl || active === planSelYEl || active === planSelThetaEl) {
    return;
  }
  const xVal = String(fmtNum(p.x, 2));
  const yVal = String(fmtNum(p.y, 2));
  const tVal = String(fmtNum(p.theta ?? 0, 1));
  planSelXEl.value = xVal;
  planSelYEl.value = yVal;
  planSelThetaEl.value = tVal;
  planSelXEl.dataset.lastValid = xVal;
  planSelYEl.dataset.lastValid = yVal;
  planSelThetaEl.dataset.lastValid = tVal;
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
  const theta = planThetaDegAt(i) * Math.PI / 180;
  const dist = PLAN_POINT_R + PLAN_THETA_HANDLE_OFFSET;
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
  p.theta = normalizeDeg(angle - fieldRotationDeg);
  renderPlanList();
  updatePlanSelectionPanel();
  requestDrawAll();
}

function isInField(w) {
  return (
    w.x >= FIELD_BOUNDS_IN.minX &&
    w.x <= FIELD_BOUNDS_IN.maxX &&
    w.y >= FIELD_BOUNDS_IN.minY &&
    w.y <= FIELD_BOUNDS_IN.maxY
  );
}

function drawPlanningOverlay(force = false) {
  if (!force && appMode !== "planning") return;
  if (appMode !== "planning" && !planOverlayVisible) return;
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

  // points
  for (let i = 0; i < planWaypoints.length; i++) {
    const p = planWaypoints[i];
    const sp = worldToScreen(p.x, p.y);
    const isSel = planSelectedSet.has(i);
    const r = PLAN_POINT_R;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.fillStyle = (i === planSelected) ? "rgba(180,220,255,1)" : (isSel ? "rgba(150,200,255,0.95)" : "rgba(120,180,255,0.9)");
    ctx.fill();
    ctx.strokeStyle = "rgba(15,25,35,0.8)";
    ctx.stroke();

    // heading line (black) from center to edge
    const theta = planThetaDegAt(i) * Math.PI / 180;
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
      const dist = r + PLAN_THETA_HANDLE_OFFSET;
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
      ctx.arc(hx, hy, PLAN_THETA_HANDLE_R, 0, Math.PI * 2);
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
  appMode = (mode === "planning") ? "planning" : "viewing";
  document.body.classList.toggle("mode-planning", appMode === "planning");
  if (appMode === "planning" && playing) pause();
  if (appMode === "viewing" && planPlaying) planPause();
  if (modeViewingBtn) {
    const active = appMode === "viewing";
    modeViewingBtn.classList.toggle("isActive", active);
    modeViewingBtn.setAttribute("aria-selected", active ? "true" : "false");
  }
  if (modePlanningBtn) {
    const active = appMode === "planning";
    modePlanningBtn.classList.toggle("isActive", active);
    modePlanningBtn.setAttribute("aria-selected", active ? "true" : "false");
  }
  updateFieldLayout(true);
  resizeTimeline();
  resizePlanningTimeline();
  renderPlanList();
  updatePlanControls();
  setPlanDist(planPlayDist);
}


// offsets: entered in selected units, stored as inches for rendering
const offsetsIn = { x: 0, y: 0, theta: 0 };
let unitsToInFactor = 1;
let currentUnits = "in";
const MAX_OFFSET_XY = 80;
const MAX_OFFSET_THETA = 359;

// -------- utilities --------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function normalizeDeg(d) { let x = d % MAX_OFFSET_THETA; if (x < 0) x += MAX_OFFSET_THETA; return x; }
function angLerpDeg(a, b, t) {
  a = normalizeDeg(a); b = normalizeDeg(b);
  let diff = (b - a + 540) % 360 - 180;
  return normalizeDeg(a + diff * t);
}
function fmtNum(v, d=2) { if (typeof v !== "number" || !isFinite(v)) return "—"; return v.toFixed(d); }
function setStatus(msg) { statusEl.textContent = msg; console.log(`Status: ${msg}`); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

function toNumMaybe(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (isFinite(n)) return n;
  }
  return null;
}

function clampMax(v, max) {
  return v > max ? max : v;
}

function sanitizeOffsetInputs() {
  const xRaw = toNumMaybe(offXEl?.value ?? settingsOffX?.value);
  if (xRaw != null) {
    const clamped = clamp(xRaw, -MAX_OFFSET_XY, MAX_OFFSET_XY);
    if (offXEl) offXEl.value = String(clamped);
    if (settingsOffX) settingsOffX.value = String(clamped);
  }
  const yRaw = toNumMaybe(offYEl?.value ?? settingsOffY?.value);
  if (yRaw != null) {
    const clamped = clamp(yRaw, -MAX_OFFSET_XY, MAX_OFFSET_XY);
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
  if (L.includes("ERROR") || L.includes("FATAL")) return { name:"ERROR", fill:"rgb(255,77,77)", text:"#081018" };
  if (L.includes("WARN")) return { name:"WARN", fill:"rgb(255,212,77)", text:"#081018" };
  if (L.includes("DEBUG")) return { name:"DEBUG", fill:"rgb(154,167,187)", text:"#081018" };
  return { name:"INFO", fill:"rgb(77,255,136)", text:"#081018" };
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

function computeSpeedNorm() {
  const { minV, maxV } = getMinMaxSpeed();
  const denom = (maxV - minV) || 1;
  for (const p of rawPoses) {
    const s = Math.abs(p.speed_raw ?? 0);
    p.speed_norm = clamp((s - minV) / denom, 0, 1);
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
    return `rgba(120, 10, 10, 1)`;
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

// -------- canvas sizing/transform --------
function computeTransform() {
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const pad = bounds.pad;
  const worldW = (bounds.maxX - bounds.minX) || 1;
  const worldH = (bounds.maxY - bounds.minY) || 1;

  baseScale = Math.min((w - pad*2) / worldW, (h - pad*2) / worldH);

  const side = squareMode ? Math.min(w, h) : null;
  const viewW = squareMode ? side : w;
  const viewH = squareMode ? side : h;

  // these center the square viewport
  const vx = squareMode ? (w - side) / 2 : 0;
  const vy = squareMode ? (h - side) / 2 : 0;

  baseOffsetXpx = vx + pad - bounds.minX * baseScale;
  baseOffsetYpx = vy + pad + bounds.maxY * baseScale;

  scale = baseScale * viewZoom;
  offsetXpx = baseOffsetXpx * viewZoom + viewPanXpx;
  offsetYpx = baseOffsetYpx * viewZoom + viewPanYpx;
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

function worldToScreen(xIn, yIn) {
  const xR = xIn * fieldRotationCos - yIn * fieldRotationSin;
  const yR = xIn * fieldRotationSin + yIn * fieldRotationCos;
  return { x: offsetXpx + xR * scale, y: offsetYpx - yR * scale };
}

function screenToWorld(xPx, yPx) {
  const xR = (xPx - offsetXpx) / (scale || 1);
  const yR = (offsetYpx - yPx) / (scale || 1);
  return {
    x: xR * fieldRotationCos + yR * fieldRotationSin,
    y: -xR * fieldRotationSin + yR * fieldRotationCos,
  };
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeTransform();
  draw();
}

function layoutTimelineCanvas() {
  if (!timelineCanvas || !timelineBar) return;
  if (timelineBar.classList.contains('isCollapsed')) return;

  // Ensure we never clip the bottom: compute available height.
  const barH = timelineBar.getBoundingClientRect().height;
  const topH = timelineTop ? timelineTop.getBoundingClientRect().height : 0;
  const hintH = timelineHint ? timelineHint.getBoundingClientRect().height : 0;
  const padding = 10 + 10; // rough internal padding
  const avail = Math.max(144, barH - topH - hintH - padding);
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

function resizePlanningTimeline() {
  if (!planningTimelineCanvas || !pctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = planningTimelineCanvas.getBoundingClientRect();
  planningTimelineCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
  planningTimelineCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPlanningTimeline();
}

// -------- field images --------
function loadFieldOptions() {
  if (!fieldSelect) {
    console.warn('fieldSelect element not found');
    return;
  }
  fieldSelect.innerHTML = `<option value="no">No field image</option>`;
  for (const f of FIELD_IMAGES) {
    const opt = document.createElement('option');
    opt.value = f.key;
    opt.textContent = f.label;
    fieldSelect.appendChild(opt);
  }
}

async function loadFieldImage(filename) {
  if (!filename) { fieldImg = null; draw(); return; }
  const img = new Image();
  img.onload = () => { fieldImg = img; draw(); };
  img.onerror = () => {
    fieldImg = null; 
    draw(); 
    if (filename == "no") return; // No field image is 'no'
    setStatus(`Could not load field image: ${filename}`); 
  };
  img.src = filename;
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
  img.src = "./robot_image.png";
}

function drawFirstField() {
  loadFieldOptions();

  // Set the default selection and trigger the load
  if (!fieldSelect) {
    console.warn('fieldSelect not available for drawFirstField');
    return;
  }
  const defaultField = FIELD_IMAGES.find(f => f.key === DEFAULT_FIELD_KEY);
  
  if (defaultField && fieldSelect) {
    fieldSelect.value = defaultField.key; 
    loadFieldImage(defaultField.key); 
  }
}

// -------- time helpers --------
function timeRange() {
  const t0 = rawPoses[0]?.t;
  const tN = rawPoses[rawPoses.length-1]?.t;
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

  const p1 = rawPoses[i+1];
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
  const cands = [i0, Math.min(i0+1, rawPoses.length-1)];
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

    out.push({
      t,
      level: w.level ?? w.lvl ?? w.severity ?? "INFO",
      label: w.label ?? w.name ?? "",
      value: (w.value ?? w.val ?? w.message ?? ""),
    });
  }
  out.sort((a,b) => a.t - b.t);
  return out;
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
      if (ip) watchMarkers.push({ watch: w, t, ok: false, dt: null, pose: ip, idx: null });
    }
  }
}

// watchMarkersByTime is used for fast "last watch hit" lookup during playback
let watchMarkersByTime = [];

function rebuildWatchMarkersByTime() {
  watchMarkersByTime = watchMarkers.slice().sort((a,b) => (a.t ?? 0) - (b.t ?? 0));
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

function scrollIntoViewIfNeeded(container, el, pad=10) {
  if (!container || !el) return;
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top >= c.top + pad && r.bottom <= c.bottom - pad) return;
  const topDelta = (r.top - (c.top + pad));
  const botDelta = (r.bottom - (c.bottom - pad));
  if (topDelta < 0) container.scrollTop += topDelta;
  else if (botDelta > 0) container.scrollTop += botDelta;
}

function highlightWatchInList(tMs, doScroll) {
  const items = watchList.querySelectorAll(".watchItem");
  items.forEach(el => el.classList.remove("selected"));
  const el = watchList.querySelector(`.watchItem[data-t="${CSS.escape(String(tMs))}"]`);
  if (el) {
    el.classList.add("selected");
    if (doScroll) requestAnimationFrame(() => scrollIntoViewIfNeeded(watchList, el, 12));
  }
}

// --- Watch popup (tiny, click to show, click elsewhere to dismiss) ---
const watchPopup = document.getElementById('watchPopup');
let watchPopupOpen = false;

function hideWatchPopup() {
  if (!watchPopup) return;
  watchPopup.hidden = true;
  watchPopupOpen = false;
}

function fmtPose(p) {
  if (!p) return "—";
  const x = (p.x ?? 0).toFixed(1);
  const y = (p.y ?? 0).toFixed(1);
  const th = (p.theta ?? 0).toFixed(1);
  return `X: ${x}in, Y: ${y}in, θ: ${th}°`;
}

function showWatchPopup(marker, clickPos) {
  if (!watchPopup || !marker) return;

  const w = marker.watch || {};
  const pose = marker.pose || interpolatePoseAtTime(marker.t);
  const poseStr = fmtPose(pose);

  const tStr = (marker.t != null) ? `${marker.t}ms` : "—";
  const watchStr = w.watch || w.name || w.key || "watch";
  const labelStr = w.label || "—";
  const valStr = (w.value == null) ? "—" : String(w.value);

  watchPopup.innerHTML = `
    <div class="row"><div class="k">time</div><div class="v">${escapeHtml(tStr)}</div></div>
    <div class="row"><div class="k">pose</div><div class="v">${escapeHtml(poseStr)}</div></div>
    <div class="row"><div class="k">watch</div><div class="v">${escapeHtml(String(watchStr))}</div></div>
    <div class="row"><div class="k">label</div><div class="v">${escapeHtml(String(labelStr))}</div></div>
    <div class="row"><div class="k">value</div><div class="v">${escapeHtml(valStr)}</div></div>
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
document.addEventListener('mousedown', (e) => {
  if (!watchPopupOpen) return;
  if (watchPopup && watchPopup.contains(e.target)) return;
  hideWatchPopup();
}, { capture: true });


function renderWatchList() {
  watchList.innerHTML = "";
  watchCount.textContent = `${watchMarkers.length}`;

  const mode = watchSort ? watchSort.value : "time";
  const items = watchMarkers.slice();

  const valKey = (v) => {
    if (v == null) return { t: 2, n: 0, s: "" };
    if (typeof v === "boolean") return { t: 0, n: v ? 1 : 0, s: String(v) };
    if (typeof v === "number") return { t: 1, n: v, s: "" };
    return { t: 0, n: 0, s: String(v) };
  };

  items.sort((a,b) => {
    const wa = a.watch || {};
    const wb = b.watch || {};
    if (mode === "level") return String(wa.level||"").localeCompare(String(wb.level||""));
    if (mode === "time") return (a.t ?? 0) - (b.t ?? 0);
    if (mode === "-time") return (b.t ?? 0) - (a.t ?? 0);
    if (mode === "value") {
      const ka = valKey(wa.value);
      const kb = valKey(wb.value);
      if (ka.t !== kb.t) return ka.t - kb.t;
      if (ka.t === 1) return (ka.n - kb.n);
      return ka.s.localeCompare(kb.s);
    }
    return 0;
  });

  for (const m of items) {
    const w = m.watch;
    const st = levelStyle(w.level);
    const label = w.label || "";
    const value = w.value ?? "";
    const t = m.t;

    const div = document.createElement("div");
    div.className = "watchItem";
    div.dataset.t = String(t);

    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="pill level" style="background:${st.fill};color:${st.text}">${escapeHtml(st.name)}</span>
          <span style="font-weight:850;word-break:break-word">${escapeHtml(label)}</span>
        </div>
        <div class="muted">${t != null ? (t + "ms") : ""}</div>
      </div>
      <div class="bigValue">${escapeHtml(String(value))}</div>
    `;

    div.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      selectWatchMarker(m, true, { x: ev.clientX, y: ev.clientY });
    }, { passive:false });
    watchList.appendChild(div);
  }

  if (selectedWatch?.marker?.t != null) highlightWatchInList(selectedWatch.marker.t, false);
}

function selectWatchMarker(marker, fromUserClick=false, clickPos=null) {
  selectedWatch = { marker };

  // clicking a watch should override track lock/hover to avoid confusion
  clearTrackHover(true);
  clearTrackLock();

  const near = nearestIndexWithinTol(marker.t, WATCH_TOL_MS);
  if (near) {
    selectedIndex = near.idx;
    setStatus(`Watch @${marker.t}ms mapped to pose @${rawPoses[near.idx].t}ms (Δ=${near.dt}ms).`);
  } else {
    selectedIndex = findFloorIndexByTime(marker.t);
    setStatus(`Watch @${marker.t}ms shown via interpolation (no pose within ±${WATCH_TOL_MS}ms).`);
  }

  pause();
  hoverTimelineTime = null;
  timelineHoverSaved = null;

  highlightWatchInList(marker.t, fromUserClick);

  if (fromUserClick) {
    showWatchPopup(marker, clickPos);
  } else {
    hideWatchPopup();
  }
  highlightPoseInList();
  updatePoseReadout();
  requestDrawAll();
}

// -------- pose list --------
function renderPoseList() {
  if (!poseList) return;
  poseList.innerHTML = "";
  if (!rawPoses.length) {
    poseCount.textContent = "—";
    return;
  }
  poseCount.textContent = `${rawPoses.length}`;
  const frag = document.createDocumentFragment();
  const maxItems = rawPoses.length; // keep simple
  for (let i=0; i<maxItems; i++) {
    const p = rawPoses[i];
    const t = (typeof p.t === "number") ? Math.round(p.t) : "—";
    const pi = poseToInches(p);
    const poseSummary = `X: ${(pi.x ?? 0).toFixed(1)}in, Y: ${(pi.y ?? 0).toFixed(1)}in, θ: ${(pi.theta ?? 0).toFixed(1)}°`;
    const div = document.createElement('div');
    div.className = 'poseItem';
    div.dataset.idx = String(i);
    div.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px">
      <div style="font-weight:800">#${i+1}</div>
      <div class="muted">${t}ms</div>
    </div>
    <div class="sub">${escapeHtml(poseSummary)}</div>`;
    div.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();

      pause();
      clearTrackHover(true);
      clearTrackLock();
      selectedWatch = null;
      selectedIndex = i;
      setStatus(`Jumped to pose #${i+1}.`);
      highlightPoseInList();
      updatePoseReadout();
      requestDrawAll();
    }, { passive:false });
    frag.appendChild(div);
  }
  poseList.appendChild(frag);
  highlightPoseInList();
}

function highlightPoseInList() {
  if (!poseList) return;
  const els = poseList.querySelectorAll('.poseItem');
  els.forEach(el => el.classList.toggle('selected', Number(el.dataset.idx) === selectedIndex));
  const el = poseList.querySelector(`.poseItem[data-idx="${CSS.escape(String(selectedIndex))}"]`);
  if (el) scrollIntoViewIfNeeded(poseList, el, 12);
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
  const center = worldToScreen(0, 0);
  const wIn = (bounds.maxX - bounds.minX) || 1;
  const hIn = (bounds.maxY - bounds.minY) || 1;
  const wPx = wIn * scale;
  const hPx = hIn * scale;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(fieldRotationRad);
  ctx.globalAlpha = 0.95;
  ctx.drawImage(fieldImg, -wPx / 2, -hPx / 2, wPx, hPx);
  ctx.restore();
  ctx.globalAlpha = 1.0;
}

function drawAxes() {
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const o = worldToScreen(0, 0);
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
    const a = poses[i-1], b = poses[i];
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
    if (!pose) continue;
    const st = levelStyle(watch.level);
    const p = worldToScreen(pose.x, pose.y);

    const isHover = (hoverWatch === m);
    const r = isHover ? 5.6 : 4.2;
    const fillA = isHover ? 0.40 : 0.25;

    ctx.save();
    ctx.fillStyle = st.fill.replace("rgb(", "rgba(").replace(")", `,${fillA})`);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (selectedWatch?.marker?.pose) {
    const st = levelStyle(selectedWatch.marker.watch.level);
    const pose = selectedWatch.marker.pose;
    const p = worldToScreen(pose.x, pose.y);

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9.0, 0, Math.PI*2);
    ctx.stroke();

    ctx.fillStyle = st.fill.replace("rgb(", "rgba(").replace(")", ",0.35)");
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6.5, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

function drawRobot(pose, alpha=1.0) {
  if (!pose) return;
  const { w: wIn, h: hIn } = robotDimsInches();
  const center = worldToScreen(pose.x, pose.y);
  const wPx = wIn * scale;
  const hPx = hIn * scale;
  const thetaDeg = (pose.theta ?? 0) - fieldRotationDeg;
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

    ctx.save();
    ctx.translate(ox * scale, -oy * scale);
    ctx.rotate(r);
    ctx.drawImage(robotImg, -(wPx*s)/2, -(hPx*s)/2, wPx*s, hPx*s);
    ctx.restore();
  } else {
    // default robot: translucent box + outline
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-wPx/2, -hPx/2, wPx, hPx);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.98)";
    ctx.beginPath();
    ctx.moveTo(wPx/2, -hPx/2);
    ctx.lineTo(wPx/2,  hPx/2);
    ctx.stroke();
  }

  // heading arrow (useful even with image)
  const arrowLen = Math.max(wPx, hPx) * 0.85;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(arrowLen/2, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(arrowLen/2, 0);
  ctx.lineTo(arrowLen/2 - 8, -5);
  ctx.lineTo(arrowLen/2 - 8,  5);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();

  ctx.restore();
}

async function loadRobotImageFromPath(path) {
  if (!path || !invoke) return;
  try {
    const dataUrl = await invoke('read_image_data', { path });
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
      img.onerror = () => reject(new Error('failed to load robot image from saved path'));
      img.src = dataUrl;
    });
  } catch (e) {
    console.error('Failed to load robot image from path:', e);
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
  if (!playing && !trackLockActive && trackHover?.pose) return trackHover.pose;
  if (!playing && trackLockActive && trackLockPose) return trackLockPose;
  const poses = getPosesInches();
  return poses[selectedIndex] || null;
}

function draw() {
  drawField();
  drawAxes();
  if (appMode === "viewing") {
    drawPath();
    drawWatchDots();
    if (planOverlayVisible) drawPlanningOverlay(true);
    const p = currentDisplayPose();
    if (p) drawRobot(p, 1.0);
  } else {
    drawPlanningOverlay();
    const pose = planSampleAtDist(planPlayDist);
    if (pose) drawRobot(pose, 1.0);
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
    const dx = mx - timeToX(m.t);
    const dy = my - 10;
    if ((dx*dx + dy*dy) <= r*r) return m;
  }
  return null;
}

function drawTimeline() {
  if (timelineBar.classList.contains('isCollapsed')) return;

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
  for (let i=0; i<=major; i++) {
    const x = (W * i) / major;
    tctx.beginPath(); tctx.moveTo(x, 0); tctx.lineTo(x, H); tctx.stroke();
  }

  // speed trace using norm
  tctx.lineWidth = 2;
  for (let i=1; i<rawPoses.length; i++) {
    const a = rawPoses[i-1], b = rawPoses[i];
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
    const st = levelStyle(m.watch.level);
    const x = timeToX(m.t);
    const y = 10;
    tctx.save();
    tctx.fillStyle = st.fill.replace("rgb(", "rgba(").replace(")", ",0.25)");
    tctx.strokeStyle = "rgba(255,255,255,0.95)";
    tctx.lineWidth = 2;
    tctx.beginPath();
    tctx.arc(x, y, 4.2, 0, Math.PI*2);
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

  if (selectedWatch?.marker?.t != null) {
    const x = timeToX(selectedWatch.marker.t);
    const y = 10;
    tctx.save();
    tctx.strokeStyle = "rgba(255,255,255,0.95)";
    tctx.lineWidth = 2;
    tctx.beginPath();
    tctx.arc(x, y, 9.0, 0, Math.PI*2);
    tctx.stroke();
    tctx.restore();
  }
}

function drawPlanningTimeline() {
  if (!planningTimelineCanvas || !pctx) return;
  if (appMode !== "planning") return;
  const rect = planningTimelineCanvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  pctx.clearRect(0, 0, W, H);
  pctx.fillStyle = "rgba(16,23,32,0.55)";
  pctx.fillRect(0, 0, W, H);

  const total = planTotalLength();
  if (total <= 0) return;

  const y = H / 2;
  pctx.strokeStyle = "rgba(255,255,255,0.12)";
  pctx.lineWidth = 2;
  pctx.beginPath();
  pctx.moveTo(6, y);
  pctx.lineTo(W - 6, y);
  pctx.stroke();

  const progX = 6 + (W - 12) * clamp(planPlayDist / total, 0, 1);
  pctx.strokeStyle = "rgba(120,180,255,0.9)";
  pctx.beginPath();
  pctx.moveTo(6, y);
  pctx.lineTo(progX, y);
  pctx.stroke();

  // markers at waypoints
  let acc = 0;
  pctx.fillStyle = "rgba(180,220,255,0.9)";
  for (let i = 0; i < planWaypoints.length; i++) {
    if (i > 0) {
      const a = planWaypoints[i - 1], b = planWaypoints[i];
      acc += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const x = 6 + (W - 12) * (total ? acc / total : 0);
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
  deltaPill.textContent = `Δ: ${delta.toFixed(2)}s`;    
  }
}

// --- Floating Window Logic ---
const floatWin = document.getElementById('floatingInfo');
const btnToggleFloat = document.getElementById('btnToggleFloat');
const btnCloseFloat = document.getElementById('btnCloseFloat');
const floatHeader = document.getElementById('floatHeader');
const floatResizer = document.getElementById('floatResizer');

// Toggle Visibility
btnToggleFloat.onclick = (e) => {
  e.stopPropagation(); // Prevents event bubbling
  floatWin.classList.toggle('hidden');
};

btnCloseFloat.onclick = (e) => {
  e.stopPropagation();
  floatWin.classList.add('hidden');
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

window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    floatWin.style.left = `${e.clientX - dragStart.x}px`;
    floatWin.style.top = `${e.clientY - dragStart.y}px`;
  }
  
  if (isResizing) {
    // 1. Calculate the intended new size
    let newWidth = e.clientX - floatWin.offsetLeft;
    let newHeight = e.clientY - floatWin.offsetTop;

    // 3. Clamp the values
    newWidth = Math.max(minW, Math.min(newWidth, maxW));
    newHeight = Math.max(minH, Math.min(newHeight, maxH));

    // 4. Apply to the element
    floatWin.style.width = `${newWidth}px`;
    floatWin.style.height = `${newHeight}px`;
  }
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  isResizing = false;
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
  if (floatWin.hidden) {
    document.getElementById('fx').textContent = "—";
    document.getElementById('fy').textContent = "—";
    document.getElementById('ft').textContent = "—";
    document.getElementById('ftime').textContent = "—";
    document.getElementById('favg').textContent = "—";
    document.getElementById('flv').textContent = "—";
    document.getElementById('frv').textContent = "—";
    document.getElementById('fcount').textContent = "Point: —/—";
    return;
  }

  document.getElementById('fx').textContent = fmtNum(pose.x, 2);
  document.getElementById('fy').textContent = fmtNum(pose.y, 2);
  document.getElementById('ft').textContent = fmtNum(pose.theta, 2) + "°";
  document.getElementById('ftime').textContent = fmtNum(pose.t / 1000, 2) + "s";
  
  const l = pose.l_vel || 0;
  const r = pose.r_vel || 0;
  const n = (pose.speed_norm != null) ? pose.speed_norm : 0;
  const disp = speedFromNorm(n);
  const lDisp = speedFromNorm(normFromSpeedRaw(l));
  const rDisp = speedFromNorm(normFromSpeedRaw(r));
  
  document.getElementById('favg').textContent = disp == null ? "—" : fmtNum(disp, 2);
  document.getElementById('flv').textContent = lDisp == null ? "—" : fmtNum(lDisp, 2);
  document.getElementById('frv').textContent = rDisp == null ? "—" : fmtNum(rDisp, 2);
  
  document.getElementById('fcount').textContent = `Point: ${idx + 1}/${rawPoses.length}`;

  // Waypoint info
  const result = findTemporallyClosestWatch(pose.t);
  const waypointTime = document.getElementById('fwatchtime');
  const waypointLabel = document.getElementById('fwatchlabel');
  const waypointValue = document.getElementById('fwatchvalue');
  const clickable = document.getElementById('fwatchclickable');
  const deltaTime = document.getElementById('fdeltat');

  if (result) {
    const { watch, diffMs } = result;
    const direction = (watch.t > pose.t) ? "ahead" : "ago";
    const seconds = (diffMs / 1000).toFixed(1);

    // Display the label and the time offset
    waypointLabel.textContent = ` ${watch.label}`;
    waypointValue.textContent = ` ${watch.value}`;
    waypointTime.textContent = ` ${seconds}s ${direction}`;
    
    // Clicking the readout jumps exactly to that waypoint
    clickable.style.cursor = "pointer";
    clickable.onclick = () => {
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
    deltaTime.textContent = `${delta.toFixed(2)}s`;
  } else {
    waypointLabel.textContent = " —";
    waypointValue.textContent = " —";
    waypointTime.textContent = " —";
    deltaTime.textContent = "—";
    clickable.style.cursor = "default";
    clickable.onclick = null;
  }
}

// -------- pose readout --------
function updatePoseReadout() {
  if (!data || !rawPoses.length) {
    timePill.textContent = "Time: —";
    pointPill.textContent = "Point: —/—";
    posePill.textContent = "X: —  Y: — θ: —  Speed: —";
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

  } else if (!playing && !trackLockActive && trackHover?.pose) {
  // if hover pose has a time, use interpolation (smooth) instead of the raw cached pose (snappy)
  const ht = trackHover.pose.t ?? null;

  if (ht != null) {
    t = ht;
    idx = findFloorIndexByTime(ht);
    p = interpolatePoseAtTime(ht);
  } else {
    // fallback to old behavior if hover time isn't available
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
  timePill.textContent = (t == null) ? "Time: —" : `Time: ${(t / 1000).toFixed(2)}s`;
  pointPill.textContent = `Point: ${Math.max(1, idx+1)}/${total}`;

  const spNorm = (p?.speed_norm != null) ? p.speed_norm : (rawPoses[idx]?.speed_norm ?? null);
  const spDisp = speedFromNorm(spNorm);

  posePill.textContent = p
    ? `X: ${fmtNum(p.x,1)}  Y: ${fmtNum(p.y,1)}  θ: ${fmtNum(p.theta,1)}°  Speed: ${spDisp == null ? "—" : fmtNum(spDisp,2)}`
    : "X: —  Y: —  θ: —  Speed: —";
  updateDeltaReadout();
  updateFloatingInfo(p, idx);  
}

// -------- fit --------
function fitToPoses() {
  const poses = getPosesInches();
  if (!poses.length) return;
  let minX = poses[0].x, maxX = poses[0].x;
  let minY = poses[0].y, maxY = poses[0].y;
  for (const p of poses) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const margin = 6;
  bounds.minX = minX - margin; bounds.maxX = maxX + margin;
  bounds.minY = minY - margin; bounds.maxY = maxY + margin;
  bounds.pad = FIELD_BOUNDS_IN.pad;
  computeTransform();
  requestDrawAll();
}

// -------- view controls (square maximize + pan/zoom) --------
function resetView() {
  viewZoom = 1;
  viewPanXpx = 0;
  viewPanYpx = 0;
}

function updateFieldLayout(preserveBounds=false) {
  const wrap = document.getElementById('canvasWrap');
  const rect = wrap.getBoundingClientRect();
  canvas.style.position = '';
  canvas.style.left = '';
  canvas.style.top = '';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
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
  btnFit.textContent = '⤢';
  btnFit.title = 'Recenter field (square)';
}

function clampZoom(z) {
  return clamp(z, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX);
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // world point under cursor (inches)
  const w0 = screenToWorld(mx, my);

  const delta = (e.deltaY || 0);
  const zoomFactor = Math.exp(-delta * 0.0012);
  const newZoom = clampZoom(viewZoom * zoomFactor);

  viewZoom = newZoom;

  // adjust pan so (w0) stays under cursor
  // mx = w0.x*scale + offsetXpx, with scale/offset based on base*viewZoom and viewPan*
  const newScale = baseScale * viewZoom;
  const newOffXBase = baseOffsetXpx * viewZoom;
  const newOffYBase = baseOffsetYpx * viewZoom;

  // account for field rotation when anchoring zoom to cursor
  const xR = w0.x * fieldRotationCos - w0.y * fieldRotationSin;
  const yR = w0.x * fieldRotationSin + w0.y * fieldRotationCos;
  viewPanXpx = mx - (xR * newScale + newOffXBase);
  viewPanYpx = my - (newOffYBase - yR * newScale);

  computeTransform();
  requestDrawAll();
}, { passive:false });

canvas.addEventListener('pointerdown', (e) => {
  if (appMode === "planning") {
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
    const w = screenToWorld(mx, my);
    if (thetaHit >= 0) {
      planThetaDragging = true;
      planThetaDragIdx = thetaHit;
      planPointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      updatePlanThetaFromPointer(thetaHit, mx, my);
      return;
    }
    if (!isInField(w)) {
      // allow panning when clicking outside the field
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
    if (hit >= 0) {
      if (!planSelectedSet.has(hit)) {
        planSelectSingle(hit);
        planChanged();
      }
    } else {
      planWaypoints.push({ x: clampPlanCoord(w.x), y: clampPlanCoord(w.y), theta: 0 });
      planSelectSingle(planWaypoints.length - 1);
      planChanged();
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

canvas.addEventListener('pointermove', (e) => {
  if (appMode === "planning") {
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
        planWaypoints[p.i].x = clampPlanCoord(nx);
        planWaypoints[p.i].y = clampPlanCoord(ny);
      }
      renderPlanList();
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

  // Only start panning once the user has clearly dragged.
  if (!isPanning) {
    if (Math.abs(dx) + Math.abs(dy) <= 3) return;
    isPanning = true;
    suppressNextClick = true; // prevent 'click' selection after a drag-pan
    canvas.style.cursor = 'grabbing';

    // If a hover-preview was active, clear it so the view feels stable while panning.
    if (!trackLockActive && trackHover) {
      clearTrackHover(true);
      highlightPoseInList();
      updatePoseReadout();
    }
  }

  viewPanXpx = panStart.panX + dx;
  viewPanYpx = panStart.panY + dy;

  computeTransform();
  requestDrawAll();
});

function endPan(e) {
  if (appMode === "planning") {
    if (planThetaDragging && (planPointerId === e.pointerId || planPointerId == null)) {
      planThetaDragging = false;
      planThetaDragIdx = -1;
      try { canvas.releasePointerCapture(planPointerId ?? e.pointerId); } catch {}
      planPointerId = null;
      planChanged();
      return;
    }
    if (planSelecting && (planPointerId === e.pointerId || planPointerId == null)) {
      planSelecting = false;
      planRectSelect();
      planChanged();
      planSelectRect = null;
      try { canvas.releasePointerCapture(planPointerId ?? e.pointerId); } catch {}
      planPointerId = null;
      requestDrawAll();
      return;
    }
    if (planDragging && (planPointerId === e.pointerId || planPointerId == null)) {
      planDragging = false;
      try { canvas.releasePointerCapture(planPointerId ?? e.pointerId); } catch {}
      planPointerId = null;
      planChanged();
      return;
    }
  }
  if (!panArmed) return;
  panArmed = false;
  isPanning = false;
  canvas.style.cursor = '';
  try { canvas.releasePointerCapture(panPointerId ?? e.pointerId); } catch {}
  panPointerId = null;
}

canvas.addEventListener('pointerup', endPan);
canvas.addEventListener('pointercancel', endPan);
canvas.addEventListener('contextmenu', (e) => {
  if (appMode === "planning") e.preventDefault();
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
    const a = poses[i], b = poses[i+1];
    const pa = worldToScreen(a.x, a.y);
    const pb = worldToScreen(b.x, b.y);

    const vx = pb.x - pa.x, vy = pb.y - pa.y;
    const wx = mx - pa.x, wy = my - pa.y;
    const vv = vx*vx + vy*vy || 1;
    let alpha = (wx*vx + wy*vy) / vv;
    alpha = clamp(alpha, 0, 1);

    const px = pa.x + alpha*vx;
    const py = pa.y + alpha*vy;
    const dx = mx - px, dy = my - py;
    const d2 = dx*dx + dy*dy;

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

  // nearest index can stay if you still want it for list highlighting
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
  const tol = 10;
  let best = null;
  let bestD2 = tol*tol;
  for (const m of watchMarkers) {
    if (!m.pose) continue;
    const p = worldToScreen(m.pose.x, m.pose.y);
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx*dx + dy*dy;
    if (d2 <= bestD2) { bestD2 = d2; best = m; }
  }
  return best;
}

// -------- playback --------
let playPose = null;

function pause() {
  playing = false;
  btnPlay.textContent = "▶";
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  playPose = null;
  lastWall = null;
  setStatus(`Paused at time ${((rawPoses[selectedIndex]?.t ?? 0)/1000).toFixed(2)}s`);
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
  if (window.__live && window.__live.streaming) { setStatus('Playback disabled while livestreaming.'); return; }

  // starting playback clears track lock to avoid confusing states
  clearTrackHover(true);
  clearTrackLock();
  selectedWatch = null;
  timelineHoverSaved = null;
  setStatus(`Playing from time ${((rawPoses[selectedIndex]?.t ?? 0)/1000).toFixed(2)}s`);

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

    const tMin = rawPoses[0]?.t ?? 0;
    const tMax = rawPoses[rawPoses.length - 1]?.t ?? tMin;

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

    // Auto-open Watches and highlight the most recent watch hit
    const last = lastWatchAtTime(playTimeMs);
    if (last && (!selectedWatch || selectedWatch.marker?.t !== last.t)) {
      selectedWatch = { marker: last };
      // open Watches panel during playback
      if (secWatches) secWatches.open = true;
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
  planPlaying = true;
  btnPlay.textContent = "⏸";
  planLastWall = performance.now();
  const tick = (now) => {
    if (!planPlaying) return;
    const dtWall = (now - planLastWall) / 1000;
    planLastWall = now;
    const total = planTotalLength();
    const planSpeed = getPlanSpeedUnitsPerSec();
    planPlayDist += dtWall * planSpeed * playRate;
    if (planPlayDist >= total) {
      planPlayDist = total;
      planPause();
    } else {
      planRaf = requestAnimationFrame(tick);
    }
    setPlanDist(planPlayDist);
  };
  planRaf = requestAnimationFrame(tick);
}

// -------- timeline interactions --------
function timelineMousePos(e) {
  const rect = timelineCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
  if (selectedWatch == null) {
    setStatus(`Unlocked track lock.`);
  }
  selectedWatch = null;


  const t = xToTime(x);
  selectedIndex = findFloorIndexByTime(t);
  lastPoseIndex = selectedWatch;
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
    if (appMode !== "planning") return;
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
    try { planningTimelineCanvas.releasePointerCapture(e.pointerId); } catch {}
  });
  planningTimelineCanvas.addEventListener("pointercancel", () => {
    planScrubbing = false;
  });
}

// -------- field interactions --------
canvas.addEventListener('mousemove', (e) => {
  if (appMode === "planning") return;
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

  // if locked, ignore hover preview
  if (trackLockActive) return;

  const hit = pickTrackPose(e.clientX, e.clientY);

  if (!hit) {
    // no field hit => remove timeline hover preview too
    hoverTimelineTime = null;

    if (trackHover) {
      clearTrackHover(true);
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

canvas.addEventListener('mouseleave', () => {
  if (appMode === "planning") return;
  hoverWatch = null;
  // ensure timeline hover preview can't 'stick'
  hoverTimelineTime = null;
  timelineHoverSaved = null;
  canvas.style.cursor = "";
  if (!trackLockActive && trackHover) {
    clearTrackHover(true);
    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
  }
});

canvas.addEventListener('click', (e) => {
  if (appMode === "planning") return;
  if (!data || playing) return;
  if (window.__live && window.__live.streaming) return;
  if (suppressNextClick) { suppressNextClick = false; return; }

  const hw = hitTestWatchAtClient(e.clientX, e.clientY);
  if (hw) {
    selectWatchMarker(hw, true, { x: e.clientX, y: e.clientY });
    return;
  }

  const hit = pickTrackPose(e.clientX, e.clientY);
  if (hit) {
    // lock to clicked position
    pause();
    selectedWatch = null;

    trackLockActive = true;
    trackLockPose = hit.pose;
    trackLockIndex = hit.nearestIdx;

    selectedIndex = hit.nearestIdx;
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

    setStatus(`Locked to track near pose #${selectedIndex+1}. (Click off-track to unlock)`);
    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
    return;
  }

  // click off-track unlocks
  if (trackLockActive) {
    clearTrackLock();
    setStatus(`Unlocked track lock.`);
    updatePoseReadout();
    requestDrawAll();
  }
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

const liveWinEl = document.getElementById('liveWin');
const btnLeftStopEl = document.getElementById('btnLeftStop');
const btnLeftConnectEl = document.getElementById('btnLeftConnect');
const btnLeftRefreshEl = document.getElementById('btnLeftRefresh');
const leftRefreshIntervalEl = document.getElementById('leftRefreshInterval');

let leftWs = null;
let leftConnected = false;
let leftStreaming = false;
let leftActionInFlight = false;
let leftActionLastAt = 0;
const LEFT_ACTION_COOLDOWN_MS = 400;

// In livestream mode, optionally keep the robot snapped to the newest pose when not hovering the timeline.
// Toggled with Space (while connected).
let liveAutoFollowHead = true;

let leftRefreshTimer = null;
let leftRefreshMs = parseInt(leftRefreshIntervalEl?.value || "500", 10) || 500;

// --- Live incremental processing ---
// Buffer incoming WS lines; doLeftRefresh consumes them and updates poses/watches.
let livePendingLines = [];
let livePendingConsumed = 0; // index into livePendingLines
let liveAppendQueue = [];
let liveAppendScheduled = false;

// Track how much we've already integrated into rawPoses/watches
let liveLastPoseT = null; // last pose timestamp integrated
let liveLastPoseCount = 0;
let liveLastWatchCount = 0;

function parseLiveLineIntoState(line) {
  const s = stripToTag(line);
  if (!s) return { posesAdded: 0, watchesAdded: 0 };

  // DATA: [DATA],millis,x,y,theta,l_vel,r_vel
  if (s.startsWith("[DATA],")) {
    const parts = s.split(",");
    if (parts.length < 7) return { posesAdded: 0, watchesAdded: 0 };
    const t = toNumMaybe(parts[1]);
    const x = toNumMaybe(parts[2]);
    const y = toNumMaybe(parts[3]);
    const theta = toNumMaybe(parts[4]);
    const l_vel = toNumMaybe(parts[5]);
    const r_vel = toNumMaybe(parts[6]);
    if (t == null || x == null || y == null) return { posesAdded: 0, watchesAdded: 0 };

    // De-dup / monotonic guard (common if stream repeats)
    if (liveLastPoseT != null && t <= liveLastPoseT) return { posesAdded: 0, watchesAdded: 0 };

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
    liveLastPoseT = t;
    return { posesAdded: 1, watchesAdded: 0 };
  }

  // WATCH: [WATCH],millis,level,label,value (value may contain commas)
  if (s.startsWith("[WATCH],")) {
    const parts = s.split(",");
    if (parts.length < 5) return { posesAdded: 0, watchesAdded: 0 };
    const t = toNumMaybe(parts[1]);
    if (t == null) return { posesAdded: 0, watchesAdded: 0 };
    const level = parts[2] ?? "INFO";
    let label = parts[3] ?? "";
    label = label.replaceAll(":", ""); 
    const value = parts.slice(4).join(",");
    watches.push({ t, level, label, value });
    return { posesAdded: 0, watchesAdded: 1 };
  }

  return { posesAdded: 0, watchesAdded: 0 };
}

function flushLiveAppend() {
  liveAppendScheduled = false;
  if (!liveWinEl || liveAppendQueue.length === 0) return;

  const nearBottom =
    (liveWinEl.scrollTop + liveWinEl.clientHeight >= liveWinEl.scrollHeight - 12);

  liveWinEl.value += liveAppendQueue.join("");
  liveAppendQueue = [];

  // keep it responsive (basic cap)
  const MAX_CHARS = 100_000;
  if (liveWinEl.value.length > MAX_CHARS) {
    liveWinEl.value = liveWinEl.value.slice(liveWinEl.value.length - MAX_CHARS);
  }
  // keep last ~2000 lines for perf
  const MAX_LINES = 2000;
  const lines = liveWinEl.value.split("\n");
  if (lines.length > MAX_LINES) {
    liveWinEl.value = lines.slice(lines.length - MAX_LINES).join("\n");
  }

  // only autoscroll if user was already at bottom
  if (nearBottom) liveWinEl.scrollTop = liveWinEl.scrollHeight;
}

function liveAppendLine(s) {
  if (!liveWinEl) return;
  const trimmed = (s.endsWith("\n") || s.endsWith("\r\n")) ? s : (s + "\n");
  liveAppendQueue.push(trimmed);
  if (!liveAppendScheduled) {
    liveAppendScheduled = true;
    requestAnimationFrame(flushLiveAppend);
  }
}

function stripToTag(line) {
  // Accept library-prefixed lines like: "[28.08] [INFO]: [DATA],..."
  const iData = line.indexOf('[DATA]');
  const iWatch = line.indexOf('[WATCH]');
  let i = -1;
  if (iData >= 0 && iWatch >= 0) i = Math.min(iData, iWatch);
  else i = (iData >= 0) ? iData : iWatch;

  if (i < 0) return "";
  return line.slice(i).trim();
}

function setLeftUi() {
  if (btnLeftConnect) {
    btnLeftConnect.classList.toggle('isOn', leftConnected);
    btnLeftConnect.textContent = leftConnected ? "Disconnect" : "Connect";
    btnPlay.disabled = leftConnected;
    btnFile.disabled = leftConnected;
    updateConnectButtonState();
  }

  if (btnLeftStop) {
    btnLeftStop.disabled = !leftConnected || leftActionInFlight;
    if (!leftConnected) {
      btnLeftStop.title = "Starts streaming. Connect to start.";
      btnLeftStop.textContent = "Start";
      btnLeftStop.classList.remove('isOn');
    } else {
      btnLeftStop.title = leftStreaming
        ? "Stop streaming. Cmd/Ctrl+Click to force kill."
        : "Starts streaming.";
      btnLeftStop.textContent = leftStreaming ? "Stop" : "Start";
      btnLeftStop.classList.toggle('isOn', leftStreaming);
    }
  }
}

function leftSetUI(reason) {
  setLeftUi();
  if (window.__live) { window.__live.connected = !!leftConnected; window.__live.streaming = !!leftStreaming; }
  // Connect button state
  if (btnLeftConnectEl) {
    btnLeftConnectEl.classList.toggle('isOn', !!leftConnected);
    btnLeftConnectEl.title = leftConnected ? "Disconnect" : "Connect";
    btnLeftConnectEl.disabled = leftActionInFlight || btnLeftConnectEl.disabled;
  }

  // Start/Stop toggle state (this is btnLeftStop)
  if (btnLeftStopEl) {
    btnLeftStopEl.textContent = leftStreaming ? "Stop" : "Start";
    btnLeftStopEl.disabled = !leftConnected || leftActionInFlight;
    btnLeftStopEl.title = leftConnected
      ? (leftStreaming ? "Stop streaming" : "Starts streaming.")
      : "Starts streaming. Connect to start.";
  }

  // Refresh controls only meaningful while connected
  if (btnLeftRefreshEl) btnLeftRefreshEl.disabled = !leftConnected || leftActionInFlight;
  if (leftRefreshIntervalEl) leftRefreshIntervalEl.disabled = !leftConnected || leftActionInFlight;

  if (reason) {
    liveAppendLine(`[UI] ${reason}`);
  }
}

function canRunLeftAction() {
  const now = Date.now();
  if (leftActionInFlight) return false;
  if (now - leftActionLastAt < LEFT_ACTION_COOLDOWN_MS) return false;
  leftActionLastAt = now;
  return true;
}

async function apiPost(path) {
  if (!path) return;
  if (path === "/no HTTP/1.1" || path === "/ HTTP/1.1") return;

  // ensure leading slash
  const p = path.startsWith("/") ? path : `/${path}`;
  const origin = refreshBridgeOrigin();
  if (!origin) {
    return { ok: false, status: 0, json: { status: "bridge origin not ready" } };
  }
  const url = `${origin}${p}`;

  try {
    const res = await fetch(url, { method: "POST" });
    // Best-effort JSON; don't crash UI if server returns non-JSON or 404
    let json = null;
    try { json = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { status: e?.message || "request failed" } };
  }
}

async function connectLeft() {
  if (prosDirInput && prosDirInput.value && prosDirInput.value.trim()) {
    await updateProsDir(prosDirInput.value);
  }
  if (!prosDirValid) {
    liveAppendLine('[UI] Cannot connect: PROS project directory is not set or invalid. Set it in Settings → PROS Directory. Try restarting the application.');
    setStatus('Cannot connect: set a valid PROS directory in Settings first.');
    return;
  }
  refreshBridgeOrigin();
  if (ORIGIN == null || WS_ORIGIN == null) {
    setLeftUi("Child process Bridge.py was not given a port. Live streaming cannot start.");
    return;
  }
  pause();
  stopStreaming(false, false);
  if (leftWs) return;
  leftWs = new WebSocket(`${WS_ORIGIN}/ws`);

  leftWs.addEventListener("open", () => {
    leftConnected = true;
    leftSetUI("Connected");

    startLeftRefresh();
  });

  leftWs.addEventListener("message", (ev) => {
    const raw = (typeof ev.data === "string") ? ev.data : "";
    const trimmed = stripToTag(raw);
    if (trimmed) {
      livePendingLines.push(trimmed);
      // cap pending buffer to avoid unbounded growth
      const MAX_PENDING = 20000;
      if (livePendingLines.length > MAX_PENDING) {
        const drop = livePendingLines.length - MAX_PENDING;
        livePendingLines.splice(0, drop);
        livePendingConsumed = Math.max(0, livePendingConsumed - drop);
      }
    }
    let rawStr = raw;
    if (trimmed) { rawStr = "🟢 " + raw}
    else { rawStr = "🔴 " + raw }
    liveAppendLine(rawStr); // Show raw
  });

  leftWs.addEventListener("close", () => {
    leftWs = null;
    leftConnected = false;
    leftStreaming = false;
    if (window.__live) { window.__live.connected = false; window.__live.streaming = false; }
    stopLeftRefresh();
  });

  leftWs.addEventListener("error", () => {
    // Errors often precede close; keep it gentle.
    liveAppendLine("[WS] error");
  });

  leftSetUI("Connecting…");
}

function disconnectLeft() {
  if (leftWs) {
    try { leftWs.close(); } catch (e) {}
  }
  leftWs = null;
  leftConnected = false;
  leftStreaming = false;
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
  leftRefreshTimer = setInterval(() => {
    doLeftRefresh();
  }, leftRefreshMs);
}

let lastPoseIndex = 0;
async function doLeftRefresh() {
  // During live mode, refresh means: integrate any pending WS lines into
  // rawPoses/watches, then update derived state and redraw.
  if (!leftConnected) return;
  if (!leftStreaming) return; // "Stop" pauses drawing; we still buffer lines

  if (!data) {
    data = { poses: [], watches: [], meta: {} };
  }

  const startIdx = livePendingConsumed;
  const endIdx = livePendingLines.length;
  if (startIdx >= endIdx) {
    // Nothing new; still ensure we snap to latest if appropriate
    if (liveAutoFollowHead && rawPoses.length && hoverTimelineTime == null && !playing && !trackLockActive && !(trackHover && (trackHover.pose || trackHover.t))) {
      selectedIndex = rawPoses.length - 1;
      lastPoseIndex = selectedIndex;
      updatePoseReadout();
      requestDrawAll();
    } else if (!liveAutoFollowHead && rawPoses.length && hoverTimelineTime == null && !playing && !trackLockActive && !(trackHover && (trackHover.pose || trackHover.t))) {
      selectedIndex = lastPoseIndex;
    }
    return;
  }

  let posesAdded = 0;
  let watchesAdded = 0;

  for (let i = startIdx; i < endIdx; i++) {
    const r = parseLiveLineIntoState(livePendingLines[i]);
    posesAdded += r.posesAdded;
    watchesAdded += r.watchesAdded;
  }
  livePendingConsumed = endIdx;

  if (posesAdded === 0 && watchesAdded === 0) return;

  // Keep watches sorted (poses are appended monotonically by t)
  if (watchesAdded > 0) {
    watches.sort((a,b) => (a.t ?? 0) - (b.t ?? 0));
  }

  // Recompute derived fields. This is cheap at your scale (<~4000 poses).
  computeSpeedNorm();

  if (watchesAdded > 0) {
    recomputeWatchMarkers();
    rebuildWatchMarkersByTime();
    renderWatchList();
  }

  if (posesAdded > 0) {
    renderPoseList();
    // If not hovering timeline/track, keep the robot on the most recent pose.
    if (liveAutoFollowHead && hoverTimelineTime == null && !playing && !trackLockActive && !(trackHover && (trackHover.pose || trackHover.t))) {
      selectedIndex = rawPoses.length - 1;
    } else if (!liveAutoFollowHead && rawPoses.length && hoverTimelineTime == null && !playing && !trackLockActive && !(trackHover && (trackHover.pose || trackHover.t))) {
      selectedIndex = lastPoseIndex;
    }
  }

  updatePoseReadout();
  requestDrawAll();
  scheduleSavedPathsSave();
}


async function startStreaming() {
  const r = await apiPost("/api/start");
  if (!r.ok) {
    liveAppendLine(`[api] start failed (${r.status})`);
    liveAppendLine("Try restarting the application.");
    return false;
  }
  leftStreaming = true;
  leftSetUI("Streaming started");
  return true;
}

async function stopStreaming(forceKill = false, doMsg = true) {
  const path = forceKill ? "/api/kill" : "/api/stop";
  const r = await apiPost(path);
  if (!r.ok) {
    liveAppendLine(`[api] stop/kill failed (${r.status})`);
    // Even if kill endpoint doesn't exist, still fall back to /api/stop
    if (forceKill && r.status === 404) {
      const r2 = await apiPost("/api/stop");
      if (!r2.ok) return false;
    } else {
      return false;
    }
  }
  leftStreaming = false;
  if (doMsg)
    leftSetUI(forceKill ? "Force-killed" : "Streaming stopped");
  return true;
}

// Connect toggle
btnLeftConnectEl?.addEventListener('click', async () => {
  if (!canRunLeftAction()) return;
  leftActionInFlight = true;
  setLeftUi();
  try {
    if (leftConnected) disconnectLeft();
    else await connectLeft();
  } finally {
    leftActionInFlight = false;
    setLeftUi();
  }
});

// Start/Stop toggle (+ cmd/ctrl click => force kill)
btnLeftStopEl?.addEventListener('click', async (e) => {
  if (!leftConnected) return;
  if (!canRunLeftAction()) return;
  leftActionInFlight = true;
  setLeftUi();

  try {
    const forceKill = !!(e?.metaKey || e?.ctrlKey);
    if (forceKill) {
      await stopStreaming(true);
      return;
    }

    if (!leftStreaming) await startStreaming();
    else await stopStreaming(false);
    btnLeftConnectEl.title = leftConnected ? "Disconnect" : "Connect";
  } finally {
    leftActionInFlight = false;
    setLeftUi();
  }
});

// Manual refresh button
btnLeftRefreshEl?.addEventListener('click', () => {
  doLeftRefresh();
});

leftRefreshIntervalEl?.addEventListener('change', () => {
  leftRefreshMs = parseInt(leftRefreshIntervalEl.value || "0", 10) || 0;
  startLeftRefresh();
});

// Initialize UI on load
leftSetUI("");


// -------- splitters with collapse --------
(function setupSplitters() {
  let draggingV = false;
  let startX = 0;
  let startW = 0;

  let lastRightSidebarW = 360;
  let lastLeftSidebarW = 360;
  // ensure grid state matches persisted widths on load
  try {
    if (getLeftSidebarW() <= 1) { leftEl.classList.add('isCollapsed'); rowGrid && rowGrid.classList.add('leftCollapsed'); }
  } catch (e) {}


  const getRightSidebarW = () => {
    const v = getComputedStyle(root).getPropertyValue('--rightSidebarW').trim();
    const n = parseFloat(v);
    return isFinite(n) ? n : 360;
  };
  const setRightSidebarW = (px) => {
    px = Math.min(px, MAX_SIDEBAR_W_PX);
    root.style.setProperty('--rightSidebarW', `${px}px`);

  }

  const getLeftSidebarW = () => {
    const v = getComputedStyle(root).getPropertyValue('--leftSidebarW').trim();
    const n = parseFloat(v);
    return isFinite(n) ? n : 360;
  };
  const setLeftSidebarW = (px) => {
    px = Math.min(px, MAX_PX_LIVEWIN);
    root.style.setProperty('--leftSidebarW', `${px}px`);
  };

  let draggingVL = false;
  let startXL = 0;
  let startWL = 0;

  vSplitL.addEventListener('mousedown', (e) => {
    draggingVL = true;
    startXL = e.clientX;
    startWL = getLeftSidebarW();
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  vSplit.addEventListener('mousedown', (e) => {
    draggingV = true;
    startX = e.clientX;
    startW = getRightSidebarW();
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  let draggingH = false;
  let startY = 0;
  let startH = 0;
  let lastTimelineH = 260;

  const getTimelineH = () => {
    const v = getComputedStyle(root).getPropertyValue('--timelineH').trim();
    const n = parseFloat(v);
    return isFinite(n) ? n : 260;
  };
  const setTimelineH = (px) => {
    px = Math.min(px, MAX_TIMELINE_H_PX);
    root.style.setProperty('--timelineH', `${px}px`);
  }

  hSplit.addEventListener('mousedown', (e) => {
    draggingH = true;
    startY = e.clientY;
    startH = getTimelineH();
    document.body.style.cursor = 'row-resize';
    e.preventDefault();

  });

  window.addEventListener('mousemove', (e) => {
    if (draggingVL) {
      const dx = e.clientX - startXL;
      const w = window.innerWidth;
      let next = clamp(startWL + dx, 0, Math.max(0, w - 240));

      if (next <= COLLAPSE_PX_LEFTSIDEBAR) {
        next = 0;
        leftEl.classList.add('isCollapsed');
        rowGrid && rowGrid.classList.add('leftCollapsed');
      } else {
        leftEl.classList.remove('isCollapsed');
        rowGrid && rowGrid.classList.remove('leftCollapsed');
        lastLeftSidebarW = next;
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
        rightEl.classList.add('isCollapsed');
      } else {
        rightEl.classList.remove('isCollapsed');
        lastRightSidebarW = next;
      }
      setRightSidebarW(next);
      resizeCanvas();
      resizeTimeline();
    }

    if (draggingH) {
      const dy = e.clientY - startY;
      const h = window.innerHeight;
      let next = clamp(startH - dy, 0, Math.max(0, Math.floor(h * 0.80)));

      if (next <= COLLAPSE_PX_TIMELINE) {
        next = 0;
        timelineBar.classList.add('isCollapsed');
      } else {
        timelineBar.classList.remove('isCollapsed');
        lastTimelineH = next;
      }

      setTimelineH(next);
      resizeTimeline();
      resizeCanvas();
    }
  });

  window.addEventListener('mouseup', () => {
    if (draggingV || draggingH || draggingVL) {
      draggingV = false;
      draggingH = false;
      draggingVL = false;
      document.body.style.cursor = '';
      // If user re-expands from collapsed by dragging, restore visibility automatically
      if (getRightSidebarW() > COLLAPSE_PX_SIDEBAR) rightEl.classList.remove('isCollapsed');
      if (getTimelineH() > COLLAPSE_PX_TIMELINE) timelineBar.classList.remove('isCollapsed');
      resizeCanvas();
      resizeTimeline();
    }
  });

  // double-click splitters to toggle collapse/restore
  vSplitL.addEventListener('dblclick', () => {
    if (!DBLCLICK_COLLAPSE_LEFTSIDEBAR) return;
    const cur = getLeftSidebarW();
    if (cur <= COLLAPSE_PX_LEFTSIDEBAR) {
      setLeftSidebarW(Math.max(1, lastLeftSidebarW));
      leftEl.classList.remove('isCollapsed');
      rowGrid && rowGrid.classList.remove('leftCollapsed');
    } else {
      lastLeftSidebarW = cur;
      setLeftSidebarW(0);
      leftEl.classList.add('isCollapsed');
      rowGrid && rowGrid.classList.add('leftCollapsed');
    }
    resizeCanvas();
    resizeTimeline();
  });

  vSplit.addEventListener('dblclick', () => {
    const cur = getRightSidebarW();
    if (cur <= COLLAPSE_PX_SIDEBAR) {
      setRightSidebarW(Math.max(1, lastRightSidebarW));
      rightEl.classList.remove('isCollapsed');
    } else {
      lastRightSidebarW = cur;
      setRightSidebarW(0);
      rightEl.classList.add('isCollapsed');
    }
      resetFieldPosition();
      resizeCanvas();
      layoutTimelineCanvas();
  });

  hSplit.addEventListener('dblclick', () => {
    const cur = getTimelineH();
    let next = getTimelineH();
    if (cur <= COLLAPSE_PX_TIMELINE) {
      setTimelineH(Math.max(160, lastTimelineH));
      timelineBar.classList.remove('isCollapsed');
    } else {
      lastTimelineH = cur;
      setTimelineH(0);
      timelineBar.classList.add('isCollapsed');
    }
      next = Math.min(1, next);
      setTimelineH(next);
      resetFieldPosition();
      drawField();
      resizeTimeline();
      resizeCanvas();
      layoutTimelineCanvas();
  });
})();

// -------- data load --------
function setData(obj) {
  data = obj;
  if (!obj || !Array.isArray(obj.poses)) {
    setStatus("Invalid viewer JSON: missing poses[]");
    return;
  }

  rawPoses = obj.poses
    .filter(p => p && typeof p.x === "number" && typeof p.y === "number")
    .map(p => ({
      t: (typeof p.t === "number") ? p.t : (toNumMaybe(p.t) ?? null),
      x: p.x, y: p.y,
      theta: (typeof p.theta === "number") ? p.theta : (toNumMaybe(p.theta) ?? 0),
      l_vel: (typeof p.l_vel === "number") ? p.l_vel : (toNumMaybe(p.l_vel) ?? null),
      r_vel: (typeof p.r_vel === "number") ? p.r_vel : (toNumMaybe(p.r_vel) ?? null),
      speed_raw: (typeof p.speed === "number") ? p.speed : (toNumMaybe(p.speed) ?? 0),
      speed_norm: 0,
    }))
    .sort((a,b) => (a.t ?? 0) - (b.t ?? 0));

  // watches: accept alternate key just in case
  watches = normalizeWatches(obj.watches || obj.watch || obj.events || []);

  const currentUnits = settingsUnitsSelect?.value || unitsSelect?.value || 'in';
  setUnitsFactorFromSelect(currentUnits);
  updateOffsetsFromInputs();

  computeSpeedNorm();
  scheduleSavedPathsSave();

  // Sync to settings modal and save
  syncMainToSettings();
  saveSettings();

  selectedWatch = null;
  selectedIndex = 0;
  hoverTimelineTime = null;
  timelineHoverSaved = null;
  hoverWatch = null;

  clearTrackHover(true);
  clearTrackLock();
  pause();

  recomputeWatchMarkers();
  rebuildWatchMarkersByTime();
  renderWatchList();
  renderPoseList();

  bounds = { ...FIELD_BOUNDS_IN };
  computeTransform();

  setStatus(`Loaded ${rawPoses.length} poses, ${watches.length} watches.`);
  if (btnPlay) btnPlay.disabled = rawPoses.length < 2;
  if (btnFit) btnFit.disabled = false;
  if (fieldSelect) fieldSelect.disabled = false;

  updatePoseReadout();
  requestDrawAll();
}

async function handleFile(file) {
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    setData(obj);
  } catch (e) {
    console.error(e);
    setStatus(`Failed to load: ${e?.message || e}`);
  }
}

// -------- controls wiring --------
btnFile.addEventListener('click', () => fileEl.click());
fileEl.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleFile(file);
});


// Help modal
function openHelp() {
  if (!helpModal) {
    console.warn('helpModal not found');
    return;
  }
  helpModal.removeAttribute('hidden');
  helpModal.style.display = 'flex';
}
function closeHelp() {
  if (!helpModal) return;
  helpModal.setAttribute('hidden', '');
  helpModal.style.display = 'none';
}
if (btnHelp) {
  btnHelp.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openHelp();
  });
} else {
  console.warn('btnHelp not found');
}
if (btnHelpClose) {
  btnHelpClose.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeHelp();
  });
} else {
  console.warn('btnHelpClose not found');
}
if (helpModal) {
  helpModal.addEventListener('click', (e) => {
    if (e.target && (e.target.classList.contains('modalBackdrop'))) {
      closeHelp();
    }
  });
} else {
  console.warn('helpModal not found');
}

// Settings modal and JSON persistence
async function loadSettings() {
  try {
    let settings = null;
    if (invoke) {
      const saved = await invoke('read_settings');
      if (saved) {
        settings = JSON.parse(saved);
      } else {
        // Create defaults on first run so the app data dir/file exists.
        await saveSettings();
      }
    } else {
      console.warn('Settings persistence is unavailable (Tauri invoke missing).');
    }

    if (settings) {
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
      if (settings.planSpeed !== undefined && settingsPlanSpeed) {
        settingsPlanSpeed.value = settings.planSpeed;
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
          const savedPath = await invoke('save_robot_image', { dataUrl: robotImageDataUrl });
          if (savedPath) {
            robotImagePath = savedPath;
            await saveSettings();
          }
        } catch (e) {
          console.warn('Failed to persist robot image to app data:', e);
        }
      }
      updateOffsetsFromInputs();
      computeSpeedNorm();
      if (robotImageToggle) robotImageToggle.checked = robotImageEnabled;
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

async function saveSettings() {
  try {
    const settings = {
      prosDir: prosDirInput ? prosDirInput.value : '',
      robotImageEnabled,
      units: settingsUnitsSelect ? settingsUnitsSelect.value : (unitsSelect ? unitsSelect.value : 'in'),
      robotW: robotWEl ? robotWEl.value : '12',
      robotH: robotHEl ? robotHEl.value : '12',
      offX: offXEl ? offXEl.value : '0',
      offY: offYEl ? offYEl.value : '0',
      offTheta: offThetaEl ? offThetaEl.value : '0',
      minSpeed: minSpeedEl ? minSpeedEl.value : '0',
      maxSpeed: maxSpeedEl ? maxSpeedEl.value : '127',
      planMoveStep: settingsPlanMoveStep ? settingsPlanMoveStep.value : '0.5',
      planSnapStep: settingsPlanSnapStep ? settingsPlanSnapStep.value : '0',
      planSpeed: settingsPlanSpeed ? settingsPlanSpeed.value : '50',
      robotImgScale: robotImgTx.scale,
      robotImgOffX: robotImgTx.offXIn,
      robotImgOffY: robotImgTx.offYIn,
      robotImgRot: robotImgTx.rotDeg,
      robotImage: {
        path: robotImagePath || null,
        dataUrl: robotImagePath ? null : (robotImageDataUrl || null),
      },
      fieldRotation: fieldRotationDeg,
    };
    const payload = JSON.stringify(settings);
    if (invoke) {
      await invoke('write_settings', { contents: payload });
    } else {
      console.warn('Settings persistence is unavailable (Tauri invoke missing).');
    }
  } catch (e) {
    console.error('Failed to save settings:', e);
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
    computeSpeedNorm();
    recomputeWatchMarkers();
    rebuildWatchMarkersByTime();
    requestDrawAll();
    updatePoseReadout();
  }
  if (settingsMaxSpeed && maxSpeedEl && settingsMaxSpeed.value !== maxSpeedEl.value) {
    maxSpeedEl.value = settingsMaxSpeed.value;
    computeSpeedNorm();
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
}

function openSettings() {
  if (!settingsModal) {
    console.error('Settings modal not found');
    return;
  }
  try {
    syncMainToSettings(); // Load current values into settings modal
  } catch (e) {
    console.error('Error syncing settings:', e);
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
  settingsModal.removeAttribute('hidden');
  settingsModal.style.display = 'flex'; // Ensure flex display
  // Focus the modal card for accessibility
  requestAnimationFrame(() => {
    const modalCard = settingsModal.querySelector('.modalCard');
    if (modalCard) {
      modalCard.focus();
    }
  });
}

function closeSettings() {
  if (!settingsModal) return;
  try {
    syncSettingsToMain(); // Save settings modal values to main inputs
  } catch (e) {
    console.error('Error syncing settings:', e);
  }
  settingsModal.setAttribute('hidden', '');
  settingsModal.style.display = 'none'; // Force hide
}

// Settings modal event handlers - ensure they're set up
if (btnSettings) {
  btnSettings.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSettings();
  });
} else {
  console.warn('btnSettings element not found');
}

if (btnSettingsClose) {
  btnSettingsClose.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSettings();
  });
} else {
  console.warn('btnSettingsClose element not found');
}

if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (e.target && (e.target.classList.contains('modalBackdrop'))) {
      closeSettings();
    }
  });
} else {
  console.warn('settingsModal element not found');
}

if (modeViewingBtn) {
  modeViewingBtn.addEventListener('click', () => setMode('viewing'));
}
if (modePlanningBtn) {
  modePlanningBtn.addEventListener('click', () => setMode('planning'));
}

// Global Escape handler: close modals and prevent window-level behavior
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const helpOpen = helpModal && helpModal.style.display !== 'none' && !helpModal.hasAttribute('hidden');
  const settingsOpen = settingsModal && settingsModal.style.display !== 'none' && !settingsModal.hasAttribute('hidden');
  if (helpOpen) closeHelp();
  else if (settingsOpen) closeSettings();
  e.preventDefault();
  e.stopPropagation();
}, true);

// Settings inputs event handlers
if (settingsUnitsSelect) {
  settingsUnitsSelect.addEventListener('change', () => {
    syncSettingsToMain();
  });
}
if (settingsFieldRotation) {
  settingsFieldRotation.addEventListener('change', () => {
    setFieldRotationDeg(Number(settingsFieldRotation.value) || 0);
    saveSettings();
  });
}
if (settingsRobotW) {
  settingsRobotW.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsRobotH) {
  settingsRobotH.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsOffX) {
  settingsOffX.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsOffY) {
  settingsOffY.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsOffTheta) {
  settingsOffTheta.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsMinSpeed) {
  settingsMinSpeed.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsMaxSpeed) {
  settingsMaxSpeed.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsPlanMoveStep) {
  settingsPlanMoveStep.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsPlanSnapStep) {
  settingsPlanSnapStep.addEventListener('change', () => {
    syncSettingsToMain();
  });
}
if (settingsPlanSpeed) {
  settingsPlanSpeed.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsRobotImgScale) {
  settingsRobotImgScale.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsRobotImgOffX) {
  settingsRobotImgOffX.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsRobotImgOffY) {
  settingsRobotImgOffY.addEventListener('input', () => {
    syncSettingsToMain();
  });
}
if (settingsRobotImgRot) {
  settingsRobotImgRot.addEventListener('input', () => {
    syncSettingsToMain();
  });
}

function setProsDirStatus(message, kind = 'info') {
  if (!prosDirStatusEl) return;
  prosDirStatusEl.textContent = message;
  if (kind === 'error') {
    prosDirStatusEl.style.color = '#ff9b9b';
  } else if (kind === 'ok') {
    prosDirStatusEl.style.color = '#9fddb0';
  } else {
    prosDirStatusEl.style.color = 'var(--muted)';
  }
}

function setAutoStatus(message, kind = 'info') {
  if (!prosDirAutoStatusEl) return;
  prosDirAutoStatusEl.textContent = message;
  if (kind === 'error') {
    prosDirAutoStatusEl.style.color = '#ff9b9b';
  } else if (kind === 'ok') {
    prosDirAutoStatusEl.style.color = '#9fddb0';
  } else {
    prosDirAutoStatusEl.style.color = 'var(--muted)';
  }
}

function renderAutoResults(candidates) {
  if (!prosDirAutoResultsEl) return;
  prosDirAutoResultsEl.innerHTML = '';
  if (!candidates || !candidates.length) {
    prosDirAutoResultsEl.textContent = '';
    prosDirAutoResultsEl.style.color = 'var(--muted)';
    return;
  }
  for (const dir of candidates) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.marginBottom = '6px';

    const pathEl = document.createElement('div');
    pathEl.textContent = dir;
    pathEl.style.flex = '1';
    pathEl.style.fontFamily = 'monospace';
    pathEl.style.fontSize = '12px';

    const useBtn = document.createElement('button');
    useBtn.className = 'iconBtn';
    useBtn.style.fontSize = '11px';
    useBtn.textContent = 'Use';
    useBtn.addEventListener('click', () => {
      if (!prosDirInput) return;
      prosDirInput.value = dir;
      prosDirFromSettings = true;
      updateProsDir(dir);
      saveSettings();
      renderAutoResults([]);
      setAutoStatus('Applied.', 'ok');
    });

    row.appendChild(pathEl);
    row.appendChild(useBtn);
    prosDirAutoResultsEl.appendChild(row);
  }
}

// PROS directory input
async function updateProsDir(dir) {
  const trimmed = (dir || '').trim();
  if (!trimmed) {
    prosDirValid = false;
    setProsDirStatus('PROS directory not set. Live viewing disabled.', 'error');
    saveSettings();
    updateConnectButtonState();
    return;
  }

  if (trimmed === "None" /*None is default state */) {
    return;
  }
  try {
    const origin = refreshBridgeOrigin();
    if (!origin) {
      prosDirValid = false;
      setProsDirStatus('Bridge not ready yet. Retrying...', 'error');
      updateConnectButtonState();
      if (prosDirRetryTimer) clearTimeout(prosDirRetryTimer);
      if (prosDirRetryAttempts < 5) {
        prosDirRetryAttempts += 1;
        prosDirRetryTimer = setTimeout(() => updateProsDir(trimmed), 500);
      } else {
        setProsDirStatus('Bridge not ready yet. Try again in a moment.', 'error');
      }
      return;
    }
    prosDirRetryAttempts = 0;
    const response = await fetch(`${origin}/api/pros-dir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: trimmed })
    });
    const result = await response.json();
    if (result.ok) {
      prosDirValid = true;
      setStatus(`PROS directory set to: ${result.dir}`);
      setProsDirStatus(`Using PROS project: ${result.dir}`, 'ok');
      saveSettings();
      updateConnectButtonState();
    } else {
      prosDirValid = false;
      setStatus(`Failed to set PROS directory: ${result.status}`);
      setProsDirStatus(`Invalid PROS directory: ${result.status}`, 'error');
      updateConnectButtonState();
    }
  } catch (e) {
    prosDirValid = false;
    console.error('Error updating PROS directory:', e);
    setStatus(`Error updating PROS directory: ${e.message || e}`);
    setProsDirStatus(`Error validating PROS directory: ${e.message || e}`, 'error');
    updateConnectButtonState();
  }
}

if (prosDirInput) {
  let prosDirTimeout = null;
  prosDirInput.addEventListener('input', () => {
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
  btnProsDirAuto.addEventListener('click', async () => {
    if (!refreshBridgeOrigin()) {
      setAutoStatus('Backend not ready.', 'error');
      return;
    }
    setAutoStatus('Scanning…');
    try {
      const response = await fetch(`${ORIGIN}/api/pros-dir/auto`);
      const result = await response.json();
      if (!result.ok) {
        setAutoStatus(result.status || 'Auto-detect failed.', 'error');
        renderAutoResults([]);
        return;
      }
      renderAutoResults(result.candidates || []);
      setAutoStatus(`Found ${result.candidates?.length || 0} project(s).`, 'ok');
    } catch (e) {
      console.error('Auto-detect failed:', e);
      setAutoStatus('Auto-detect failed.', 'error');
      renderAutoResults([]);
    }
  });
}

// Load PROS directory from API on startup
async function loadProsDirFromAPI() {
  if (!refreshBridgeOrigin()) return;
  try {
    const response = await fetch(`${ORIGIN}/api/pros-dir`);
    const result = await response.json();
    if (result.ok && result.dir && prosDirInput) {
      const hasUserDir = prosDirFromSettings || (prosDirInput.value && prosDirInput.value.trim());
      if (hasUserDir) return;
      prosDirInput.value = result.dir;
      prosDirValid = true;
      setProsDirStatus(`Using PROS project: ${result.dir}`, 'ok');
      saveSettings();
      if (btnLeftConnect) btnLeftConnect.disabled = false;
    } else {
      prosDirValid = false;
    }
  } catch (e) {
    prosDirValid = false;
    console.error('Error loading PROS directory from API:', e);
  }
}

// Check PROS dir and enable/disable connect button
function updateConnectButtonState() {
  if (!btnLeftConnect) return;
  const hasProsDir = prosDirInput && prosDirInput.value && prosDirInput.value.trim();
  // Connect button should be enabled if PROS dir is set OR if we're already connected
  btnLeftConnect.disabled = (!hasProsDir && !leftConnected) || leftActionInFlight;
}

// Robot image upload
if (btnUploadRobotImage) {
  btnUploadRobotImage.addEventListener('click', () => {
    robotImageFile.click();
  });
}

if (robotImageFile) {
  robotImageFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    robotImagePath = typeof file.path === 'string' && file.path ? file.path : null;
    
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
            const savedPath = await invoke('save_robot_image', { dataUrl: event.target.result });
            if (savedPath) robotImagePath = savedPath;
          }
        } catch (saveErr) {
          console.warn('Failed to persist robot image to app data:', saveErr);
        }
        saveSettings();
      };
      reader.onerror = () => {
        setStatus("Failed to read robot image file.");
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Error loading robot image:', err);
      setStatus("Error loading robot image.");
    }
  });
}

// Robot image toggle
if (robotImageToggle) {
  robotImageToggle.addEventListener('change', (e) => {
    robotImageEnabled = e.target.checked;
    if (settingsRobotImgControls) {
      settingsRobotImgControls.hidden = !(robotImageEnabled && robotImgOk);
    }
    requestDrawAll();
    saveSettings();
  });
}

document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

btnPlay.addEventListener('click', () => {
  if (appMode === "planning") {
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
  btnTogglePlanOverlay.addEventListener('click', () => {
    planOverlayVisible = !planOverlayVisible;
    btnTogglePlanOverlay.classList.toggle('isOn', planOverlayVisible);
    requestDrawAll();
  });
  btnTogglePlanOverlay.classList.toggle('isOn', planOverlayVisible);
}

speedSelect.addEventListener('change', () => {
  playRate = Number(speedSelect.value) || 1;
});

btnFit.addEventListener('click', () => resetFieldPosition());
if (fieldSelect) {
  fieldSelect.addEventListener('change', (e) => loadFieldImage(e.target.value));
}

if (unitsSelect) {
  unitsSelect.addEventListener('change', (e) => {
    if (e.target.value !== currentUnits) {
      setUnitsFactorFromSelect(e.target.value);
      updateOffsetsFromInputs();
    }
    syncMainToSettings();
    saveSettings();
  });
}

robotWEl.addEventListener('input', () => {
  requestDrawAll();
  syncMainToSettings();
  saveSettings();
});

robotHEl.addEventListener('input', () => {
  requestDrawAll();
  syncMainToSettings();
  saveSettings();
});

function syncRobotImgTxFromInputs() {
  const scaleEl = robotImgScaleEl || settingsRobotImgScale;
  const offXEl = robotImgOffXEl || settingsRobotImgOffX;
  const offYEl = robotImgOffYEl || settingsRobotImgOffY;
  const rotEl = robotImgRotEl || settingsRobotImgRot;

  robotImgTx.scale = clamp(Number(scaleEl?.value || 1), 0.05, 20);
  robotImgTx.offXIn = Number(offXEl?.value || 0);
  robotImgTx.offYIn = Number(offYEl?.value || 0);
  robotImgTx.rotDeg = Number(rotEl?.value || 0);
}

const onRobotImgInput = () => {
  syncRobotImgTxFromInputs();
  requestDrawAll();
  syncMainToSettings();
  saveSettings();
};

if (robotImgScaleEl) robotImgScaleEl.addEventListener('input', onRobotImgInput);
if (robotImgOffXEl) robotImgOffXEl.addEventListener('input', onRobotImgInput);
if (robotImgOffYEl) robotImgOffYEl.addEventListener('input', onRobotImgInput);
if (robotImgRotEl) robotImgRotEl.addEventListener('input', onRobotImgInput);
if (settingsRobotImgScale) settingsRobotImgScale.addEventListener('input', onRobotImgInput);
if (settingsRobotImgOffX) settingsRobotImgOffX.addEventListener('input', onRobotImgInput);
if (settingsRobotImgOffY) settingsRobotImgOffY.addEventListener('input', onRobotImgInput);
if (settingsRobotImgRot) settingsRobotImgRot.addEventListener('input', onRobotImgInput);


settingsMinSpeed.addEventListener('input', () => {
  computeSpeedNorm();
  recomputeWatchMarkers();
  rebuildWatchMarkersByTime();
  requestDrawAll();
  updatePoseReadout();
  syncMainToSettings();
  saveSettings();
});

settingsMaxSpeed.addEventListener('input', () => {
  computeSpeedNorm();
  recomputeWatchMarkers();
  rebuildWatchMarkersByTime();
  requestDrawAll();
  updatePoseReadout();
  syncMainToSettings();
  saveSettings();
});

if (settingsPlanMoveStep) {
  settingsPlanMoveStep.addEventListener('input', () => {
    saveSettings();
  });
}
if (settingsPlanSnapStep) {
  settingsPlanSnapStep.addEventListener('change', () => {
    saveSettings();
  });
}
if (settingsPlanSpeed) {
  settingsPlanSpeed.addEventListener('input', () => {
    saveSettings();
  });
}

function bindPlanField(el, getter, setter) {
  if (!el) return;
  el.addEventListener('focus', () => {
    // capture last known good value before edits
    el.dataset.lastValid = el.dataset.lastValid ?? String(getter());
  });
  el.addEventListener('input', () => {
    if (planSelected < 0 || planSelected >= planWaypoints.length) return;
    if (el.value.trim() === "") return; // allow clearing while typing
    const v = Number(el.value);
    if (!isFinite(v)) return;
    setter(v);
    planChanged({ skipSelectionPanel: true });
    requestDrawAll();
  });
  el.addEventListener('blur', () => {
    if (planSelected < 0 || planSelected >= planWaypoints.length) return;
    const v = Number(el.value);
    if (!isFinite(v) || el.value.trim() === "") {
      const last = el.dataset.lastValid ?? String(getter());
      el.value = last;
      return;
    }
    // normalize display on blur
    el.value = String(getter());
    el.dataset.lastValid = el.value;
  });
}

function clampDigits(el, maxDigits) {
  const s = el.value;
  const parts = s.split(".");
  const intPart = parts[0].replace(/[^0-9-]/g, "");
  const fracPart = parts[1] ? parts[1].replace(/[^0-9]/g, "") : "";
  const trimmedInt = intPart.replace(/(?!^)-/g, "").slice(0, maxDigits + (intPart.startsWith("-") ? 1 : 0));
  el.value = fracPart.length ? `${trimmedInt}.${fracPart}` : trimmedInt;
}

bindPlanField(
  planSelXEl,
  () => fmtNum(planWaypoints[planSelected]?.x ?? 0, 2),
  (v) => { planWaypoints[planSelected].x = clampPlanCoord(v); }
);
bindPlanField(
  planSelYEl,
  () => fmtNum(planWaypoints[planSelected]?.y ?? 0, 2),
  (v) => { planWaypoints[planSelected].y = clampPlanCoord(v); }
);
bindPlanField(
  planSelThetaEl,
  () => fmtNum(planWaypoints[planSelected]?.theta ?? 0, 1),
  (v) => { planWaypoints[planSelected].theta = normalizeDeg(v); }
);

if (planSelXEl) {
  planSelXEl.addEventListener('input', () => clampDigits(planSelXEl, 2));
}
if (planSelYEl) {
  planSelYEl.addEventListener('input', () => clampDigits(planSelYEl, 2));
}
if (planSelThetaEl) {
  planSelThetaEl.addEventListener('input', () => clampDigits(planSelThetaEl, 3));
  planSelThetaEl.addEventListener('blur', () => {
    if (planSelected < 0 || planSelected >= planWaypoints.length) return;
    const v = Number(planSelThetaEl.value);
    if (isFinite(v)) {
      planWaypoints[planSelected].theta = normalizeDeg(v);
      updatePlanSelectionPanel();
      requestDrawAll();
    }
  });
}

offXEl.addEventListener('input', () => {
  updateOffsetsFromInputs();
  syncMainToSettings();
  saveSettings();
});
offYEl.addEventListener('input', () => {
  updateOffsetsFromInputs();
  syncMainToSettings();
  saveSettings();
});
offThetaEl.addEventListener('input', () => {
  updateOffsetsFromInputs();
  syncMainToSettings();
  saveSettings();
});

if (watchSort) watchSort.addEventListener('change', () => { renderWatchList(); requestDrawAll(); });

const btnLeftClear = document.getElementById('btnClearField');

function clearAllPosesAndWatches() {
  // Stop playback/hover/locks so UI doesn’t reference stale indices
  try { playing = false; } catch {}
  try { hoverTimelineTime = null; } catch {}
  try { trackHover = null; } catch {}
  try { trackLockActive = false; } catch {}
  try { trackLockPose = null; } catch {}
  try { trackLockIndex = null; } catch {}

  // Clear core data
  rawPoses = [];
  watches = [];

  // Clear any derived / UI lists if you have them
  try { watchMarkers = []; } catch {}
  try { watchByLabel = {}; } catch {}
  try { lastPoseIndex = 0; } catch {}
  try { livePendingLines = []; livePendingConsumed = 0; } catch {}

  // Keep `data` consistent if you use it elsewhere
  if (typeof data === "object" && data) {
    data.poses = [];
    data.watches = [];
  }

  // Reset selection + redraw
  selectedIndex = 0;

  // If you have helper functions, call them; guard so no crashes
  try { renderPoseList?.(); } catch {}
  try { renderWatchList?.(); } catch {}
  try { updatePoseReadout?.(); } catch {}
  try { updateFloatingInfo?.(null, 0); } catch {}
  try { requestDrawAll?.(); } catch {}

  setStatus("Cleared Field and Plannd Path")
}

btnLeftClear?.addEventListener('click', () => {
  clearAllPosesAndWatches();
  liveWinEl.value = "";
});

btnClearField?.addEventListener('click', () => {
  if (appMode === "planning") {
    planWaypoints = [];
    planSetSelection([]);
    planPlayDist = 0;
    planPause();
    planChanged();
    requestDrawAll();
  } else {
    clearAllPosesAndWatches();
    liveWinEl.value = "";
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
    if (e.key === '1') {
      e.preventDefault();
      setMode('viewing');
      return;
    }
    if (e.key === '2') {
      e.preventDefault();
      setMode('planning');
      return;
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    // Clear everything across modes
    clearAllPosesAndWatches();
    liveWinEl.value = "";
    planWaypoints = [];
    planSetSelection([]);
    planPlayDist = 0;
    planPause();
    planChanged();
    requestDrawAll();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'o' || e.key === 'O')) {
    if (appMode !== "viewing") return;
    e.preventDefault();
    fileEl?.click();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (appMode === "planning") {
      planWaypoints = [];
      planSetSelection([]);
      planPlayDist = 0;
      planPause();
      planChanged();
      requestDrawAll();
      setStatus("Cleared Planned Path");
    } else {
      clearAllPosesAndWatches();
      liveWinEl.value = "";
      setStatus("Cleared Field");
    }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    return;
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (appMode === "viewing") {
        if (leftConnected) {
          if (!leftStreaming) void startStreaming();
          else void stopStreaming(false);
        }
      } else {
        if (planPlaying) planPause();
        else planPlay();
      }
      return;
    }
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      if (appMode === "viewing" && btnTogglePlanOverlay) {
        btnTogglePlanOverlay.click();
      }
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      if (appMode === "viewing") {
        if (leftConnected) disconnectLeft();
        else void connectLeft();
      }
      return;
    }
  }
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    resetFieldPosition();
    return;
  }
  if (appMode === "planning") {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    const isTyping = (tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable));
    if (isTyping) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (planPlaying) planPause();
      else planPlay();
      requestDrawAll();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && planSelectedSet.size) {
      e.preventDefault();
      const toRemove = Array.from(planSelectedSet).sort((a,b) => b - a);
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
      if (e.key === "ArrowLeft" && e.shiftKey) dx = -step * 5
      else if (e.key === "ArrowLeft") dx = -step;

      if (e.key === "ArrowRight" && e.shiftKey) dx = step * 5
      else if (e.key === "ArrowRight") dx = step;

      if (e.key === "ArrowUp" && e.shiftKey) dy = step * 5
      else if (e.key === "ArrowUp") dy = step;

      if (e.key === "ArrowDown" && e.shiftKey) dy = -step * 5
      else if (e.key === "ArrowDown") dy = -step;
      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        // Adjust movement for field rotation so arrows follow screen directions.
        const c = fieldRotationCos;
        const s = fieldRotationSin;
        const rdx = dx * c + dy * s;
        const rdy = -dx * s + dy * c;
        for (const idx of planSelectedSet) {
          if (idx >= 0 && idx < planWaypoints.length) {
            planWaypoints[idx].x = clampPlanCoord(planWaypoints[idx].x + rdx);
            planWaypoints[idx].y = clampPlanCoord(planWaypoints[idx].y + rdy);
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
  // Don't steal keys while typing in inputs/textareas (except the read-only live window).
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  const isTyping = (tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable));
  if (isTyping && e.target !== liveWinEl) return;

  // Space toggles "auto-follow head" while connected in livestream mode.
  if (e.code === "Space" && leftConnected) {
    e.preventDefault();
    if (liveAutoFollowHead) {
      // about to turn it OFF => freeze at current index
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
    selectedIndex = Math.max(0, selectedIndex-1);
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
    selectedIndex = Math.min(rawPoses.length-1, selectedIndex+1);
    highlightPoseInList();
    updatePoseReadout();
    requestDrawAll();
  }
});

// -------- init --------
loadFieldOptions();
void loadSettings(); // Load saved settings
void loadSavedPaths();
setMode("viewing");
// Ensure modals start hidden
if (helpModal) {
  helpModal.setAttribute('hidden', '');
  helpModal.style.display = 'none';
}
if (settingsModal) {
  settingsModal.setAttribute('hidden', '');
  settingsModal.style.display = 'none';
}
// Load PROS dir from backend after a short delay to ensure ORIGIN is set
setTimeout(() => {
  try {
    loadProsDirFromAPI();
    updateConnectButtonState();
  } catch (e) {
    console.error('Error loading PROS dir:', e);
  }
}, 500);
const bridgeReadyPoll = setInterval(() => {
  if (refreshBridgeOrigin()) {
    clearInterval(bridgeReadyPoll);
    loadProsDirFromAPI();
  }
}, 250);
window.addEventListener('resize', () => {
  updateFieldLayout(true); // keep bounds, recompute square sizing
  resizeTimeline();
  resizePlanningTimeline();
});

updateFieldLayout(false);
resizeTimeline();
resizePlanningTimeline();
if (robotImgControlsEl) robotImgControlsEl.hidden = true;
if (settingsRobotImgControls) settingsRobotImgControls.hidden = true;
syncRobotImgTxFromInputs();
loadRobotImage();
drawFirstField();
