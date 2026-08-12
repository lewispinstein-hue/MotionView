import type { PlanningEvents } from "./planningEvents";
import type { PlanningSession } from "./planningSession";
import type { PlanningNodeView, PlanningWaypoint } from "./planningTypes";

const NODE_CLEARANCE_INCHES = 5.5;

export interface PlanningNodePlacement {
  readonly node: PlanningNodeView;
  readonly distance: number;
  readonly x: number;
  readonly y: number;
  readonly tangentX: number;
  readonly tangentY: number;
}

export interface PlanningProjectionConfiguration {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly limitBounds: boolean;
  readonly positionSnap: number;
  readonly thetaSnap: number;
}

const DEFAULT_CONFIGURATION: PlanningProjectionConfiguration = {
  minX: -72, maxX: 72, minY: -72, maxY: 72, limitBounds: false, positionSnap: 0, thetaSnap: 0,
};

export class PlanningProjection {
  #configuration: PlanningProjectionConfiguration = DEFAULT_CONFIGURATION;
  readonly #distances: number[] = [0];
  #distanceRevision = -1;
  readonly #nodePlacements: PlanningNodePlacement[] = [];
  #nodePlacementsDirty = true;
  #nodePlacementRouteRevision = -1;

  constructor(private readonly session: PlanningSession, private readonly events: PlanningEvents) {
    events.documentChanged.subscribe(({ kind }) => {
      if (kind === "route" || kind === "node" || kind === "imported" || kind === "cleared" || kind === "history") {
        this.#nodePlacementsDirty = true;
      }
    });
  }
  get configuration(): Readonly<PlanningProjectionConfiguration> { return this.#configuration; }

  configure(values: Partial<PlanningProjectionConfiguration>): void {
    this.#configuration = { ...this.#configuration, ...values };
    this.events.projectionChanged.emit({ kind: "configuration" });
  }

  get distances(): readonly number[] {
    if (this.#distanceRevision !== this.session.routeRevision) {
      this.#distances.length = 1;
      this.#distances[0] = 0;
      for (let index = 1; index < this.session.waypoints.length; index += 1) {
        const previous = this.session.waypoints[index - 1]!;
        const current = this.session.waypoints[index]!;
        this.#distances.push(this.#distances[index - 1]! + Math.hypot(current.x - previous.x, current.y - previous.y));
      }
      this.#distanceRevision = this.session.routeRevision;
    }
    return this.#distances;
  }

  get totalLength(): number { return this.distances.at(-1) ?? 0; }

  /** Returns cached route-distance placements shared by Planning presentation. */
  get nodePlacements(): readonly PlanningNodePlacement[] {
    if (!this.#nodePlacementsDirty && this.#nodePlacementRouteRevision === this.session.routeRevision) {
      return this.#nodePlacements;
    }
    this.#nodePlacements.length = 0;
    this.#nodePlacementRouteRevision = this.session.routeRevision;
    const waypoints = this.session.waypoints;
    if (waypoints.length < 2) {
      this.#nodePlacementsDirty = false;
      return this.#nodePlacements;
    }

    const buckets = new Map<number, PlanningNodeView[]>();
    for (const node of this.session.nodes) {
      const bucket = buckets.get(node.beforeWaypoint) ?? [];
      bucket.push(node);
      buckets.set(node.beforeWaypoint, bucket);
    }
    for (const [beforeWaypoint, nodes] of buckets) {
      if (beforeWaypoint <= 0 || beforeWaypoint > waypoints.length) continue;
      const endIndex = Math.min(beforeWaypoint, waypoints.length - 1);
      const startIndex = Math.max(0, endIndex - 1);
      const start = waypoints[startIndex];
      const end = waypoints[endIndex];
      if (!start || !end) continue;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length <= 0) continue;
      const clearance = Math.min(length, NODE_CLEARANCE_INCHES);
      const usableLength = Math.max(0, length - clearance);
      nodes.sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
      nodes.forEach((node, order) => {
        const along = clearance + (order / Math.max(1, nodes.length)) * usableLength;
        this.#nodePlacements.push({
          node,
          distance: this.distances[startIndex]! + along,
          x: start.x + dx * along / length,
          y: start.y + dy * along / length,
          tangentX: dx / length,
          tangentY: dy / length,
        });
      });
    }
    this.#nodePlacementsDirty = false;
    return this.#nodePlacements;
  }

  segmentAt(distance: number): number {
    const distances = this.distances;
    for (let index = 1; index < distances.length; index += 1) if (distance <= distances[index]!) return index - 1;
    return Math.max(0, distances.length - 2);
  }

  speedAt(distance: number): number {
    const index = this.segmentAt(distance);
    const start = this.session.waypoints[index];
    const speed = Number(start?.speed);
    return Math.abs(Number.isFinite(speed) ? Math.max(1, Math.min(127, speed)) : 127);
  }

  sample(distance: number): PlanningWaypoint | null {
    if (!this.session.waypoints.length) return null;
    if (this.session.waypoints.length === 1) return { ...this.session.waypoints[0]! };
    const index = this.segmentAt(distance);
    const start = this.session.waypoints[index]!;
    const end = this.session.waypoints[index + 1]!;
    const distances = this.distances;
    const amount = Math.max(0, Math.min(1, (distance - distances[index]!) / ((distances[index + 1]! - distances[index]!) || 1)));
    const heading = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
    const thetaStart = Number.isFinite(start.theta) ? start.theta! : heading;
    const thetaEnd = Number.isFinite(end.theta) ? end.theta! : heading;
    const thetaDelta = ((thetaEnd - thetaStart + 540) % 360) - 180;
    return {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
      theta: ((thetaStart + thetaDelta * amount) % 360 + 360) % 360,
      speed: this.speedAt(distance),
    };
  }

  constrain(point: Readonly<PlanningWaypoint>): PlanningWaypoint {
    const config = this.#configuration;
    const snap = (value: number, step: number) => step > 0 ? Math.round(value / step) * step : value;
    const x = snap(point.x, config.positionSnap);
    const y = snap(point.y, config.positionSnap);
    const theta = snap(point.theta ?? 0, config.thetaSnap);
    return {
      ...point,
      x: config.limitBounds ? Math.max(config.minX, Math.min(config.maxX, x)) : x,
      y: config.limitBounds ? Math.max(config.minY, Math.min(config.maxY, y)) : y,
      theta: ((theta % 360) + 360) % 360,
    };
  }

  constrainTheta(theta: number): number {
    const step = this.#configuration.thetaSnap;
    const value = step > 0 ? Math.round(theta / step) * step : theta;
    return ((value % 360) + 360) % 360;
  }
}
