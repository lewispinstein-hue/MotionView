export interface ViewingFieldOverlayDependencies {
  context: CanvasRenderingContext2D;
  getWatchMarkers(): any[];
  getWaypoints(): any[];
  getSelectedWatch(): any;
  getSelectedWaypointId(): unknown;
  getHoverWatch(): any;
  isWatchMarkerVisible(marker: any): boolean;
  waypointFilterMatches(waypoint: any): boolean;
  worldToScreen(x: number, y: number): { x: number; y: number };
  levelFillWithAlpha(level: unknown, alpha: number): string;
  scaledViewingFieldRadius(baseDiameterPx: number, maxDiameterPx?: number): number;
  viewingFieldMarkerStyleScale(): number;
}

export interface ViewingFieldOverlayRenderer {
  drawWatchDots(): void;
  drawWaypointDots(): void;
}

export function createViewingFieldOverlayRenderer(deps: ViewingFieldOverlayDependencies): ViewingFieldOverlayRenderer {
  function drawWatchDots() {
    const watchMarkers = deps.getWatchMarkers();
    if (!watchMarkers.length) return;
    const ctx = deps.context;

    for (const marker of watchMarkers) {
      const { pose, watch } = marker;
      if (!deps.isWatchMarkerVisible(marker)) continue;
      if (!pose) continue;
      const point = deps.worldToScreen(pose.x, pose.y);

      const isHover = deps.getHoverWatch() === marker;
      const baseDiameter = isHover ? 11.2 : 8.4;
      const radius = deps.scaledViewingFieldRadius(baseDiameter);

      ctx.save();
      ctx.fillStyle = deps.levelFillWithAlpha(watch.level, 0.40);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = Math.max(1, 2 * deps.viewingFieldMarkerStyleScale());
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    const selectedWatch = deps.getSelectedWatch();
    if (selectedWatch?.marker?.pose && deps.isWatchMarkerVisible(selectedWatch.marker)) {
      const pose = selectedWatch.marker.pose;
      const point = deps.worldToScreen(pose.x, pose.y);

      const outerRadius = deps.scaledViewingFieldRadius(18);
      const innerRadius = deps.scaledViewingFieldRadius(13);

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = Math.max(1, 2 * deps.viewingFieldMarkerStyleScale());
      ctx.beginPath();
      ctx.arc(point.x, point.y, outerRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = deps.levelFillWithAlpha(selectedWatch.marker.watch.level, 0.35);
      ctx.beginPath();
      ctx.arc(point.x, point.y, innerRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawWaypointDots() {
    const waypoints = deps.getWaypoints();
    if (!waypoints.length) return;
    const ctx = deps.context;

    for (const waypoint of waypoints) {
      if (!deps.waypointFilterMatches(waypoint)) continue;
      const point = deps.worldToScreen(waypoint.target.x, waypoint.target.y);
      const isSelected = deps.getSelectedWaypointId() === waypoint.id;
      const fill = waypoint.active ? "rgba(0,0,0,0.10)" : "rgba(120,120,120,0.10)";
      const stroke = "rgba(255,255,255,0.96)";
      const baseDiameter = isSelected ? 15 : 12;
      const radius = deps.scaledViewingFieldRadius(baseDiameter);
      const selectedRingGap = 4 * deps.viewingFieldMarkerStyleScale();

      ctx.save();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, 2 * deps.viewingFieldMarkerStyleScale());
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (isSelected) {
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = Math.max(1, 2 * deps.viewingFieldMarkerStyleScale());
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + selectedRingGap, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  return {
    drawWatchDots,
    drawWaypointDots,
  };
}
