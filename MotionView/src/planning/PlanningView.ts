import type {
  FieldPose,
  FieldRenderer,
  PlanningFieldLayer,
} from "../render/field";
import type { PlanningRenderLayer } from "../render/renderScheduler";
import { requestDrawAll } from "../render/renderScheduler";
import { subscribeMode } from "../app/modeController";
import { formatDistanceFromInches, getCurrentUnits } from "../shared/units";
import type { PlanningDialogs } from "./PlanningDialogs";
import type { PlanningDom } from "./PlanningDom";
import type { PlanningFeature } from "./PlanningFeature";
import { PlanningWaypointEditor } from "./PlanningWaypointEditor";
import { getPlanNodeEffectiveMethod } from "./planningObjects";
import { PlanningDragCoordinator } from "./render/PlanningDragCoordinator";
import { PlanningFieldView } from "./render/PlanningFieldView";
import { PlanningPathManagerView } from "./render/PlanningPathManagerView";
import { PlanningSidebarView } from "./render/PlanningSidebarView";
import { PlanningTimelineView } from "./render/PlanningTimelineView";
import { PlanningNodeTooltip } from "./render/PlanningNodeTooltip";

/** Owns all Planning DOM and canvas presentation. */
export class PlanningView implements PlanningFieldLayer, PlanningRenderLayer {
  readonly #fieldView: PlanningFieldView;
  readonly #pathManager: PlanningPathManagerView;
  readonly #sidebar: PlanningSidebarView;
  readonly #timeline: PlanningTimelineView;
  readonly #nodeTooltip: PlanningNodeTooltip;
  #bound = false;

  constructor(
    private readonly planning: PlanningFeature,
    field: FieldRenderer,
    private readonly dom: PlanningDom,
    dialogs: PlanningDialogs,
  ) {
    const drag = new PlanningDragCoordinator();
    const waypointEditor = new PlanningWaypointEditor(planning, dialogs);
    this.#nodeTooltip = new PlanningNodeTooltip(dom.nodeTooltip);
    this.#fieldView = new PlanningFieldView(
      planning,
      field,
      dom,
      dialogs,
      waypointEditor,
      this.#nodeTooltip,
    );
    this.#pathManager = new PlanningPathManagerView(planning, dom, dialogs);
    this.#sidebar = new PlanningSidebarView(
      planning,
      dom,
      dialogs,
      drag,
      waypointEditor,
    );
    this.#timeline = new PlanningTimelineView(
      planning,
      dom,
      dialogs,
      drag,
      waypointEditor,
      this.#nodeTooltip,
    );
  }

  get overlayVisible(): boolean {
    return this.planning.overlayVisible;
  }

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.#fieldView.bind();
    this.#pathManager.bind();
    this.#sidebar.bind();
    this.#timeline.bind();
    subscribeMode((mode) => {
      if (mode !== "planning") this.#nodeTooltip.hide(true);
    });
    window.addEventListener("blur", () => this.#nodeTooltip.hide(true));
    this.planning.events.documentChanged.subscribe(() => this.render());
    this.planning.events.documentPreviewChanged.subscribe(() => this.render());
    this.planning.events.selectionChanged.subscribe(() => this.render());
    this.planning.events.projectionChanged.subscribe(() => {
      this.#timeline.render();
      this.updateLatestPill();
      requestDrawAll();
    });
    this.planning.events.playbackChanged.subscribe((event) => {
      this.dom.timePill.textContent = `Plan: ${formatDistanceFromInches(event.distance, 2)} / ${formatDistanceFromInches(this.planning.projection.totalLength, 2)} ${getCurrentUnits()}`;
      this.dom.pointPill.textContent = `Points: ${this.planning.route.length}`;
      this.#sidebar.updatePlayback();
      this.#timeline.draw();
      this.updateLatestPill();
      requestDrawAll();
    });
  }

  render(): void {
    this.#pathManager.render();
    this.#sidebar.render();
    this.#timeline.render();
    this.updateLatestPill();
    requestDrawAll();
  }

  resizeTimeline(): void {
    this.#timeline.resize();
  }
  drawTimeline(): void {
    this.#timeline.draw();
  }
  drawOverlay(force = false): void {
    this.#fieldView.draw(force);
  }

  setFieldNodesVisible(visible: boolean): void {
    this.#fieldView.setNodesVisible(visible);
  }

  currentPose(): FieldPose | null {
    return this.planning.projection.sample(this.planning.playback.distance);
  }

  private updateLatestPill(): void {
    const node = this.#timeline.latestNodeAtProgress();
    const object = node ? this.planning.objects.get(node.objectId) : null;
    const method = node
      ? getPlanNodeEffectiveMethod(this.planning.objects.items, node)
      : null;
    this.dom.latestPill.textContent =
      object && method ? `${object.name} • ${method.name}` : "—";
  }
}
