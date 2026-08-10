import type { FieldPose, FieldRenderer, PlanningFieldLayer } from "../render/createFieldRenderer";
import type { PlanningRenderLayer } from "../render/renderScheduler";
import { requestDrawAll } from "../render/renderScheduler";
import { formatDistanceFromInches, getCurrentUnits } from "../shared/units";
import type { PlanningDialogs } from "./PlanningDialogs";
import type { PlanningDom } from "./PlanningDom";
import type { PlanningFeature } from "./PlanningFeature";
import { PlanningDragCoordinator } from "./render/PlanningDragCoordinator";
import { PlanningFieldView } from "./render/PlanningFieldView";
import { PlanningSidebarView } from "./render/PlanningSidebarView";
import { PlanningTimelineView } from "./render/PlanningTimelineView";

/** Owns all Planning DOM and canvas presentation. */
export class PlanningView implements PlanningFieldLayer, PlanningRenderLayer {
  readonly #fieldView: PlanningFieldView;
  readonly #sidebar: PlanningSidebarView;
  readonly #timeline: PlanningTimelineView;
  #bound = false;

  constructor(
    private readonly planning: PlanningFeature,
    field: FieldRenderer,
    private readonly dom: PlanningDom,
    dialogs: PlanningDialogs,
  ) {
    const drag = new PlanningDragCoordinator();
    this.#fieldView = new PlanningFieldView(planning, field, dom, dialogs);
    this.#sidebar = new PlanningSidebarView(planning, dom, dialogs, drag);
    this.#timeline = new PlanningTimelineView(planning, dom, dialogs, drag);
  }

  get overlayVisible(): boolean { return this.planning.overlayVisible; }

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.#fieldView.bind();
    this.#sidebar.bind();
    this.#timeline.bind();
    this.planning.events.documentChanged.subscribe(() => this.render());
    this.planning.events.selectionChanged.subscribe(() => this.render());
    this.planning.events.projectionChanged.subscribe(() => { this.#timeline.render(); requestDrawAll(); });
    this.planning.events.playbackChanged.subscribe((event) => {
      this.dom.timePill.textContent = `Plan: ${formatDistanceFromInches(event.distance, 2)} / ${formatDistanceFromInches(this.planning.projection.totalLength, 2)} ${getCurrentUnits()}`;
      this.dom.pointPill.textContent = `Points: ${this.planning.route.length}`;
      this.#sidebar.renderObjects();
      this.#timeline.draw();
      requestDrawAll();
    });
  }

  render(): void {
    this.#sidebar.render();
    this.#timeline.render();
    requestDrawAll();
  }

  resizeTimeline(): void { this.#timeline.resize(); }
  drawTimeline(): void { this.#timeline.draw(); }
  drawOverlay(force = false): void { this.#fieldView.draw(force); }

  currentPose(): FieldPose | null {
    return this.planning.projection.sample(this.planning.playback.distance);
  }
}
