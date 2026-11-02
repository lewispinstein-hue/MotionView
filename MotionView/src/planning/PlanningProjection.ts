import type { PlanningEvents } from "./planningEvents";
import type { PlanningSession } from "./planningSession";
import type { PlanningNodeView, PlanningWaypoint } from "./planningTypes";
import { PlanningSegment } from "./planningSegments";
import { simulatePlanningRoute, simulationSectionKey } from "./planningSimulation";
import { PlanningSimulationWorker, type PlanningSimulationJob } from "./PlanningSimulationWorker";
import type { PlanningSimulationResult } from "./planningSimulationTypes";
import {
  DEFAULT_PLANNING_SIMULATION_CONFIGURATION,
  normalizePlanningSimulationConfiguration,
  type PlanningSimulationConfiguration,
  type PlanningSimulationConfigurationUpdate,
} from "./planningSimulationConfiguration";

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
  readonly simulation: PlanningSimulationConfiguration;
}

const DEFAULT_CONFIGURATION: PlanningProjectionConfiguration = {
  minX: -72,
  maxX: 72,
  minY: -72,
  maxY: 72,
  limitBounds: false,
  positionSnap: 0,
  thetaSnap: 0,
  simulation: DEFAULT_PLANNING_SIMULATION_CONFIGURATION,
};

export class PlanningProjection {
  #configuration: PlanningProjectionConfiguration = DEFAULT_CONFIGURATION;
  readonly #distances: number[] = [0];
  #distanceRevision = -1;
  readonly #segments: PlanningSegment[] = [];
  readonly #nodePlacements: PlanningNodePlacement[] = [];
  #nodePlacementsDirty = true;
  #nodePlacementRouteRevision = -1;
  #result: PlanningSimulationResult = { sections: [], duration: 0, complete: true };
  #visualResult: PlanningSimulationResult = this.#result;
  #visualSignature = "";
  #inputSignature = "";
  #completedSignature = "";
  #inputRevision = -1;
  #pending = false;
  readonly #worker: PlanningSimulationWorker;
  #generation = 0;
  #error: string | null = null;

  constructor(
    private readonly session: PlanningSession,
    private readonly events: PlanningEvents,
  ) {
    this.#worker = new PlanningSimulationWorker(
      (job, result) => this.acceptSimulation(job, result),
      (job) => {
        if (job.signature !== this.#inputSignature) return;
        this.#pending = false;
        this.#error = "Preview unavailable";
        if (!this.session.isRouteEditing) {
          this.#result = { sections: [], duration: 0, complete: false };
          this.#completedSignature = "";
        }
        this.events.projectionChanged.emit({ kind: this.session.isRouteEditing ? "preview-ready" : "simulation-ready" });
      },
    );
    events.routeEditChanged.subscribe(() => {
      this.#generation += 1;
      // A finished visual result can be committed directly at release. If the
      // newest input is still running, it commits when that request completes.
      this.#inputRevision = -1;
      this.ensureSimulation();
      this.events.projectionChanged.emit({ kind: "route-edit" });
    });
    events.documentChanged.subscribe(({ kind }) => {
      if (
        kind === "route" ||
        kind === "path" ||
        kind === "object" ||
        kind === "method" ||
        kind === "node" ||
        kind === "imported" ||
        kind === "cleared" ||
        kind === "history"
      ) {
        this.#nodePlacementsDirty = true;
      }
    });
    events.documentPreviewChanged.subscribe(({ kind }) => {
      if (kind === "route" || kind === "node" || kind === "path")
        this.#nodePlacementsDirty = true;
    });
  }
  get configuration(): Readonly<PlanningProjectionConfiguration> {
    return { ...this.#configuration, simulation: this.session.simulationConfiguration };
  }

  configure(values: Partial<PlanningProjectionConfiguration>): void {
    this.#configuration = { ...this.#configuration, ...values };
    if (values.simulation) {
      this.configureSimulation(values.simulation);
      this.#distanceRevision = -1;
      this.#nodePlacementsDirty = true;
    }
    this.events.projectionChanged.emit({ kind: "configuration" });
  }

  configureSimulation(values: PlanningSimulationConfigurationUpdate): void {
    this.session.mutate("simulation-configuration", () => {
      this.session.simulationConfiguration = normalizePlanningSimulationConfiguration(values, this.session.simulationConfiguration);
    });
  }

  get pending(): boolean { this.ensureSimulation(); return this.#pending; }
  /** Committed trajectory used for robot playback and time sampling. */
  get simulation(): PlanningSimulationResult { this.ensureSimulation(); return this.#result; }
  /** Live trajectory used for drawing and hit testing, including during drags. */
  get visualSimulation(): PlanningSimulationResult { this.ensureSimulation(); return this.#visualResult; }
  get error(): string | null { return this.#error; }
  get duration(): number { return this.simulation.duration; }
  get times(): readonly number[] {
    return [0, ...this.simulation.sections.map(section => section.samples.at(-1)?.time ?? 0)];
  }

  private invalidateGeometry(): void {
    this.#distanceRevision = -1;
    this.#nodePlacementsDirty = true;
  }

  private acceptSimulation(job: PlanningSimulationJob, result: PlanningSimulationResult): void {
    const current = job.signature === this.#inputSignature;
    // During an active drag, show successive completed previews while a newer
    // request is being coalesced. Cancelled drags and other paths cannot leak in.
    if (!current && (!this.session.isRouteEditing || job.generation !== this.#generation || job.pathId !== this.session.activePathId)) return;
    this.#visualResult = result;
    this.#visualSignature = job.signature;
    this.invalidateGeometry();
    if (current) {
      this.#pending = false;
      this.#error = null;
      if (!this.session.isRouteEditing) {
        this.#result = result;
        this.#completedSignature = job.signature;
        this.events.projectionChanged.emit({ kind: "simulation-ready" });
        return;
      }
    }
    this.events.projectionChanged.emit({ kind: "preview-ready" });
  }

  private ensureSimulation(): void {
    if (this.#inputRevision === this.session.routeRevision) return;
    this.#inputRevision = this.session.routeRevision;
    const live = { waypoints: this.session.waypoints, configuration: this.session.simulationConfiguration };
    const signature = JSON.stringify([this.session.activePathId, live.waypoints.length,
      live.waypoints[0] ? [live.waypoints[0].x, live.waypoints[0].y, live.waypoints[0].theta ?? 0] : null,
      live.waypoints.slice(1).map((_, index) => simulationSectionKey(live, index))]);
    if (signature === this.#completedSignature) {
      const changed = this.#visualResult !== this.#result;
      this.#inputSignature = signature;
      this.#visualResult = this.#result;
      this.#visualSignature = signature;
      this.#pending = false; this.#error = null;
      this.#worker.clearQueued();
      if (changed) {
        this.invalidateGeometry();
        this.events.projectionChanged.emit({ kind: "preview-ready" });
      }
      return;
    }
    if (signature === this.#visualSignature) {
      this.#inputSignature = signature;
      this.#pending = false; this.#error = null;
      this.#worker.clearQueued();
      if (!this.session.isRouteEditing) {
        this.#result = this.#visualResult;
        this.#completedSignature = signature;
        this.events.projectionChanged.emit({ kind: "simulation-ready" });
      }
      return;
    }
    if (signature === this.#inputSignature && !this.#error) return;
    this.#inputSignature = signature;
    this.#pending = true; this.#error = null;
    this.events.projectionChanged.emit({ kind: this.session.isRouteEditing ? "preview-pending" : "simulation-pending" });
    const job: PlanningSimulationJob = {
      signature, pathId: this.session.activePathId, generation: this.#generation,
      request: { waypoints: structuredClone(live.waypoints), configuration: live.configuration },
    };
    if (typeof Worker === "undefined" || live.waypoints.length < 2) {
      this.acceptSimulation(job, simulatePlanningRoute(job.request, this.#visualResult));
    } else {
      // Start immediately. The worker reuses its cached prefix and keeps only
      // the latest queued edit instead of restarting or building a long queue.
      this.#worker.request(job, this.#visualResult);
    }
  }

  get distances(): readonly number[] {
    this.ensureSimulation();
    if (this.#distanceRevision !== this.session.routeRevision) {
      const cached = [...this.#segments];
      this.#segments.length = 0;
      this.#distances.length = 1; this.#distances[0] = 0;
      for (let index = 1; index < this.session.waypoints.length; index++) {
        const start = this.session.waypoints[index - 1]!, end = this.session.waypoints[index]!;
        const section = this.#visualResult.sections[index - 1] ?? null;
        const previous = cached[index - 1];
        const segment = previous?.start === start && previous.end === end &&
          previous.matches(start, end, this.session.simulationConfiguration) && previous.section === section
          ? previous : new PlanningSegment(start, end, this.session.simulationConfiguration, section);
        this.#segments.push(segment);
        this.#distances.push(this.#distances[index - 1]! + segment.length);
      }
      this.#distanceRevision = this.session.routeRevision;
    }
    return this.#distances;
  }

  get segments(): readonly PlanningSegment[] {
    void this.distances;
    return this.#segments;
  }

  get totalLength(): number {
    return this.distances.at(-1) ?? 0;
  }

  /** Returns cached route-distance placements shared by Planning presentation. */
  get nodePlacements(): readonly PlanningNodePlacement[] {
    if (
      !this.#nodePlacementsDirty &&
      this.#nodePlacementRouteRevision === this.session.routeRevision
    ) {
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
      if (beforeWaypoint <= 0 || beforeWaypoint >= waypoints.length) continue;
      const endIndex = beforeWaypoint;
      const startIndex = Math.max(0, endIndex - 1);
      const start = waypoints[startIndex];
      const end = waypoints[endIndex];
      if (!start || !end) continue;
      const segment = this.segments[startIndex]!;
      const length = segment.length;
      if (length <= 0) continue;
      const clearance = Math.min(length, NODE_CLEARANCE_INCHES);
      const usableLength = Math.max(0, length - clearance);
      nodes.sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
      nodes.forEach((node, order) => {
        const along =
          clearance + (order / Math.max(1, nodes.length)) * usableLength;
        const progress = segment.progressAtDistance(along);
        const point = segment.pointAt(progress);
        const tangent = segment.tangentAt(progress);
        this.#nodePlacements.push({
          node,
          distance: this.distances[startIndex]! + along,
          x: point.x,
          y: point.y,
          tangentX: tangent.x,
          tangentY: tangent.y,
        });
      });
    }
    this.#nodePlacementsDirty = false;
    return this.#nodePlacements;
  }

  segmentAt(distance: number): number {
    const distances = this.distances;
    for (let index = 1; index < distances.length; index += 1)
      if (distance <= distances[index]!) return index - 1;
    return Math.max(0, distances.length - 2);
  }

  speedAt(distance: number): number {
    const index = this.segmentAt(distance);
    const start = this.session.waypoints[index];
    const speed = Number(start?.speed);
    return Math.abs(
      Number.isFinite(speed) ? Math.max(1, Math.min(127, speed)) : 127,
    );
  }

  sample(distance: number): PlanningWaypoint | null {
    return this.sampleTime(this.timeAtDistance(distance));
  }

  timeAtDistance(distance: number): number {
    // Field geometry can change during a drag; playback still samples only its
    // committed trajectory until release, including distance-based callers.
    const simulation = this.simulation;
    const total = simulation.sections.at(-1)?.samples.at(-1)?.distance ?? 0;
    const along = Math.max(0, Math.min(total, distance));
    if (distance > 0 && along >= total) return simulation.duration;
    const section = simulation.sections.find(s => along <= s.samples.at(-1)!.distance);
    if (!section) return 0;
    const samples = section.samples;
    let low = 0, high = samples.length - 1;
    while (high - low > 1) { const mid = (low + high) >> 1; if (samples[mid]!.distance < along) low = mid; else high = mid; }
    const before = samples[low]!, after = samples[high]!;
    return before.time + (after.time - before.time) * (along - before.distance) / (after.distance - before.distance || 1);
  }

  distanceAtTime(time: number): number {
    const section = this.sectionAtTime(time);
    if (!section) return 0;
    const { before, after, amount } = this.samplesAtTime(time, section);
    return before.distance + (after.distance - before.distance) * amount;
  }

  sampleTime(time: number): PlanningWaypoint | null {
    const section = this.sectionAtTime(time);
    if (!section) return this.session.waypoints[0] ? { ...this.session.waypoints[0] } : null;
    const { before, after, amount } = this.samplesAtTime(time, section);
    return { x: before.x + (after.x - before.x) * amount, y: before.y + (after.y - before.y) * amount,
      theta: ((before.theta + (after.theta - before.theta) * amount) * 180 / Math.PI % 360 + 360) % 360 };
  }

  private sectionAtTime(time: number) {
    return this.simulation.sections.find(section => time <= (section.samples.at(-1)?.time ?? 0)) ?? this.simulation.sections.at(-1);
  }
  private samplesAtTime(time: number, section: PlanningSimulationResult["sections"][number]) {
    const samples = section.samples;
    const clamped = Math.max(samples[0]!.time, Math.min(samples.at(-1)!.time, time));
    let low = 0, high = samples.length - 1;
    while (high - low > 1) { const mid = (low + high) >> 1; if (samples[mid]!.time < clamped) low = mid; else high = mid; }
    const before = samples[low]!, after = samples[high]!;
    return { before, after, amount: (clamped - before.time) / (after.time - before.time || 1) };
  }

  constrain(point: Readonly<PlanningWaypoint>): PlanningWaypoint {
    const config = this.#configuration;
    const snap = (value: number, step: number) =>
      step > 0 ? Math.round(value / step) * step : value;
    const x = snap(point.x, config.positionSnap);
    const y = snap(point.y, config.positionSnap);
    const theta = snap(point.theta ?? 0, config.thetaSnap);
    return this.constrainToBounds({
      ...point,
      x,
      y,
      theta: ((theta % 360) + 360) % 360,
    });
  }

  constrainToBounds(point: Readonly<PlanningWaypoint>): PlanningWaypoint {
    const config = this.#configuration;
    return {
      ...point,
      x: config.limitBounds
        ? Math.max(config.minX, Math.min(config.maxX, point.x))
        : point.x,
      y: config.limitBounds
        ? Math.max(config.minY, Math.min(config.maxY, point.y))
        : point.y,
    };
  }

  constrainTheta(theta: number): number {
    const step = this.#configuration.thetaSnap;
    const value = step > 0 ? Math.round(theta / step) * step : theta;
    return ((value % 360) + 360) % 360;
  }
}
