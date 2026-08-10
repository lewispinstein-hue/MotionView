import { PlanningEvents } from "./planningEvents";
import { PlanningHistory } from "./PlanningHistory";
import { PlanningObjects } from "./planningObjects";
import { PlanningPlayback } from "./planningPlayback";
import { PlanningProjection } from "./PlanningProjection";
import { PlanningRoute } from "./PlanningRoute";
import { PlanningSelection } from "./PlanningSelection";
import { PlanningTimeline } from "./planningTimelineDomain";
import { PlanningSession } from "./planningSession";
import type { PlanningExportView, PlanningTelemetrySnapshot } from "./planningTypes";

const DEFAULT_EXPORT_TEMPLATE = "moveToPoint(${x}, ${y}, ${theta});";

export class PlanningFeature {
  readonly events = new PlanningEvents();
  readonly route: PlanningRoute;
  readonly objects: PlanningObjects;
  readonly timeline: PlanningTimeline;
  readonly selection: PlanningSelection;
  readonly history: PlanningHistory;
  readonly projection: PlanningProjection;
  readonly playback: PlanningPlayback;
  readonly #session: PlanningSession;

  constructor(defaultExportTemplate = DEFAULT_EXPORT_TEMPLATE, maxUndoSteps = 50) {
    this.#session = new PlanningSession(this.events, defaultExportTemplate, maxUndoSteps);
    this.route = new PlanningRoute(this.#session);
    this.objects = new PlanningObjects(this.#session);
    this.timeline = new PlanningTimeline(this.#session);
    this.selection = new PlanningSelection(this.#session, this.events);
    this.history = new PlanningHistory(this.#session);
    this.projection = new PlanningProjection(this.#session, this.events);
    this.playback = new PlanningPlayback(this.#session, this.projection, this.events);
    this.events.projectionChanged.subscribe((change) => {
      if (change.kind !== "route") return;
      if (this.route.length < 2) this.playback.pause();
      this.playback.setDistance(this.playback.distance);
    });
  }

  get exportTemplate(): string { return this.#session.exportTemplate; }
  get overlayVisible(): boolean { return this.#session.overlayVisible; }
  get hasData(): boolean { return this.route.length > 0 || this.objects.length > 0 || this.timeline.length > 0; }

  setExportTemplate(template: string): void {
    this.#session.mutate("template", () => {
      this.#session.exportTemplate = String(template || "").trim() || this.#session.defaultExportTemplate;
    });
  }

  setOverlayVisible(visible: boolean): void {
    this.#session.mutate("overlay", () => { this.#session.overlayVisible = !!visible; }, false);
  }

  toggleOverlay(): boolean {
    this.setOverlayVisible(!this.overlayVisible);
    return this.overlayVisible;
  }

  load(data: unknown): void {
    this.playback.pause();
    this.#session.load(data);
  }

  clear(): void {
    this.playback.pause();
    this.#session.clear();
  }

  exportData(): PlanningExportView {
    return {
      waypoints: this.#session.waypoints,
      objects: this.#session.objects,
      nodes: this.#session.nodes,
      template: this.#session.exportTemplate,
    };
  }

  telemetryProperties(extra: Record<string, unknown> = {}): PlanningTelemetrySnapshot {
    return {
      plan_waypoints: this.route.length,
      plan_objects: this.objects.length,
      plan_methods: this.objects.methodCount,
      plan_nodes: this.timeline.length,
      template_chars: this.exportTemplate.length,
      ...extra,
    };
  }
}
