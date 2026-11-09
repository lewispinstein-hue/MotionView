import removeIconSvg from "../../assets/svg/planning/removePlanningObject.svg?raw";
import colorIconSvg from "../../assets/svg/planning/changeObjectColor.svg?raw";
import { requestDrawAll } from "../../render/renderScheduler";
import { setStatus } from "../../app/status";
import type { SettingsFeature } from "../../app/settings/SettingsFeature";
import {
  currentUnitsToInches,
  formatDistanceFromInches,
} from "../../shared/units";
import { planningTelemetry } from "../../telemetry/createTelemetry";
import type { PlanningDialogs } from "../PlanningDialogs";
import type { PlanningDom } from "../PlanningDom";
import type { PlanningFeature } from "../PlanningFeature";
import type { PlanningWaypointView } from "../planningTypes";
import { getPlanNodeEffectiveMethod } from "../planningObjects";
import { isBoomerangWaypoint } from "../planningMotionContext";
import { planningMotionTypeForLibrary, supportsPlanningMinSpeed } from "../planningTemplateCapabilities";
import {
  createWaypointIndicatorIcon,
  orderWaypointIndicatorIcons,
} from "../planningIndicators";
import { generatePlanningCode } from "../planningCode";
import {
  getContrastTextColor,
  getDefaultPlanObjectColor,
  getDefaultPlanObjectName,
} from "../planningState";
import type { PlanningDragCoordinator } from "./PlanningDragCoordinator";
import type { PlanningWaypointEditor } from "../PlanningWaypointEditor";
import { animateVerticalReorder, captureVerticalPositions } from "./verticalReorderAnimation";

function icon(svg: string): string {
  return svg.replace(
    "<svg ",
    '<svg width="30" height="30" aria-hidden="true" focusable="false" ',
  );
}
function format(value: unknown, decimals = 2): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const fixed = number.toFixed(decimals);
  return decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
}

const METHOD_TEMPLATE_DESCRIPTION =
  "Available placeholders: ${x}, ${y}, ${theta}, ${distance}, ${iteration}, ${speed}, ${minSpeed} (@minspd), ${forwards}, ${lead} (@ld), and ${lockedDriveSide} (@side)";

interface ActiveMethodReorder {
  readonly objectId: string;
  readonly methodId: string;
  readonly sourceElement: HTMLElement;
  readonly methodsElement: HTMLElement;
  readonly startX: number;
  readonly startY: number;
  ghost: HTMLElement | null;
  started: boolean;
  dropIndex: number | null;
}

interface MethodOrderAnimation {
  readonly objectId: string;
  readonly positions: ReadonlyMap<string, number>;
}

export class PlanningSidebarView {
  #editingObjectId: string | null = null;
  #openColorObjectId: string | null = null;
  #copySuccessTimer: number | null = null;
  #activeMethodReorder: ActiveMethodReorder | null = null;
  #methodOrderAnimation: MethodOrderAnimation | null = null;
  #bound = false;

  constructor(
    private readonly planning: PlanningFeature,
    private readonly dom: PlanningDom,
    private readonly dialogs: PlanningDialogs,
    private readonly drag: PlanningDragCoordinator,
    private readonly waypointEditor: PlanningWaypointEditor,
    private readonly settings: SettingsFeature,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.dom.addObject.addEventListener("click", () => void this.addObject());
    this.dom.editTemplate.addEventListener(
      "click",
      () => void this.editTemplate(),
    );
    this.dom.editWaypoint.addEventListener("click", () => {
      const index = this.planning.selection.primaryWaypointIndex;
      if (index >= 0) void this.waypointEditor.edit(index);
    });
    this.dom.copyCode.addEventListener("click", () => void this.copyCode());
    this.bindSelectionField(this.dom.selectedX, "x");
    this.bindSelectionField(this.dom.selectedY, "y");
    this.bindSelectionField(this.dom.selectedTheta, "theta");
    this.bindSelectionField(this.dom.selectedMinSpeed, "minSpeed");
    this.bindSelectionField(this.dom.selectedSpeed, "speed");
    const releaseSidebarScroll = () =>
      this.dom.objectList.closest("#rightPlanning")?.classList.remove("isMethodDragging");
    document.addEventListener(
      "mousedown",
      (event) => {
        if (
          !this.#openColorObjectId ||
          !(event.target instanceof Element) ||
          event.target.closest(".planObjectColorWrap")
        )
          return;
        this.#openColorObjectId = null;
        this.renderObjects();
      },
      true,
    );
    window.addEventListener("pointermove", (event) =>
      this.moveMethodReorder(event),
    );
    window.addEventListener("pointerup", () => {
      releaseSidebarScroll();
      this.finishMethodReorder();
    });
    const cancelDrag = () => {
      releaseSidebarScroll();
      this.cancelMethodReorder();
    };
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("blur", cancelDrag);
  }

  render(): void {
    this.renderWaypoints();
    this.renderObjects();
    this.renderSelection();
  }

  renderWaypoints(): void {
    this.dom.list.replaceChildren();
    this.dom.copyCode.disabled = this.planning.route.length < 2;
    this.dom.exportCode.disabled = this.planning.route.length < 2;
    this.planning.route.waypoints.forEach((point, index) => {
      const row = document.createElement("div");
      row.className = `planItem${this.planning.selection.isWaypointSelected(index) ? " selected" : ""}`;
      row.dataset.idx = String(index);
      const number = document.createElement("div");
      number.className = "muted";
      number.textContent = `#${index + 1}`;
      const details = document.createElement("div");
      details.textContent = this.waypointDetails(point);
      const indicators = document.createElement("div");
      indicators.className =
        "waypointIndicatorStrip waypointIndicatorStripSmall";
      this.appendWaypointIndicators(
        indicators,
        point,
        "waypointIndicatorIconSmall",
      );
      row.append(number, details, indicators);
      row.addEventListener("click", (event) => {
        if (event.shiftKey) this.planning.selection.toggleWaypoint(index);
        else this.planning.selection.selectWaypoint(index);
      });
      row.addEventListener("dblclick", (event) => {
        event.preventDefault();
        this.planning.selection.selectWaypoint(index);
        void this.waypointEditor.edit(index);
      });
      this.dom.list.appendChild(row);
    });
  }

  updateSelection(): void {
    for (const row of this.dom.list.querySelectorAll<HTMLElement>(".planItem"))
      row.classList.toggle("selected", this.planning.selection.isWaypointSelected(Number(row.dataset.idx)));
    this.updateObjectSelection();
    this.renderSelection();
  }

  /** Position-only previews keep list rows, objects, and method DOM intact. */
  updateWaypointPositions(): void {
    const rows = this.dom.list.querySelectorAll<HTMLElement>(".planItem");
    if (rows.length !== this.planning.route.length) {
      this.renderWaypoints();
    } else {
      rows.forEach((row, index) => {
        const details = row.children[1]!;
        const text = this.waypointDetails(this.planning.route.waypoints[index]!);
        if (details.textContent !== text) details.textContent = text;
      });
    }
    this.renderSelection();
  }

  private waypointDetails(point: PlanningWaypointView): string {
    return `X: ${formatDistanceFromInches(point.x, 2)}  Y: ${formatDistanceFromInches(point.y, 2)}  θ: ${format(point.theta, 1)}°  S: ${format(point.speed, 0)}`;
  }

  renderSelection(): void {
    const point = this.planning.selection.selectedWaypoint;
    const inputs = [
      this.dom.selectedX,
      this.dom.selectedY,
      this.dom.selectedTheta,
      this.dom.selectedMinSpeed,
      this.dom.selectedSpeed,
    ];
    if (!point) {
      this.dom.selectedIndicators.replaceChildren();
      this.dom.editWaypoint.disabled = true;
      for (const input of inputs) {
        input.value = "";
        input.disabled = true;
      }
      return;
    }
    this.dom.selectedIndicators.replaceChildren();
    this.appendWaypointIndicators(
      this.dom.selectedIndicators,
      point,
    );
    this.dom.editWaypoint.disabled = false;
    for (const input of inputs) input.disabled = false;
    const minSpeedSupported = !["ez-template", "vexcode"].includes(this.planning.simulationConfiguration.previewModel) &&
      (point.motions?.map(motion => motion.type) ??
      [isBoomerangWaypoint(point) ? "boomerang" as const : "forward" as const])
      .some(type => supportsPlanningMinSpeed(this.planning.templateConfiguration.library, type));
    this.dom.selectedMinSpeed.disabled = !minSpeedSupported;
    this.dom.selectedMinSpeed.title = minSpeedSupported
      ? "Minimum motion power (0–127). Use ${minSpeed} or @minspd in templates."
      : this.planning.simulationConfiguration.previewModel === "ez-template"
        ? "Minimum speed is not supported by the EZ-Template simulation model."
        : this.planning.simulationConfiguration.previewModel === "vexcode"
          ? "Minimum speed is not supported by the VEXcode simulation model."
        : "Minimum speed is not supported by this template preset's selected motions.";
    const values = [formatDistanceFromInches(point.x, 2), formatDistanceFromInches(point.y, 2),
      format(point.theta, 1), format(point.minSpeed ?? 0, 0), format(point.speed, 0)];
    inputs.forEach((input, index) => {
      if (input !== document.activeElement) input.value = values[index]!;
    });
  }

  private appendWaypointIndicators(
    target: HTMLElement,
    point: PlanningWaypointView,
    className = "",
  ): void {
    const icons = point.motions?.map((motion) => motion.type)
      ?? orderWaypointIndicatorIcons(point.indicatorIcons ?? []);
    if (!icons.length) icons.push(isBoomerangWaypoint(point) ? "boomerang" : "forward");
    for (const indicator of icons)
      target.appendChild(createWaypointIndicatorIcon(planningMotionTypeForLibrary(indicator, this.planning.templateConfiguration.library), className));
  }

  renderObjects(): void {
    this.dom.objectList.replaceChildren();
    const saved = this.settings.current.layoutPlanningCollapsedObjectIds;
    const collapsedObjects = new Set(
      Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [],
    );
    this.planning.objects.items.forEach((object, objectIndex) => {
      const card = document.createElement("article");
      card.className = "planObjectCard";
      card.dataset.objectId = object.id;
      const header = document.createElement("div");
      header.className = "planObjectHeader";
      const collapse = document.createElement("button");
      collapse.type = "button";
      collapse.className = "planObjectCollapse";
      const body = document.createElement("div");
      body.className = "planObjectBody";
      const updateCollapsed = () => {
        const collapsed = collapsedObjects.has(object.id);
        body.hidden = collapsed;
        collapse.setAttribute("aria-expanded", String(!collapsed));
        collapse.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${object.name}`);
      };
      collapse.addEventListener("click", () => {
        if (!collapsedObjects.delete(object.id)) collapsedObjects.add(object.id);
        this.settings.update({ layoutPlanningCollapsedObjectIds: [...collapsedObjects] });
        updateCollapsed();
      });
      updateCollapsed();
      const swatch = document.createElement("span");
      swatch.className = "planObjectSwatch";
      swatch.title = "Object color";
      header.append(collapse, swatch);
      const meta = document.createElement("div");
      meta.className = "planObjectMeta";
      if (this.#editingObjectId === object.id) {
        const input = document.createElement("input");
        input.className = "planObjectNameEditor";
        input.value = object.name;
        input.addEventListener("blur", () =>
          this.commitObjectName(object.id, input.value),
        );
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            this.commitObjectName(object.id, input.value);
          } else if (event.key === "Escape") {
            this.#editingObjectId = null;
            this.renderObjects();
          }
        });
        meta.appendChild(input);
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      } else {
        const name = document.createElement("div");
        name.className = "planObjectName";
        name.textContent = object.name || getDefaultPlanObjectName(objectIndex);
        name.addEventListener("dblclick", () => {
          this.#editingObjectId = object.id;
          this.renderObjects();
        });
        meta.appendChild(name);
      }
      const subtle = document.createElement("div");
      subtle.className = "planObjectSubtle";
      subtle.textContent = `${object.methods.length} method${object.methods.length === 1 ? "" : "s"}`;
      meta.appendChild(subtle);
      header.appendChild(meta);
      const latest = document.createElement("div");
      latest.className = "planObjectLatest";
      const latestLabel = document.createElement("span");
      latestLabel.className = "planObjectLatestLabel";
      latestLabel.textContent = "Latest";
      const latestValue = document.createElement("span");
      latestValue.className = "planObjectLatestValue";
      latestValue.textContent = this.latestMethodName(object.id);
      latest.append(latestLabel, latestValue);
      header.appendChild(latest);
      card.appendChild(header);
      const methods = document.createElement("div");
      methods.className = "planMethodList";
      methods.dataset.objectId = object.id;
      if (!object.methods.length)
        methods.innerHTML = `<div class="planMethodEmpty">No methods yet.</div>`;
      object.methods.forEach((method, methodIndex) => {
        const methodCard = document.createElement("div");
        methodCard.className = "planMethodCard";
        methodCard.dataset.objectId = object.id;
        methodCard.dataset.methodId = method.id;
        methodCard.innerHTML = `<div class="planMethodGrip" aria-hidden="true">⋮⋮</div><div class="planMethodIndex">${methodIndex + 1}</div><div class="planMethodContent"><div class="planMethodName"></div><div class="planMethodCode"></div></div><button class="iconBtn planMethodRemoveBtn" type="button" title="Remove Method">${icon(removeIconSvg)}</button>`;
        methodCard.querySelector<HTMLElement>(".planMethodName")!.textContent =
          method.name;
        methodCard.querySelector<HTMLElement>(".planMethodCode")!.textContent =
          method.code;
        methodCard.addEventListener("pointerdown", (event) => {
          if (
            event.button !== 0 ||
            (event.target instanceof Element &&
              event.target.closest(".planMethodRemoveBtn"))
          )
            return;
          event.preventDefault();
          this.dom.objectList.closest("#rightPlanning")?.classList.add("isMethodDragging");
          this.beginMethodReorder({
            objectId: object.id,
            methodId: method.id,
            sourceElement: methodCard,
            methodsElement: methods,
            startX: event.clientX,
            startY: event.clientY,
          });
        });
        methodCard.addEventListener("dblclick", (event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest(".planMethodRemoveBtn")
          )
            void this.editMethod(object.id, method.id);
        });
        methodCard.addEventListener("click", (event) => {
          if (
            !(event.target instanceof Element) ||
            event.target.closest(".planMethodRemoveBtn")
          )
            return;
          this.planning.selection.selectMethod(object.id, method.id);
        });
        methodCard
          .querySelector(".planMethodRemoveBtn")
          ?.addEventListener(
            "click",
            () => void this.removeMethod(object.id, method.id),
          );
        methods.appendChild(methodCard);
      });
      const actions = document.createElement("div");
      actions.className = "planObjectActions";
      const addMethod = document.createElement("button");
      addMethod.className = "iconBtn secondaryBtn planMethodAddBtn";
      addMethod.type = "button";
      addMethod.textContent = "Add Method";
      addMethod.addEventListener("click", () => void this.addMethod(object.id));

      const actionTools = document.createElement("div");
      actionTools.className = "planObjectActionTools";
      const colorWrap = document.createElement("div");
      colorWrap.className = "planObjectColorWrap";
      const colorButton = document.createElement("button");
      colorButton.className = "iconBtn secondaryBtn planObjectColorBtn";
      colorButton.type = "button";
      colorButton.style.color = object.color;
      colorButton.innerHTML = icon(colorIconSvg);
      colorButton.addEventListener("click", () => {
        this.#openColorObjectId =
          this.#openColorObjectId === object.id ? null : object.id;
        this.renderObjects();
      });
      const colorPopover = document.createElement("div");
      colorPopover.className = `planObjectColorPopover${this.#openColorObjectId === object.id ? "" : " hidden"}`;
      const colorInput = document.createElement("input");
      colorInput.className = "planObjectColorInput";
      colorInput.type = "color";
      colorInput.value = object.color;
      colorInput.addEventListener("input", (event) => {
        const color = (event.target as HTMLInputElement).value;
        this.planning.objects.setColor(object.id, color);
      });
      colorPopover.appendChild(colorInput);
      colorWrap.append(colorButton, colorPopover);
      actionTools.appendChild(colorWrap);

      const removeObject = document.createElement("button");
      removeObject.className = "iconBtn secondaryBtn planObjectRemoveActionBtn";
      removeObject.type = "button";
      removeObject.innerHTML = icon(removeIconSvg);
      removeObject.addEventListener(
        "click",
        () => void this.removeObject(object.id),
      );
      actions.append(addMethod, actionTools, removeObject);
      body.append(methods, actions);
      card.appendChild(body);
      card.style.setProperty(
        "--plan-object-color",
        object.color || getDefaultPlanObjectColor(objectIndex),
      );
      card.style.color = getContrastTextColor(object.color);
      this.dom.objectList.appendChild(card);
    });
    this.updateObjectSelection();
    this.animateMethodReorder();
  }

  private updateObjectSelection(): void {
    const selection = this.planning.selection;
    const selectedNodes = this.planning.timeline.nodes.filter(
      (node) => selection.selectedNodeIds.has(node.id),
    );
    for (const card of this.dom.objectList.querySelectorAll<HTMLElement>(".planObjectCard")) {
      const objectId = card.dataset.objectId!;
      const selectedMethods = new Set(selectedNodes
        .filter((node) => node.objectId === objectId)
        .map((node) => node.methodId));
      card.classList.toggle("isHighlighted",
        selectedMethods.size > 0 || selection.selectedMethod?.objectId === objectId);
      for (const method of card.querySelectorAll<HTMLElement>(".planMethodCard")) {
        const methodId = method.dataset.methodId!;
        method.classList.toggle("isHighlighted",
          selectedMethods.has(methodId) || selection.isMethodSelected(objectId, methodId));
      }
    }
  }

  updatePlayback(): void {
    for (const card of this.dom.objectList.querySelectorAll<HTMLElement>(
      ".planObjectCard[data-object-id]",
    )) {
      const value = card.querySelector<HTMLElement>(".planObjectLatestValue");
      if (value)
        value.textContent = this.latestMethodName(card.dataset.objectId ?? "");
    }
  }

  private beginMethodReorder(
    drag: Omit<ActiveMethodReorder, "ghost" | "started" | "dropIndex">,
  ): void {
    this.cancelMethodReorder();
    this.#activeMethodReorder = {
      ...drag,
      ghost: null,
      started: false,
      dropIndex: null,
    };
  }

  private moveMethodReorder(event: PointerEvent): void {
    const drag = this.#activeMethodReorder;
    if (!drag) return;
    if (
      !drag.started &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4
    )
      return;
    if (!drag.started) {
      drag.started = true;
      drag.sourceElement.classList.add("isDragging");
      drag.ghost = this.createMethodReorderGhost(drag.sourceElement);
      document.body.appendChild(drag.ghost);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }
    if (drag.ghost) {
      drag.ghost.style.left = `${event.clientX + 12}px`;
      drag.ghost.style.top = `${event.clientY + 12}px`;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (target && drag.methodsElement.contains(target)) {
      this.updateMethodReorderDrop(drag, event.clientY);
      return;
    }
    this.clearMethodReorderDrop(drag);
    if (target && this.dom.timelineViewport.contains(target))
      this.handoffMethodDrag(drag);
  }

  private finishMethodReorder(): void {
    const drag = this.#activeMethodReorder;
    if (!drag) return;
    if (drag.started && drag.dropIndex !== null) {
      const positions = this.methodPositions(drag.objectId);
      if (
        this.planning.objects.moveMethod(
          drag.objectId,
          drag.methodId,
          drag.dropIndex,
      )
      ) {
        this.#methodOrderAnimation = { objectId: drag.objectId, positions };
        this.animateMethodReorder();
      }
    }
    this.cancelMethodReorder();
  }

  private cancelMethodReorder(): void {
    const drag = this.#activeMethodReorder;
    if (!drag) return;
    drag.sourceElement.classList.remove("isDragging");
    drag.ghost?.remove();
    this.clearMethodReorderDrop(drag);
    this.#activeMethodReorder = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  private handoffMethodDrag(drag: ActiveMethodReorder): void {
    this.cancelMethodReorder();
    this.drag.begin({
      source: "sidebar",
      objectId: drag.objectId,
      methodId: drag.methodId,
      sourceElement: drag.sourceElement,
      startX: drag.startX,
      startY: drag.startY,
    });
  }

  private updateMethodReorderDrop(
    drag: ActiveMethodReorder,
    pointerY: number,
  ): void {
    const cards = Array.from(
      drag.methodsElement.querySelectorAll<HTMLElement>(
        ".planMethodCard[data-method-id]",
      ),
    ).filter((card) => card.dataset.methodId !== drag.methodId);
    const nextIndex = cards.findIndex((card) => {
      const rect = card.getBoundingClientRect();
      return pointerY < rect.top + rect.height / 2;
    });
    drag.dropIndex = nextIndex >= 0 ? nextIndex : cards.length;
    const listRect = drag.methodsElement.getBoundingClientRect();
    const anchor =
      nextIndex >= 0 ? cards[nextIndex] : cards[cards.length - 1];
    const anchorRect = anchor?.getBoundingClientRect();
    const top = anchorRect
      ? (nextIndex >= 0 ? anchorRect.top : anchorRect.bottom) - listRect.top
      : 0;
    let line = drag.methodsElement.querySelector<HTMLElement>(
      ".planMethodDropLine",
    );
    if (!line) {
      line = document.createElement("div");
      line.className = "planMethodDropLine";
      line.setAttribute("aria-hidden", "true");
      drag.methodsElement.appendChild(line);
    }
    line.style.top = `${top}px`;
  }

  private clearMethodReorderDrop(drag: ActiveMethodReorder): void {
    drag.dropIndex = null;
    drag.methodsElement.querySelector(".planMethodDropLine")?.remove();
  }

  private createMethodReorderGhost(source: HTMLElement): HTMLElement {
    const ghost = source.cloneNode(true) as HTMLElement;
    const rect = source.getBoundingClientRect();
    ghost.className = "planMethodCard planMethodReorderGhost";
    ghost.removeAttribute("data-object-id");
    ghost.removeAttribute("data-method-id");
    ghost.style.width = `${rect.width}px`;
    return ghost;
  }

  private methodPositions(objectId: string): ReadonlyMap<string, number> {
    return captureVerticalPositions(
      this.dom.objectList.querySelectorAll<HTMLElement>(
        `.planMethodCard[data-object-id="${CSS.escape(objectId)}"]`,
      ),
      "methodId",
    );
  }

  private animateMethodReorder(): void {
    const animation = this.#methodOrderAnimation;
    if (!animation) return;
    this.#methodOrderAnimation = null;
    animateVerticalReorder(
      () => this.dom.objectList.querySelectorAll<HTMLElement>(
        `.planMethodCard[data-object-id="${CSS.escape(animation.objectId)}"]`,
      ),
      "methodId",
      animation.positions,
    );
  }

  private bindSelectionField(
    input: HTMLInputElement,
    field: "x" | "y" | "theta" | "minSpeed" | "speed",
  ): void {
    // Tracks whether the transaction currently open was the one this field's
    // own focus began, so blur only ever commits/cancels its own transaction
    // rather than one a canvas drag opened after taking over focus.
    let ownsTransaction = false;
    input.addEventListener("focus", () => {
      this.planning.history.begin("route");
      ownsTransaction = true;
    });
    input.addEventListener("input", () => {
      const index = this.planning.selection.primaryWaypointIndex;
      const point = this.planning.selection.selectedWaypoint;
      if (!point || index < 0) return;
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) return;
      const value =
        field === "x" || field === "y" ? currentUnitsToInches(raw) : raw;
      if (field === "x" || field === "y") {
        const constrained = this.planning.projection.constrain({
          ...point,
          [field]: value,
        });
        this.planning.route.updateField(index, field, constrained[field]);
      } else if (field === "theta")
        this.planning.route.updateField(
          index,
          field,
          this.planning.projection.constrainTheta(value),
        );
      else if (field === "speed")
        // Don't lower the minimum for intermediate characters while typing a
        // new maximum (e.g. the initial "8" in "80"). Validate the pair on blur.
        this.planning.route.update(index, { speed: Math.max(-127, Math.min(127, value)) });
      else
        this.planning.route.updateField(
          index,
          field,
          Math.max(-127, Math.min(127, value)),
        );
      requestDrawAll();
    });
    input.addEventListener("blur", () => {
      if (!ownsTransaction) return;
      ownsTransaction = false;
      if (field === "speed") {
        const index = this.planning.selection.primaryWaypointIndex;
        const point = this.planning.selection.selectedWaypoint;
        if (point && index >= 0) this.planning.route.updateField(index, "speed", point.speed ?? 127);
      }
      this.planning.history.commit();
      this.renderSelection();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        ownsTransaction = false;
        this.planning.history.cancel();
        input.blur();
        this.renderSelection();
      }
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
    if (
      object.methods.length &&
      !(await this.dialogs.confirm({
        message: `Are you sure you want to remove Object ${object.name}?`,
      }))
    )
      return;
    const nodes = this.planning.paths.items.reduce(
      (count, path) =>
        count + path.nodes.filter((node) => node.objectId === id).length,
      0,
    );
    this.planning.objects.remove(id);
    void planningTelemetry.objectRemoved(
      this.planning.telemetryProperties({
        removed_methods: object.methods.length,
        removed_nodes: nodes,
      }),
    );
  }

  private async addMethod(objectId: string): Promise<void> {
    const object = this.planning.objects.get(objectId);
    if (!object) return;
    const result = await this.dialogs.edit({
      title: "Add Method",
      subtitle: `Create a new method for ${object.name}.`,
      groupTitle: "Method",
      description: METHOD_TEMPLATE_DESCRIPTION,
      name: "",
      code: "",
    });
    if (!result) return;
    this.planning.objects.addMethod(objectId, result);
    void planningTelemetry.methodCreated(this.planning.telemetryProperties());
  }

  async editMethod(objectId: string, methodId: string): Promise<void> {
    const method = this.planning.objects.method(objectId, methodId);
    if (!method) return;
    const previousName = method.name;
    const previousCode = method.code;
    const result = await this.dialogs.edit({
      title: "Edit Method",
      groupTitle: "Method",
      description: METHOD_TEMPLATE_DESCRIPTION,
      name: method.name,
      code: method.code,
    });
    if (
      !result ||
      (result.name === previousName && result.code === previousCode)
    )
      return;
    this.planning.objects.updateMethod(objectId, methodId, result);
    void planningTelemetry.methodUpdated(
      this.planning.telemetryProperties({
        method_name_changed: result.name !== previousName,
        method_code_changed: result.code !== previousCode,
      }),
    );
  }

  private async removeMethod(
    objectId: string,
    methodId: string,
  ): Promise<void> {
    const method = this.planning.objects.method(objectId, methodId);
    if (!method) return;
    const nodes = this.planning.paths.items.reduce(
      (count, path) =>
        count +
        path.nodes.filter(
          (node) => node.objectId === objectId && node.methodId === methodId,
        ).length,
      0,
    );
    if (
      nodes &&
      !(await this.dialogs.confirm({
        message: `Remove ${method.name} and ${nodes} placed node${nodes === 1 ? "" : "s"}?`,
      }))
    )
      return;
    this.planning.objects.removeMethod(objectId, methodId);
    void planningTelemetry.methodRemoved(
      this.planning.telemetryProperties({ removed_nodes: nodes }),
    );
  }

  private async editTemplate(): Promise<void> {
    const previous = this.planning.motionTemplates;
    const result = await this.dialogs.edit({
      title: "Edit Template",
      groupTitle: "Planning Export Template",
      description:
        "One block is generated from each waypoint to the next; " +
        "the final waypoint emits none. Available placeholders: " +
        "${x}, ${y}, ${theta}, ${distance}, ${iteration}, ${speed}, ${minSpeed} (@minspd), ${forwards}, ${lead} (@ld), and ${lockedDriveSide} (@side)",
      code: previous.forward,
      placeholder: "moveToPoint(${x}, ${y}, ${theta});",
      motionEditor: {
        mode: "templates",
        templates: previous,
        templateConfiguration: this.planning.templateConfiguration,
      },
    });
    if (!result?.templateConfiguration) return;
    this.planning.setTemplateConfiguration(result.templateConfiguration);
    if (JSON.stringify(previous) !== JSON.stringify(this.planning.motionTemplates))
      void planningTelemetry.templateUpdated(
        this.planning.telemetryProperties(),
      );
  }

  private async copyCode(): Promise<void> {
    const data = this.planning.exportData();
    const code = generatePlanningCode(this.planning);
    if (!code) {
      setStatus(
        "Add at least two waypoints and a template before copying code.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      this.flashCopySuccess();
      setStatus(
        `Copied generated code for ${data.waypoints.length} waypoint${data.waypoints.length === 1 ? "" : "s"}.`,
      );
      void planningTelemetry.templateExported(
        this.planning.telemetryProperties({
          export_surface: "clipboard",
        }),
      );
    } catch (error) {
      setStatus(
        `Failed to copy code: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private flashCopySuccess(): void {
    if (this.#copySuccessTimer !== null)
      window.clearTimeout(this.#copySuccessTimer);
    this.dom.copyCode.classList.remove("isCopySuccess");
    void this.dom.copyCode.offsetWidth;
    this.dom.copyCode.classList.add("isCopySuccess");
    this.#copySuccessTimer = window.setTimeout(() => {
      this.dom.copyCode.classList.remove("isCopySuccess");
      this.#copySuccessTimer = null;
    }, 1250);
  }

  private commitObjectName(id: string, name: string): void {
    if (this.#editingObjectId !== id) return;
    this.#editingObjectId = null;
    this.planning.objects.rename(
      id,
      name.trim() ||
        getDefaultPlanObjectName(
          this.planning.objects.items.findIndex((object) => object.id === id),
        ),
    );
  }

  private latestMethodName(objectId: string): string {
    const node = this.planning.latestExecutedNode(objectId);
    return (
      getPlanNodeEffectiveMethod(this.planning.objects.items, node)?.name || "—"
    );
  }
}
