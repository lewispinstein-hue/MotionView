import type {
  FieldPose,
  FieldRenderer,
  PlanningFieldLayer,
} from "../render/field";
import type { PlanningRenderLayer } from "../render/renderScheduler";
import { requestDrawAll } from "../render/renderScheduler";
import { subscribeMode } from "../app/modeController";
import type { SettingsFeature } from "../app/settings/SettingsFeature";
import type { PlanningDialogs } from "./PlanningDialogs";
import type { PlanningDom } from "./PlanningDom";
import type { PlanningFeature } from "./PlanningFeature";
import { PlanningWaypointEditor } from "./PlanningWaypointEditor";
import { editPlanningNode } from "./planningNodeEditor";
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
  readonly #waypointEditor: PlanningWaypointEditor;
  #routePreviewFrame: number | null = null;
  #bound = false;

  constructor(
    private readonly planning: PlanningFeature,
    field: FieldRenderer,
    private readonly dom: PlanningDom,
    private readonly dialogs: PlanningDialogs,
    settings: SettingsFeature,
  ) {
    const drag = new PlanningDragCoordinator();
    this.#waypointEditor = new PlanningWaypointEditor(planning, dialogs);
    this.#nodeTooltip = new PlanningNodeTooltip(dom.nodeTooltip);
    this.#fieldView = new PlanningFieldView(
      planning,
      field,
      dom,
      dialogs,
      this.#waypointEditor,
      this.#nodeTooltip,
    );
    this.#pathManager = new PlanningPathManagerView(planning, dom, dialogs);
    this.#sidebar = new PlanningSidebarView(
      planning,
      dom,
      dialogs,
      drag,
      this.#waypointEditor,
      settings,
    );
    this.#timeline = new PlanningTimelineView(
      planning,
      dom,
      dialogs,
      drag,
      this.#waypointEditor,
      this.#nodeTooltip,
    );
  }

  get overlayVisible(): boolean {
    return this.planning.overlayVisible;
  }

  editSelection(): boolean {
    const selection = this.planning.selection;
    const node = selection.selectedNode;
    const method = selection.selectedMethod;
    if (selection.primaryWaypointIndex >= 0)
      void this.#waypointEditor.edit(selection.primaryWaypointIndex);
    else if (node)
      void editPlanningNode(this.planning, this.dialogs, node.id);
    else if (method)
      void this.#sidebar.editMethod(method.objectId, method.methodId);
    else return false;
    return true;
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
    this.planning.events.documentPreviewChanged.subscribe(({ kind }) => {
      if (kind !== "route") {
        this.render();
        return;
      }
      if (this.#routePreviewFrame !== null) return;
      this.#routePreviewFrame = requestAnimationFrame(() => {
        this.#routePreviewFrame = null;
        this.#sidebar.updateWaypointPositions();
        requestDrawAll();
      });
    });
    this.planning.events.selectionChanged.subscribe(() => {
      this.#sidebar.updateSelection();
      this.#timeline.updateSelection();
      this.updateLatestPill();
      requestDrawAll();
    });
    this.planning.events.projectionChanged.subscribe(({ kind }) => {
      if (kind === "preview-ready" || kind === "preview-pending") {
        this.updateTimePill();
        requestDrawAll();
        return;
      }
      this.#timeline.render();
      this.updateTimePill();
      this.updateLatestPill();
      requestDrawAll();
    });
    this.planning.events.playbackChanged.subscribe(() => {
      this.updateTimePill();
      this.dom.pointPill.textContent = `Points: ${this.planning.route.length}`;
      this.#sidebar.updatePlayback();
      this.#timeline.draw();
      this.updateLatestPill();
      requestDrawAll();
    });
  }

  render(): void {
    if (this.#routePreviewFrame !== null)
      cancelAnimationFrame(this.#routePreviewFrame);
    this.#routePreviewFrame = null;
    this.#pathManager.render();
    this.#sidebar.render();
    this.#timeline.render();
    this.updateTimePill();
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
  drawSelection(): void {
    this.#fieldView.drawSelection();
  }

  setFieldNodesVisible(visible: boolean): void {
    this.#fieldView.setNodesVisible(visible);
  }

  currentPose(): FieldPose | null {
    return this.planning.playback.pose;
  }

  private updateTimePill(): void {
    const projection = this.planning.projection;
    const status = projection.pending
      ? " · Updating preview…"
      : projection.error
        ? ` · ${projection.error}`
        : !projection.simulation.complete
          ? " · Preview incomplete"
          : "";
    this.dom.timePill.textContent = `Plan: ${this.planning.playback.time.toFixed(1)} / ${projection.duration.toFixed(1)} s${status}`;
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
