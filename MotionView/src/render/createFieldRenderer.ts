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

export interface RobotImageTransform {
  scale: number;
  offXIn: number;
  offYIn: number;
  rotDeg: number;
  alpha: number;
}

export interface FieldRendererDependencies {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  isTauriRuntime: boolean;
  resolveResource(path: string): Promise<string>;
  invokeCommand(command: string, args?: Record<string, unknown>): Promise<unknown>;
  getMode(): "viewing" | "planning";
  getViewingPathPoses(): readonly FieldPose[];
  getViewingPose(): FieldPose | null;
  getPlanningPose(): FieldPose | null;
  getRobotDimensions(): { w: number; h: number };
  fieldHeadingToCanvasRotationDeg(thetaField: number): number;
  heatColorFromNorm(norm: number): string;
  drawViewingOverlay(): void;
  drawPlanningOverlay(force?: boolean): void;
  isPlanningOverlayVisible(): boolean;
  drawViewingTimeline(): void;
  drawPlanningTimeline(): void;
  drawWaypointOffsetOverlay(pose: FieldPose): void;
  setStatus(message: unknown): void;
  onRobotImageAvailabilityChanged?(available: boolean): void;
  onFieldImageLoaded?(fieldKey: string): void | Promise<void>;
}

export interface FieldRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  requestDrawAll(): void;
  draw(): void;
  resizeCanvas(): void;
  updateFieldLayout(preserveBounds?: boolean): void;
  resetFieldPosition(): void;
  centerOnWorld(x: number, y: number): void;
  worldToScreen(xIn: number, yIn: number): ScreenPoint;
  screenToWorld(xPx: number, yPx: number): ScreenPoint;
  getScale(): number;
  getViewZoom(): number;
  getFieldRotationDeg(): number;
  getBounds(): Readonly<FieldBounds>;
  hasFieldImage(): boolean;
  setFieldRotationDeg(deg: number): void;
  loadFieldImage(fieldKey: string): Promise<void>;
  loadRobotImage(): void;
  loadRobotImageFromPath(path: string | null): Promise<void>;
  loadRobotImageFromDataUrl(dataUrl: string | null): void;
  loadRobotImageFromFile(file: File): Promise<void>;
  setRobotImageEnabled(enabled: boolean): void;
  isRobotImageEnabled(): boolean;
  isRobotImageReady(): boolean;
  getRobotImagePath(): string | null;
  setRobotImagePath(path: string | null): void;
  getRobotImageDataUrl(): string | null;
  setRobotImageDataUrl(dataUrl: string | null): void;
  getRobotImageTransform(): Readonly<RobotImageTransform>;
  setRobotImageTransform(transform: Partial<RobotImageTransform>): void;
  handleWheel(event: WheelEvent): void;
  beginPan(pointerId: number, canvasX: number, canvasY: number): void;
  movePan(canvasX: number, canvasY: number, options?: { onStart?: () => void }): boolean;
  endPan(pointerId?: number | null): boolean;
  isPanning(): boolean;
  getSuppressNextClick(): boolean;
  consumeSuppressNextClick(): void;
  setBounds(bounds: FieldBounds): void;
}

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

export function createFieldRenderer(deps: FieldRendererDependencies): FieldRenderer {
  const { canvas, ctx } = deps;
  let bounds = { ...FIELD_BOUNDS_IN };
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
  let squareMode = true;
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
  let drawQueued = false;

  function computeTransform() {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const pad = bounds.pad;
    const worldW = (bounds.maxX - bounds.minX) || 1;
    const worldH = (bounds.maxY - bounds.minY) || 1;

    baseScale = Math.min((w - pad * 2) / worldW, (h - pad * 2) / worldH);

    const side = squareMode ? Math.min(w, h) : null;
    const vx = squareMode && side != null ? (w - side) / 2 : 0;
    const vy = squareMode && side != null ? (h - side) / 2 : 0;

    baseOffsetXpx = vx + pad - bounds.minX * baseScale;
    baseOffsetYpx = vy + pad + bounds.maxY * baseScale;

    scale = baseScale * viewZoom;
    offsetXpx = baseOffsetXpx * viewZoom + viewPanXpx;
    offsetYpx = baseOffsetYpx * viewZoom + viewPanYpx;
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

  function drawPath() {
    const poses = deps.getViewingPathPoses();
    if (poses.length < 2) return;
    for (let i = 1; i < poses.length; i += 1) {
      const a = poses[i - 1];
      const b = poses[i];
      const pa = worldToScreen(a.x, a.y);
      const pb = worldToScreen(b.x, b.y);
      const grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
      grad.addColorStop(0, deps.heatColorFromNorm(a.speed_norm ?? 0));
      grad.addColorStop(1, deps.heatColorFromNorm(b.speed_norm ?? 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }

  function drawRobot(pose: FieldPose | null, alpha = 1.0) {
    if (!pose) return;
    const { w: wIn, h: hIn } = deps.getRobotDimensions();
    const center = worldToScreen(pose.x, pose.y);
    const wPx = wIn * scale;
    const hPx = hIn * scale;
    const thetaDeg = deps.fieldHeadingToCanvasRotationDeg(pose.theta ?? 0);
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

  function draw() {
    drawField();
    drawAxes();
    if (deps.getMode() === "viewing") {
      drawPath();
      deps.drawViewingOverlay();
      if (deps.isPlanningOverlayVisible()) deps.drawPlanningOverlay(true);
      const pose = deps.getViewingPose();
      if (pose) deps.drawWaypointOffsetOverlay(pose);
      if (pose) drawRobot(pose, 1.0);
    } else {
      deps.drawPlanningOverlay();
      const pose = deps.getPlanningPose();
      if (pose) drawRobot(pose, 1.0);
    }
  }

  function requestDrawAll() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      draw();
      deps.drawViewingTimeline();
      deps.drawPlanningTimeline();
    });
  }

  async function resolveFieldImageSrc(fieldKey: string) {
    if (!deps.isTauriRuntime) return fieldKey;
    const normalized = String(fieldKey || "").replace(/^\.\//, "");
    const candidates = [
      `_up_/src/${normalized}`,
      `src/${normalized}`,
      normalized,
    ];
    for (const candidate of candidates) {
      try {
        const resolved = await deps.resolveResource(candidate);
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
      deps.onRobotImageAvailabilityChanged?.(true);
      requestDrawAll();
    };
    img.onerror = () => {
      deps.setStatus("Failed to load saved robot image.");
      robotImg = null;
      robotImgOk = false;
      deps.onRobotImageAvailabilityChanged?.(false);
    };
    img.src = dataUrl;
  }

  const renderer: FieldRenderer = {
    canvas,
    ctx,
    requestDrawAll,
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
      if (!preserveBounds) bounds = { ...FIELD_BOUNDS_IN };
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
    centerOnWorld(x, y) {
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
    setFieldRotationDeg(deg) {
      fieldRotationDeg = normalizeFieldRotation(deg);
      fieldRotationRad = fieldRotationDeg * Math.PI / 180;
      requestDrawAll();
    },
    async loadFieldImage(fieldKey) {
      if (!fieldKey) {
        fieldImg = null;
        draw();
        deps.setStatus("No field image is available for the selected competition.");
        return;
      }
      let imgSrc = fieldKey;
      if (deps.isTauriRuntime) {
        try {
          const resolvedPath = await resolveFieldImageSrc(fieldKey);
          if (resolvedPath && resolvedPath !== fieldKey && !resolvedPath.startsWith("asset:") && !resolvedPath.startsWith("http")) {
            imgSrc = String(await deps.invokeCommand("read_image_data", { path: resolvedPath }));
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
        draw();
      };
      img.onerror = () => {
        fieldImg = null;
        draw();
        deps.setStatus(`Could not load field image: ${fieldKey}`);
      };
      img.src = imgSrc;
      await deps.onFieldImageLoaded?.(fieldKey);
    },
    loadRobotImage() {
      if (robotImgLoadTried) return;
      robotImgLoadTried = true;
      const img = new Image();
      img.onload = () => {
        robotImg = img;
        robotImgOk = true;
        deps.onRobotImageAvailabilityChanged?.(true);
        draw();
      };
      img.onerror = () => {
        robotImg = null;
        robotImgOk = false;
        deps.onRobotImageAvailabilityChanged?.(false);
        draw();
      };
    },
    async loadRobotImageFromPath(path) {
      if (!path) return;
      try {
        const dataUrl = String(await deps.invokeCommand("read_image_data", { path }));
        robotImageDataUrl = dataUrl;
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            robotImg = img;
            robotImgOk = true;
            robotImgLoadTried = true;
            deps.onRobotImageAvailabilityChanged?.(true);
            requestDrawAll();
            resolve();
          };
          img.onerror = () => reject(new Error("failed to load robot image from saved path"));
          img.src = dataUrl;
        });
      } catch (error) {
        console.error("Failed to load robot image from path:", error);
        deps.setStatus(`Failed to load robot image from path: ${error instanceof Error ? error.message : error}`);
      }
    },
    loadRobotImageFromDataUrl,
    async loadRobotImageFromFile(file) {
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
            deps.onRobotImageAvailabilityChanged?.(true);
            draw();
            resolve();
          };
          img.onerror = () => {
            deps.setStatus("Failed to load uploaded robot image.");
            robotImg = null;
            robotImgOk = false;
            deps.onRobotImageAvailabilityChanged?.(false);
            reject(new Error("failed to load uploaded robot image"));
          };
          img.src = dataUrl;
          try {
            if (dataUrl) {
              const savedPath = await deps.invokeCommand("save_robot_image", { dataUrl });
              if (savedPath) robotImagePath = String(savedPath);
            }
          } catch (saveErr) {
            console.warn("Failed to persist robot image to app data:", saveErr);
          }
        };
        reader.onerror = () => {
          deps.setStatus("Failed to read robot image file.");
          reject(new Error("failed to read robot image file"));
        };
        reader.readAsDataURL(file);
      });
    },
    setRobotImageEnabled(enabled) {
      robotImageEnabled = enabled;
      deps.onRobotImageAvailabilityChanged?.(robotImageEnabled && robotImgOk);
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
    setRobotImagePath(path) {
      robotImagePath = path;
    },
    getRobotImageDataUrl() {
      return robotImageDataUrl;
    },
    setRobotImageDataUrl(dataUrl) {
      robotImageDataUrl = dataUrl;
    },
    getRobotImageTransform() {
      return robotImgTx;
    },
    setRobotImageTransform(transform) {
      if (transform.scale != null) robotImgTx.scale = clamp(Number(transform.scale) || 1, 0.05, 20);
      if (transform.offXIn != null) robotImgTx.offXIn = Number(transform.offXIn) || 0;
      if (transform.offYIn != null) robotImgTx.offYIn = Number(transform.offYIn) || 0;
      if (transform.rotDeg != null) robotImgTx.rotDeg = Number(transform.rotDeg) || 0;
      if (transform.alpha != null) robotImgTx.alpha = clamp(Number(transform.alpha) || 1, 0, 1);
    },
    handleWheel(event) {
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
    beginPan(pointerId, canvasX, canvasY) {
      panArmed = true;
      isPanActive = false;
      suppressNextClick = false;
      panPointerId = pointerId;
      panStart = { x: canvasX, y: canvasY, panX: viewPanXpx, panY: viewPanYpx };
    },
    movePan(canvasX, canvasY, options = {}) {
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
    setBounds(nextBounds) {
      bounds = { ...nextBounds };
      computeTransform();
    },
  };

  return renderer;
}
