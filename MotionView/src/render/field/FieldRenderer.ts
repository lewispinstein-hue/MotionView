import { getMode } from "../../app/modeController";
import { setStatus } from "../../app/status";
import { isTauriRuntime, readImageData, resolveResourcePath, saveRobotImage } from "../../tauri/commands";
import { requestDrawAll } from "../renderScheduler";
import { FieldRendererEvents } from "./FieldRendererEvents";
import { getFieldBounds } from "./fieldImages";
import { configureFieldTransform } from "./fieldTransform";
import { FieldSizeScaler } from "./FieldSizeScaler";
import type { FieldBounds, FieldPose, PlanningFieldLayer, RobotDimensions, RobotImageTransform, ScreenPoint, ViewingFieldLayer } from "./fieldTypes";

export const FIELD_BOUNDS_IN: FieldBounds = { minX: -72, maxX: 72, minY: -72, maxY: 72, pad: 30 };
export const CANVAS_ZOOM_MAX = 15;
export const CANVAS_ZOOM_MIN = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeFieldRotation(deg: number): 0 | 90 | 180 | 270 {
  const norm = ((deg % 360) + 360) % 360;
  if (norm === 90 || norm === 180 || norm === 270) return norm;
  return 0;
}

export class FieldRenderer {
  readonly events = new FieldRendererEvents();
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly sizes: FieldSizeScaler;
  #robotDimensions: RobotDimensions = { w: 12, h: 12 };

  declare registerViewingLayer: (layer: ViewingFieldLayer) => void;
  declare registerPlanningLayer: (layer: PlanningFieldLayer) => void;
  declare draw: () => void;
  declare resizeCanvas: () => void;
  declare updateFieldLayout: (preserveBounds?: boolean) => void;
  declare resetFieldPosition: () => void;
  declare centerOnWorld: (x: number, y: number) => void;
  declare worldToScreen: (xIn: number, yIn: number) => ScreenPoint;
  declare screenToWorld: (xPx: number, yPx: number) => ScreenPoint;
  declare getScale: () => number;
  declare getViewZoom: () => number;
  declare getFieldRotationDeg: () => number;
  declare getBounds: () => Readonly<FieldBounds>;
  declare hasFieldImage: () => boolean;
  declare setFieldRotationDeg: (deg: number) => void;
  declare loadFieldImage: (fieldKey: string) => Promise<void>;
  declare loadRobotImage: () => void;
  declare loadRobotImageFromPath: (path: string | null) => Promise<void>;
  declare loadRobotImageFromDataUrl: (dataUrl: string | null) => void;
  declare loadRobotImageFromFile: (file: File) => Promise<void>;
  declare setRobotImageEnabled: (enabled: boolean) => void;
  declare isRobotImageEnabled: () => boolean;
  declare isRobotImageReady: () => boolean;
  declare getRobotImagePath: () => string | null;
  declare setRobotImagePath: (path: string | null) => void;
  declare getRobotImageDataUrl: () => string | null;
  declare setRobotImageDataUrl: (dataUrl: string | null) => void;
  declare getRobotImageTransform: () => Readonly<RobotImageTransform>;
  declare setRobotImageTransform: (transform: Partial<RobotImageTransform>) => void;
  declare handleWheel: (event: WheelEvent) => void;
  declare beginPan: (pointerId: number, canvasX: number, canvasY: number) => void;
  declare movePan: (canvasX: number, canvasY: number, options?: { onStart?: () => void }) => boolean;
  declare endPan: (pointerId?: number | null) => boolean;
  declare isPanning: () => boolean;
  declare getSuppressNextClick: () => boolean;
  declare consumeSuppressNextClick: () => void;
  declare setBounds: (bounds: FieldBounds) => void;

  constructor(canvas: HTMLCanvasElement) {
  this.canvas = canvas;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("MotionView requires a 2D field canvas context.");
  const ctx: CanvasRenderingContext2D = context;
  this.ctx = ctx;
  let bounds = { ...FIELD_BOUNDS_IN };
  let fieldBounds = { ...FIELD_BOUNDS_IN };
  let scale = 1;
  let offsetXpx = 0;
  let offsetYpx = 0;
  let fieldImg: HTMLImageElement | null = null;
  let robotImg: HTMLImageElement | null = null;
  let robotImgOk = false;
  let robotImgLoadTried = false;
  let robotImageEnabled = true;
  let robotImagePath: string | null = null;
  let robotImageDataUrl: string | null = null;
  const robotImgTx: RobotImageTransform = { scale: 1, offXIn: 0, offYIn: 0, rotDeg: 0, alpha: 1 };
  let fieldRotationDeg = 0;
  let fieldRotationRad = 0;
  let viewZoom = 1;
  let viewPanXpx = 0;
  let viewPanYpx = 0;
  let baseScale = 1;
  let baseOffsetXpx = 0;
  let baseOffsetYpx = 0;
  let isPanActive = false;
  let panArmed = false;
  let panPointerId: number | null = null;
  let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
  let suppressNextClick = false;
  let viewingLayer: ViewingFieldLayer | null = null;
  let planningLayer: PlanningFieldLayer | null = null;
  const sizes = this.sizes = new FieldSizeScaler({
    getScale: () => scale,
    getViewZoom: () => viewZoom,
  });

  function computeTransform() {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const pad = bounds.pad;
    const worldW = (bounds.maxX - bounds.minX) || 1;
    const worldH = (bounds.maxY - bounds.minY) || 1;

    const quarterTurn = fieldRotationDeg === 90 || fieldRotationDeg === 270;
    const fitW = quarterTurn ? worldH : worldW;
    const fitH = quarterTurn ? worldW : worldH;
    baseScale = Math.min(
      Math.max(1, w - pad * 2) / fitW,
      Math.max(1, h - pad * 2) / fitH,
    );

    const centerWorldX = (bounds.minX + bounds.maxX) * 0.5;
    const centerWorldY = (bounds.minY + bounds.maxY) * 0.5;
    baseOffsetXpx = w / 2 - centerWorldX * baseScale;
    baseOffsetYpx = h / 2 + centerWorldY * baseScale;

    scale = baseScale * viewZoom;
    offsetXpx = baseOffsetXpx * viewZoom + viewPanXpx;
    offsetYpx = baseOffsetYpx * viewZoom + viewPanYpx;
  }

  function canvasViewportRect() {
    const rect = canvas.getBoundingClientRect();
    return { x: 0, y: 0, width: rect.width || 1, height: rect.height || 1 };
  }

  function canvasViewportCenter() {
    const rect = canvasViewportRect();
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }

  function rotateScreenPoint(x: number, y: number, angleRad: number) {
    if (!angleRad) return { x, y };
    const center = canvasViewportCenter();
    const dx = x - center.x;
    const dy = y - center.y;
    return {
      x: center.x + dx * Math.cos(angleRad) - dy * Math.sin(angleRad),
      y: center.y + dx * Math.sin(angleRad) + dy * Math.cos(angleRad),
    };
  }

  function rotateScreenDelta(dx: number, dy: number, angleRad: number) {
    if (!angleRad) return { x: dx, y: dy };
    return {
      x: dx * Math.cos(angleRad) - dy * Math.sin(angleRad),
      y: dx * Math.sin(angleRad) + dy * Math.cos(angleRad),
    };
  }

  function worldToScreenBase(xIn: number, yIn: number): ScreenPoint {
    return { x: offsetXpx + xIn * scale, y: offsetYpx - yIn * scale };
  }

  function worldToScreen(xIn: number, yIn: number): ScreenPoint {
    const base = worldToScreenBase(xIn, yIn);
    return rotateScreenPoint(base.x, base.y, fieldRotationRad);
  }

  function screenToWorld(xPx: number, yPx: number): ScreenPoint {
    const base = rotateScreenPoint(xPx, yPx, -fieldRotationRad);
    return {
      x: (base.x - offsetXpx) / (scale || 1),
      y: (offsetYpx - base.y) / (scale || 1),
    };
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
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    }
    let dx = 0;
    let dy = 0;
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
    ctx.beginPath();
    ctx.moveTo(ax0.x, ax0.y);
    ctx.lineTo(ax1.x, ax1.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ay0.x, ay0.y);
    ctx.lineTo(ay1.x, ay1.y);
    ctx.stroke();
  }

  function drawRobot(pose: FieldPose | null, alpha = 1.0) {
    if (!pose) return;
    const { w: wIn, h: hIn } = self.#robotDimensions;
    const center = worldToScreen(pose.x, pose.y);
    const wPx = wIn * scale;
    const hPx = hIn * scale;
    const thetaDeg = (pose.theta ?? 0) + fieldRotationDeg - 90;
    const thetaRad = thetaDeg * Math.PI / 180;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(center.x, center.y);
    ctx.rotate(thetaRad);

    const robotImage = robotImg;
    const hasImg = robotImageEnabled && robotImgOk && robotImage && robotImage.naturalWidth > 0 && robotImage.naturalHeight > 0;

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
      ctx.drawImage(robotImage, -(wPx * s) / 2, -(hPx * s) / 2, wPx * s, hPx * s);
      ctx.restore();
    } else {
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

    const arrowSize = sizes.world({
      width: wIn * 0.36,
      height: Math.min(wIn, hIn) * 0.28,
    });
    const arrowHeadLength = arrowSize.height * 0.8;
    const arrowHeadHalfWidth = arrowSize.height / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = Math.min(wPx, hPx) * 0.04;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(arrowSize.width, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(arrowSize.width, 0);
    ctx.lineTo(arrowSize.width - arrowHeadLength, -arrowHeadHalfWidth);
    ctx.lineTo(arrowSize.width - arrowHeadLength, arrowHeadHalfWidth);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();

    ctx.restore();
  }

  function draw() {
    drawField();
    drawAxes();
    if (getMode() === "viewing") {
      viewingLayer?.drawPath();
      viewingLayer?.drawOverlay();
      if (planningLayer?.overlayVisible) planningLayer.drawOverlay(true);
      const pose = viewingLayer?.currentPose() ?? null;
      if (pose) viewingLayer?.drawWaypointOffset(pose);
      if (pose) drawRobot(pose, 1.0);
    } else {
      planningLayer?.drawOverlay();
      const pose = planningLayer?.currentPose() ?? null;
      if (pose) drawRobot(pose, 1.0);
    }
  }

  async function resolveFieldImageSrc(fieldKey: string) {
    if (!isTauriRuntime()) return fieldKey;
    const normalized = String(fieldKey || "").replace(/^\.\//, "");
    const candidates = [
      `_up_/src/${normalized}`,
      `src/${normalized}`,
      normalized,
    ];
    for (const candidate of candidates) {
      try {
        const resolved = await resolveResourcePath(candidate);
        if (resolved) return resolved;
      } catch {
        // Try the next packaged location.
      }
    }
    return fieldKey;
  }

  function loadRobotImageFromDataUrl(dataUrl: string | null) {
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      robotImg = img;
      robotImgOk = true;
      robotImgLoadTried = true;
      self.events.robotImageAvailabilityChanged.emit({ available: true });
      requestDrawAll();
    };
    img.onerror = () => {
      setStatus("Failed to load saved robot image.");
      robotImg = null;
      robotImgOk = false;
      self.events.robotImageAvailabilityChanged.emit({ available: false });
    };
    img.src = dataUrl;
  }

  const self = this;
  const renderer = Object.assign(this, {
    canvas,
    ctx,
    sizes,
    registerViewingLayer(layer: ViewingFieldLayer) {
      viewingLayer = layer;
    },
    registerPlanningLayer(layer: PlanningFieldLayer) {
      planningLayer = layer;
    },
    draw,
    resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      computeTransform();
      clampViewPanToVisibleMargin();
      draw();
    },
    updateFieldLayout(preserveBounds = false) {
      canvas.style.position = "";
      canvas.style.left = "";
      canvas.style.top = "";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      if (!preserveBounds) bounds = { ...fieldBounds };
      renderer.resizeCanvas();
      computeTransform();
      requestDrawAll();
    },
    resetFieldPosition() {
      viewZoom = 1;
      viewPanXpx = 0;
      viewPanYpx = 0;
      renderer.updateFieldLayout(false);
    },
    centerOnWorld(x: number, y: number) {
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const sp = worldToScreen(x, y);
      viewPanXpx += cx - sp.x;
      viewPanYpx += cy - sp.y;
      computeTransform();
    },
    worldToScreen,
    screenToWorld,
    getScale() {
      return scale;
    },
    getViewZoom() {
      return viewZoom;
    },
    getFieldRotationDeg() {
      return fieldRotationDeg;
    },
    getBounds() {
      return bounds;
    },
    hasFieldImage() {
      return !!fieldImg;
    },
    setFieldRotationDeg(deg: number) {
      fieldRotationDeg = normalizeFieldRotation(deg);
      fieldRotationRad = fieldRotationDeg * Math.PI / 180;
      computeTransform();
      requestDrawAll();
    },
    async loadFieldImage(fieldKey: string) {
      if (!fieldKey) {
        fieldImg = null;
        draw();
        setStatus("No field image is available for the selected competition.");
        return;
      }
      let imgSrc = fieldKey;
      if (isTauriRuntime()) {
        try {
          const resolvedPath = await resolveFieldImageSrc(fieldKey);
          if (resolvedPath && resolvedPath !== fieldKey && !resolvedPath.startsWith("asset:") && !resolvedPath.startsWith("http")) {
            imgSrc = await readImageData(resolvedPath);
          } else {
            imgSrc = resolvedPath;
          }
        } catch {
          imgSrc = fieldKey;
        }
      }
      const img = new Image();
      img.onload = () => {
        fieldImg = img;
        const configuredBounds = getFieldBounds(fieldKey);
        fieldBounds = configuredBounds
          ? { ...configuredBounds, pad: FIELD_BOUNDS_IN.pad }
          : { ...FIELD_BOUNDS_IN };
        bounds = { ...fieldBounds };
        renderer.resizeCanvas();
        requestDrawAll();
        self.events.fieldImageLoaded.emit({ fieldKey });
      };
      img.onerror = () => {
        fieldImg = null;
        draw();
        setStatus(`Could not load field image: ${fieldKey}`);
      };
      img.src = imgSrc;
    },
    loadRobotImage() {
      if (robotImgLoadTried) return;
      robotImgLoadTried = true;
      const img = new Image();
      img.onload = () => {
        robotImg = img;
        robotImgOk = true;
        self.events.robotImageAvailabilityChanged.emit({ available: true });
        draw();
      };
      img.onerror = () => {
        robotImg = null;
        robotImgOk = false;
        self.events.robotImageAvailabilityChanged.emit({ available: false });
        draw();
      };
    },
    async loadRobotImageFromPath(path: string | null) {
      if (!path) return;
      try {
        const dataUrl = await readImageData(path);
        robotImageDataUrl = dataUrl;
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            robotImg = img;
            robotImgOk = true;
            robotImgLoadTried = true;
            self.events.robotImageAvailabilityChanged.emit({ available: true });
            requestDrawAll();
            resolve();
          };
          img.onerror = () => reject(new Error("failed to load robot image from saved path"));
          img.src = dataUrl;
        });
      } catch (error) {
        console.error("Failed to load robot image from path:", error);
        setStatus(`Failed to load robot image from path: ${error instanceof Error ? error.message : error}`);
      }
    },
    loadRobotImageFromDataUrl,
    async loadRobotImageFromFile(file: File) {
      if (!file.type.startsWith("image/")) {
        alert("Please select an image file");
        return;
      }
      robotImagePath = typeof (file as File & { path?: string }).path === "string" && (file as File & { path?: string }).path
        ? (file as File & { path?: string }).path ?? null
        : null;
      await new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const dataUrl = typeof event.target?.result === "string" ? event.target.result : "";
          const img = new Image();
          img.onload = () => {
            robotImg = img;
            robotImgOk = true;
            robotImgLoadTried = true;
            robotImageDataUrl = dataUrl;
            self.events.robotImageAvailabilityChanged.emit({ available: true });
            draw();
            resolve();
          };
          img.onerror = () => {
            setStatus("Failed to load uploaded robot image.");
            robotImg = null;
            robotImgOk = false;
            self.events.robotImageAvailabilityChanged.emit({ available: false });
            reject(new Error("failed to load uploaded robot image"));
          };
          img.src = dataUrl;
          try {
            if (dataUrl) {
              const savedPath = await saveRobotImage(dataUrl);
              if (savedPath) robotImagePath = String(savedPath);
            }
          } catch (saveErr) {
            console.warn("Failed to persist robot image to app data:", saveErr);
          }
        };
        reader.onerror = () => {
          setStatus("Failed to read robot image file.");
          reject(new Error("failed to read robot image file"));
        };
        reader.readAsDataURL(file);
      });
    },
    setRobotImageEnabled(enabled: boolean) {
      robotImageEnabled = enabled;
      self.events.robotImageAvailabilityChanged.emit({ available: robotImageEnabled && robotImgOk });
      if (robotImageEnabled && !robotImgOk) {
        if (robotImageDataUrl) loadRobotImageFromDataUrl(robotImageDataUrl);
        else if (robotImagePath) void renderer.loadRobotImageFromPath(robotImagePath);
      }
      requestDrawAll();
    },
    isRobotImageEnabled() {
      return robotImageEnabled;
    },
    isRobotImageReady() {
      return robotImgOk;
    },
    getRobotImagePath() {
      return robotImagePath;
    },
    setRobotImagePath(path: string | null) {
      robotImagePath = path;
    },
    getRobotImageDataUrl() {
      return robotImageDataUrl;
    },
    setRobotImageDataUrl(dataUrl: string | null) {
      robotImageDataUrl = dataUrl;
    },
    getRobotImageTransform() {
      return robotImgTx;
    },
    setRobotImageTransform(transform: Partial<RobotImageTransform>) {
      if (transform.scale != null) robotImgTx.scale = clamp(Number(transform.scale) || 1, 0.05, 20);
      if (transform.offXIn != null) robotImgTx.offXIn = Number(transform.offXIn) || 0;
      if (transform.offYIn != null) robotImgTx.offYIn = Number(transform.offYIn) || 0;
      if (transform.rotDeg != null) robotImgTx.rotDeg = Number(transform.rotDeg) || 0;
      if (transform.alpha != null) robotImgTx.alpha = clamp(Number(transform.alpha) || 1, 0, 1);
    },
    handleWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const w0 = screenToWorld(mx, my);
      const zoomFactor = Math.exp(-(event.deltaY || 0) * 0.0012);
      viewZoom = clamp(viewZoom * zoomFactor, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX);
      const newScale = baseScale * viewZoom;
      const newOffXBase = baseOffsetXpx * viewZoom;
      const newOffYBase = baseOffsetYpx * viewZoom;
      const targetBase = rotateScreenPoint(mx, my, -fieldRotationRad);
      viewPanXpx = targetBase.x - (w0.x * newScale + newOffXBase);
      viewPanYpx = targetBase.y - (newOffYBase - w0.y * newScale);
      computeTransform();
      clampViewPanToVisibleMargin();
      requestDrawAll();
    },
    beginPan(pointerId: number, canvasX: number, canvasY: number) {
      panArmed = true;
      isPanActive = false;
      suppressNextClick = false;
      panPointerId = pointerId;
      panStart = { x: canvasX, y: canvasY, panX: viewPanXpx, panY: viewPanYpx };
    },
    movePan(canvasX: number, canvasY: number, options: { onStart?: () => void } = {}) {
      if (!panArmed) return false;
      const dx = canvasX - panStart.x;
      const dy = canvasY - panStart.y;
      const baseDelta = rotateScreenDelta(dx, dy, -fieldRotationRad);
      if (!isPanActive) {
        if (Math.abs(dx) + Math.abs(dy) <= 3) return false;
        isPanActive = true;
        suppressNextClick = true;
        canvas.style.cursor = "grabbing";
        options.onStart?.();
      }
      viewPanXpx = panStart.panX + baseDelta.x;
      viewPanYpx = panStart.panY + baseDelta.y;
      computeTransform();
      clampViewPanToVisibleMargin();
      requestDrawAll();
      return true;
    },
    endPan(pointerId = null) {
      if (!panArmed) return false;
      const wasPanning = isPanActive;
      panArmed = false;
      isPanActive = false;
      canvas.style.cursor = "";
      try {
        canvas.releasePointerCapture(panPointerId ?? pointerId ?? 0);
      } catch {
        // Pointer capture is best-effort.
      }
      panPointerId = null;
      return wasPanning;
    },
    isPanning() {
      return isPanActive;
    },
    getSuppressNextClick() {
      return suppressNextClick;
    },
    consumeSuppressNextClick() {
      suppressNextClick = false;
    },
    setBounds(nextBounds: FieldBounds) {
      bounds = { ...nextBounds };
      computeTransform();
    },
  });

  configureFieldTransform({
    worldToScreen,
    screenToWorld,
    getFieldScale: () => scale,
    getFieldViewZoom: () => viewZoom,
    getFieldRotationDeg: () => fieldRotationDeg,
    getFieldBounds: () => bounds,
  });

  }

  setRobotDimensions(dimensions: Readonly<RobotDimensions>): void {
    const w = Number(dimensions.w);
    const h = Number(dimensions.h);
    if (Number.isFinite(w) && w > 0) this.#robotDimensions.w = w;
    if (Number.isFinite(h) && h > 0) this.#robotDimensions.h = h;
    requestDrawAll();
  }
}
