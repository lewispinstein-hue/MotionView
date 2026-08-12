import removeIconUrl from "../../assets/svg/planning/removePlanningObject.svg?url";
import colorIconUrl from "../../assets/svg/planning/changeObjectColor.svg?url";
import { requestDrawAll } from "../../render/renderScheduler";
import { setStatus } from "../../app/status";
import { currentUnitsToInches, formatDistanceFromInches } from "../../shared/units";
import { planningTelemetry } from "../../telemetry/createTelemetry";
import type { PlanningDialogs } from "../PlanningDialogs";
import type { PlanningDom } from "../PlanningDom";
import type { PlanningFeature } from "../PlanningFeature";
import { getPlanNodeEffectiveMethod } from "../planningObjects";
import { buildPlanExportCode, getUtf8ByteLength } from "../planningTemplate";
import { getContrastTextColor, getDefaultPlanObjectColor, getDefaultPlanObjectName } from "../planningState";
import type { PlanningDragCoordinator } from "./PlanningDragCoordinator";

function icon(url: string, id: string): string { return `${url}#${id}`; }
function format(value: unknown, decimals = 2): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toFixed(decimals).replace(/\.?0+$/, "");
}

export class PlanningSidebarView {
  #editingObjectId: string | null = null;
  #selectObjectName = false;
  #openColorObjectId: string | null = null;
  #bound = false;

  constructor(
    private readonly planning: PlanningFeature,
    private readonly dom: PlanningDom,
    private readonly dialogs: PlanningDialogs,
    private readonly drag: PlanningDragCoordinator,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.dom.addObject.addEventListener("click", () => void this.addObject());
    this.dom.editTemplate.addEventListener("click", () => void this.editTemplate());
    this.dom.copyCode.addEventListener("click", () => void this.copyCode());
    this.bindSelectionField(this.dom.selectedX, "x");
    this.bindSelectionField(this.dom.selectedY, "y");
    this.bindSelectionField(this.dom.selectedTheta, "theta");
    this.bindSelectionField(this.dom.selectedSpeed, "speed");
    document.addEventListener("mousedown", (event) => {
      if (!this.#openColorObjectId || !(event.target instanceof Element) || event.target.closest(".planObjectColorWrap")) return;
      this.#openColorObjectId = null;
      this.renderObjects();
    }, true);
  }

  render(): void {
    this.renderWaypoints();
    this.renderObjects();
    this.renderSelection();
  }

  renderWaypoints(): void {
    this.dom.list.replaceChildren();
    this.dom.count.textContent = String(this.planning.route.length);
    this.dom.copyCode.disabled = this.planning.route.length === 0;
    this.planning.route.waypoints.forEach((point, index) => {
      const row = document.createElement("div");
      row.className = `planItem${this.planning.selection.isWaypointSelected(index) ? " selected" : ""}`;
      row.dataset.idx = String(index);
      row.innerHTML = `<div class="muted">#${index + 1}</div><div>X: ${formatDistanceFromInches(point.x, 2)}  Y: ${formatDistanceFromInches(point.y, 2)}  θ: ${format(point.theta, 1)}°  S: ${format(point.speed, 0)}</div>`;
      row.addEventListener("click", (event) => {
        if (event.shiftKey) this.planning.selection.toggleWaypoint(index);
        else this.planning.selection.selectWaypoint(index);
      });
      this.dom.list.appendChild(row);
    });
  }

  renderSelection(): void {
    const point = this.planning.selection.selectedWaypoint;
    const inputs = [this.dom.selectedX, this.dom.selectedY, this.dom.selectedTheta, this.dom.selectedSpeed];
    if (!point) {
      this.dom.selectedIndex.textContent = "—";
      for (const input of inputs) { input.value = ""; input.disabled = true; }
      return;
    }
    this.dom.selectedIndex.textContent = `#${this.planning.selection.primaryWaypointIndex + 1}`;
    for (const input of inputs) input.disabled = false;
    if (inputs.includes(document.activeElement as HTMLInputElement)) return;
    this.dom.selectedX.value = formatDistanceFromInches(point.x, 2);
    this.dom.selectedY.value = formatDistanceFromInches(point.y, 2);
    this.dom.selectedTheta.value = format(point.theta, 1);
    this.dom.selectedSpeed.value = format(point.speed, 0);
  }

  renderObjects(): void {
    this.dom.objectList.replaceChildren();
    const selectedNode = this.planning.selection.selectedNode;
    this.planning.objects.items.forEach((object, objectIndex) => {
      const card = document.createElement("article");
      card.className = `planObjectCard${selectedNode?.objectId === object.id ? " isHighlighted" : ""}`;
      card.dataset.objectId = object.id;
      const header = document.createElement("div");
      header.className = "planObjectHeader";
      const meta = document.createElement("div");
      meta.className = "planObjectMeta";
      if (this.#editingObjectId === object.id) {
        const input = document.createElement("input");
        input.className = "planObjectNameEditor";
        input.value = object.name;
        input.addEventListener("blur", () => this.commitObjectName(object.id, input.value));
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") this.commitObjectName(object.id, input.value);
          else if (event.key === "Escape") { this.#editingObjectId = null; this.renderObjects(); }
        });
        meta.appendChild(input);
        requestAnimationFrame(() => { input.focus(); if (this.#selectObjectName) input.select(); });
      } else {
        const name = document.createElement("div");
        name.className = "planObjectName";
        name.textContent = object.name || getDefaultPlanObjectName(objectIndex);
        name.addEventListener("dblclick", () => { this.#editingObjectId = object.id; this.#selectObjectName = true; this.renderObjects(); });
        meta.appendChild(name);
      }
      const subtle = document.createElement("div");
      subtle.className = "planObjectSubtle";
      subtle.textContent = `${object.methods.length} method${object.methods.length === 1 ? "" : "s"}`;
      meta.appendChild(subtle);
      header.appendChild(meta);
      const latest = document.createElement("div");
      latest.className = "planObjectLatest";
      latest.innerHTML = `<span class="planObjectLatestLabel">Latest</span><span class="planObjectLatestValue">${this.latestMethodName(object.id)}</span>`;
      header.appendChild(latest);
      card.appendChild(header);
      const methods = document.createElement("div");
      methods.className = "planMethodList";
      if (!object.methods.length) methods.innerHTML = `<div class="planMethodEmpty">No methods yet.</div>`;
      object.methods.forEach((method, methodIndex) => {
        const methodCard = document.createElement("div");
        methodCard.className = `planMethodCard${selectedNode?.objectId === object.id && selectedNode.methodId === method.id ? " isHighlighted" : ""}`;
        methodCard.dataset.objectId = object.id;
        methodCard.dataset.methodId = method.id;
        methodCard.innerHTML = `<div class="planMethodGrip" aria-hidden="true">⋮⋮</div><div class="planMethodIndex">${methodIndex + 1}</div><div class="planMethodContent"><div class="planMethodName"></div><div class="planMethodCode"></div></div><button class="iconBtn planMethodRemoveBtn" type="button" title="Remove Method"><svg width="30" height="30"><use href="${icon(removeIconUrl, "icon-removePlanningObject")}"></use></svg></button>`;
        methodCard.querySelector<HTMLElement>(".planMethodName")!.textContent = method.name;
        methodCard.querySelector<HTMLElement>(".planMethodCode")!.textContent = method.code;
        methodCard.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".planMethodRemoveBtn"))) return;
          this.drag.begin({ source: "sidebar", objectId: object.id, methodId: method.id, sourceElement: methodCard, startX: event.clientX, startY: event.clientY });
        });
        methodCard.addEventListener("dblclick", (event) => {
          if (!(event.target instanceof Element) || !event.target.closest(".planMethodRemoveBtn")) void this.editMethod(object.id, method.id);
        });
        methodCard.querySelector(".planMethodRemoveBtn")?.addEventListener("click", () => void this.removeMethod(object.id, method.id));
        methods.appendChild(methodCard);
      });
      card.appendChild(methods);
      const actions = document.createElement("div");
      actions.className = "planObjectActions";
      actions.innerHTML = `<button class="iconBtn secondaryBtn planMethodAddBtn" type="button">Add Method</button><div class="planObjectActionTools"><div class="planObjectColorWrap"><button class="iconBtn secondaryBtn planObjectColorBtn" type="button" style="color:${object.color}"><svg width="30" height="30"><use href="${icon(colorIconUrl, "icon-planningChangeObjectColor")}"></use></svg></button><div class="planObjectColorPopover${this.#openColorObjectId === object.id ? "" : " hidden"}"><input class="planObjectColorInput" type="color" value="${object.color}" /></div></div></div><button class="iconBtn secondaryBtn planObjectRemoveActionBtn" type="button"><svg width="30" height="30"><use href="${icon(removeIconUrl, "icon-removePlanningObject")}"></use></svg></button>`;
      actions.querySelector(".planMethodAddBtn")?.addEventListener("click", () => void this.addMethod(object.id));
      actions.querySelector(".planObjectRemoveActionBtn")?.addEventListener("click", () => void this.removeObject(object.id));
      actions.querySelector(".planObjectColorBtn")?.addEventListener("click", () => { this.#openColorObjectId = this.#openColorObjectId === object.id ? null : object.id; this.renderObjects(); });
      actions.querySelector<HTMLInputElement>(".planObjectColorInput")?.addEventListener("input", (event) => {
        const color = (event.target as HTMLInputElement).value;
        this.planning.objects.setColor(object.id, color);
      });
      card.appendChild(actions);
      card.style.setProperty("--plan-object-color", object.color || getDefaultPlanObjectColor(objectIndex));
      card.style.color = getContrastTextColor(object.color);
      this.dom.objectList.appendChild(card);
    });
  }

  updatePlayback(): void {
    for (const card of this.dom.objectList.querySelectorAll<HTMLElement>(".planObjectCard[data-object-id]")) {
      const value = card.querySelector<HTMLElement>(".planObjectLatestValue");
      if (value) value.textContent = this.latestMethodName(card.dataset.objectId ?? "");
    }
  }

  private bindSelectionField(input: HTMLInputElement, field: "x" | "y" | "theta" | "speed"): void {
    input.addEventListener("focus", () => this.planning.history.begin("route"));
    input.addEventListener("input", () => {
      const index = this.planning.selection.primaryWaypointIndex;
      const point = this.planning.selection.selectedWaypoint;
      if (!point || index < 0) return;
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) return;
      const value = field === "x" || field === "y" ? currentUnitsToInches(raw) : raw;
      if (field === "x" || field === "y") {
        const constrained = this.planning.projection.constrain({ ...point, [field]: value });
        this.planning.route.updateField(index, field, constrained[field]);
      } else if (field === "theta") this.planning.route.updateField(index, field, this.planning.projection.constrainTheta(value));
      else this.planning.route.updateField(index, field, Math.max(-127, Math.min(127, value)));
      requestDrawAll();
    });
    input.addEventListener("blur", () => this.planning.history.commit());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
      else if (event.key === "Escape") { event.preventDefault(); this.planning.history.cancel(); input.blur(); }
    });
  }

  private async addObject(): Promise<void> {
    const defaultName = getDefaultPlanObjectName(this.planning.objects.length);
    const result = await this.dialogs.edit({
      title: "Add Object",
      subtitle: "Create a new Planning object.",
      groupTitle: "Object",
      description: "Enter an object name.",
      nameDescription: "Object name",
      name: defaultName,
      code: "",
      showCode: false,
      confirmLabel: "Create",
    });
    if (!result) return;
    this.planning.objects.add({ name: result.name });
    void planningTelemetry.objectCreated(this.planning.telemetryProperties());
  }

  private async removeObject(id: string): Promise<void> {
    const object = this.planning.objects.get(id);
    if (!object) return;
    if (object.methods.length && !await this.dialogs.confirm({ message: `Are you sure you want to remove Object ${object.name}?` })) return;
    const nodes = this.planning.timeline.nodes.filter((node) => node.objectId === id).length;
    this.planning.objects.remove(id);
    void planningTelemetry.objectRemoved(this.planning.telemetryProperties({ removed_methods: object.methods.length, removed_nodes: nodes }));
  }

  private async addMethod(objectId: string): Promise<void> {
    const object = this.planning.objects.get(objectId);
    if (!object) return;
    const result = await this.dialogs.edit({ title: "Add Method", subtitle: `Create a new method for ${object.name}.`, groupTitle: "Method", description: "Enter a method name and optional code.", name: "", code: "" });
    if (!result) return;
    this.planning.objects.addMethod(objectId, result);
    void planningTelemetry.methodCreated(this.planning.telemetryProperties({ method_code_chars: result.code.length, method_code_bytes: getUtf8ByteLength(result.code) }));
  }

  private async editMethod(objectId: string, methodId: string): Promise<void> {
    const method = this.planning.objects.method(objectId, methodId);
    if (!method) return;
    const previousName = method.name;
    const previousCode = method.code;
    const result = await this.dialogs.edit({ title: "Edit Method", groupTitle: "Method", name: method.name, code: method.code });
    if (!result || (result.name === previousName && result.code === previousCode)) return;
    this.planning.objects.updateMethod(objectId, methodId, result);
    void planningTelemetry.methodUpdated(this.planning.telemetryProperties({ method_name_changed: result.name !== previousName, method_code_changed: result.code !== previousCode, method_code_chars: result.code.length, method_code_bytes: getUtf8ByteLength(result.code) }));
  }

  private async removeMethod(objectId: string, methodId: string): Promise<void> {
    const method = this.planning.objects.method(objectId, methodId);
    if (!method) return;
    const nodes = this.planning.timeline.nodes.filter((node) => node.objectId === objectId && node.methodId === methodId).length;
    if (nodes && !await this.dialogs.confirm({ message: `Remove ${method.name} and ${nodes} placed node${nodes === 1 ? "" : "s"}?` })) return;
    this.planning.objects.removeMethod(objectId, methodId);
    void planningTelemetry.methodRemoved(this.planning.telemetryProperties({ removed_nodes: nodes }));
  }

  private async editTemplate(): Promise<void> {
    const previous = this.planning.exportTemplate;
    const result = await this.dialogs.edit({ title: "Edit Template", groupTitle: "Planning Export Template", description: "Available placeholders: ${x}, ${y}, ${theta}, ${distance}, ${iteration}, and ${speed}.", code: previous, placeholder: "moveToPoint(${x}, ${y}, ${theta});" });
    if (!result) return;
    this.planning.setExportTemplate(result.code);
    void planningTelemetry.templateUpdated(this.planning.telemetryProperties({ template_changed: previous !== this.planning.exportTemplate, template_bytes: getUtf8ByteLength(this.planning.exportTemplate) }));
  }

  private async copyCode(): Promise<void> {
    const data = this.planning.exportData();
    const code = buildPlanExportCode({
      template: data.template,
      waypoints: data.waypoints,
      nodes: data.nodes,
      objects: data.objects,
      readPlanSpeed: (value) => Number.isFinite(Number(value)) ? Number(value) : 127,
      formatTemplateNumber: (value, decimals = 3) => format(value, decimals),
      planThetaDegAt: (index) => Number(data.waypoints[index]?.theta) || 0,
      getSortedPlanNodes: () => [...data.nodes].sort((a, b) => a.beforeWaypoint - b.beforeWaypoint || a.index - b.index),
    });
    if (!code) {
      setStatus("Add at least one waypoint and a template before copying code.");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setStatus(`Copied generated code for ${data.waypoints.length} waypoint${data.waypoints.length === 1 ? "" : "s"}.`);
      void planningTelemetry.templateExported(this.planning.telemetryProperties({ export_surface: "clipboard", exported_chars: code.length, exported_bytes: getUtf8ByteLength(code) }));
    } catch (error) {
      setStatus(`Failed to copy code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private commitObjectName(id: string, name: string): void {
    this.planning.objects.rename(id, name.trim() || getDefaultPlanObjectName(this.planning.objects.items.findIndex((object) => object.id === id)));
    this.#editingObjectId = null;
  }

  private latestMethodName(objectId: string): string {
    let latest = "—";
    for (const placement of this.planning.projection.nodePlacements) {
      if (placement.node.objectId !== objectId || placement.distance > this.planning.playback.distance) continue;
      latest = getPlanNodeEffectiveMethod(this.planning.objects.items, placement.node)?.name || "—";
    }
    return latest;
  }
}
