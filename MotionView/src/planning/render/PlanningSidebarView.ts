import removeIconSvg from "../../assets/svg/planning/removePlanningObject.svg?raw";
import colorIconSvg from "../../assets/svg/planning/changeObjectColor.svg?raw";
import { requestDrawAll } from "../../render/renderScheduler";
import { setStatus } from "../../app/status";
import {
  currentUnitsToInches,
  formatDistanceFromInches,
} from "../../shared/units";
import { planningTelemetry } from "../../telemetry/createTelemetry";
import type { PlanWaypointIndicatorIcon } from "../../state/models";
import type { PlanningDialogs } from "../PlanningDialogs";
import type { PlanningDom } from "../PlanningDom";
import type { PlanningFeature } from "../PlanningFeature";
import { getPlanNodeEffectiveMethod } from "../planningObjects";
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
  "Available placeholders: ${x}, ${y}, ${theta}, ${distance}, ${iteration}, ${speed}, and ${forwards}";

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
  #selectObjectName = false;
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
    this.bindSelectionField(this.dom.selectedSpeed, "speed");
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
    window.addEventListener("pointerup", () => this.finishMethodReorder());
    window.addEventListener("pointercancel", () => this.cancelMethodReorder());
    window.addEventListener("blur", () => this.cancelMethodReorder());
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
      details.textContent = `X: ${formatDistanceFromInches(point.x, 2)}  Y: ${formatDistanceFromInches(point.y, 2)}  θ: ${format(point.theta, 1)}°  S: ${format(point.speed, 0)}`;
      const indicators = document.createElement("div");
      indicators.className =
        "waypointIndicatorStrip waypointIndicatorStripSmall";
      this.appendWaypointIndicators(
        indicators,
        point.indicatorIcons ?? [],
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

  renderSelection(): void {
    const point = this.planning.selection.selectedWaypoint;
    const inputs = [
      this.dom.selectedX,
      this.dom.selectedY,
      this.dom.selectedTheta,
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
      point.indicatorIcons ?? [],
    );
    this.dom.editWaypoint.disabled = false;
    for (const input of inputs) input.disabled = false;
    if (inputs.includes(document.activeElement as HTMLInputElement)) return;
    this.dom.selectedX.value = formatDistanceFromInches(point.x, 2);
    this.dom.selectedY.value = formatDistanceFromInches(point.y, 2);
    this.dom.selectedTheta.value = format(point.theta, 1);
    this.dom.selectedSpeed.value = format(point.speed, 0);
  }

  private appendWaypointIndicators(
    target: HTMLElement,
    icons: readonly PlanWaypointIndicatorIcon[],
    className = "",
  ): void {
    for (const indicator of orderWaypointIndicatorIcons(icons))
      target.appendChild(createWaypointIndicatorIcon(indicator, className));
  }

  renderObjects(): void {
    this.dom.objectList.replaceChildren();
    const selectedNode = this.planning.selection.selectedNode;
    this.planning.objects.items.forEach((object, objectIndex) => {
      const card = document.createElement("article");
      const selectedMethod = this.planning.selection.selectedMethod;
      card.className = `planObjectCard${selectedNode?.objectId === object.id || selectedMethod?.objectId === object.id ? " isHighlighted" : ""}`;
      card.dataset.objectId = object.id;
      const header = document.createElement("div");
      header.className = "planObjectHeader";
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
          if (event.key === "Enter")
            this.commitObjectName(object.id, input.value);
          else if (event.key === "Escape") {
            this.#editingObjectId = null;
            this.renderObjects();
          }
        });
        meta.appendChild(input);
        requestAnimationFrame(() => {
          input.focus();
          if (this.#selectObjectName) input.select();
        });
      } else {
        const name = document.createElement("div");
        name.className = "planObjectName";
        name.textContent = object.name || getDefaultPlanObjectName(objectIndex);
        name.addEventListener("dblclick", () => {
          this.#editingObjectId = object.id;
          this.#selectObjectName = true;
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
        methodCard.className = `planMethodCard${(selectedNode?.objectId === object.id && selectedNode.methodId === method.id) || this.planning.selection.isMethodSelected(object.id, method.id) ? " isHighlighted" : ""}`;
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
      card.appendChild(methods);
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
      card.appendChild(actions);
      card.style.setProperty(
        "--plan-object-color",
        object.color || getDefaultPlanObjectColor(objectIndex),
      );
      card.style.color = getContrastTextColor(object.color);
      this.dom.objectList.appendChild(card);
    });
    this.animateMethodReorder();
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
    const positions = new Map<string, number>();
    for (const card of this.dom.objectList.querySelectorAll<HTMLElement>(
      `.planMethodCard[data-object-id="${CSS.escape(objectId)}"]`,
    )) {
      const methodId = card.dataset.methodId;
      if (methodId) positions.set(methodId, card.getBoundingClientRect().top);
    }
    return positions;
  }

  private animateMethodReorder(): void {
    const animation = this.#methodOrderAnimation;
    if (!animation) return;
    this.#methodOrderAnimation = null;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    requestAnimationFrame(() => {
      for (const card of this.dom.objectList.querySelectorAll<HTMLElement>(
        `.planMethodCard[data-object-id="${CSS.escape(animation.objectId)}"]`,
      )) {
        const methodId = card.dataset.methodId;
        const previousTop = methodId
          ? animation.positions.get(methodId)
          : undefined;
        if (previousTop === undefined) continue;
        const offset = previousTop - card.getBoundingClientRect().top;
        if (Math.abs(offset) < 1) continue;
        card.animate(
          [
            { transform: `translateY(${offset}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
        );
      }
    });
  }

  private bindSelectionField(
    input: HTMLInputElement,
    field: "x" | "y" | "theta" | "speed",
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
      this.planning.history.commit();
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
    const nodes = this.planning.timeline.nodes.filter(
      (node) => node.objectId === id,
    ).length;
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

  private async editMethod(objectId: string, methodId: string): Promise<void> {
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
    const nodes = this.planning.timeline.nodes.filter(
      (node) => node.objectId === objectId && node.methodId === methodId,
    ).length;
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
    const previous = this.planning.exportTemplate;
    const result = await this.dialogs.edit({
      title: "Edit Template",
      groupTitle: "Planning Export Template",
      description:
        "One block is generated from each waypoint to the next; " +
        "the final waypoint emits none. Available placeholders: " +
        "${x}, ${y}, ${theta}, ${distance}, ${iteration}, ${speed}, and ${forwards}",
      code: previous,
      placeholder: "moveToPoint(${x}, ${y}, ${theta});",
    });
    if (!result) return;
    this.planning.setExportTemplate(result.code);
    if (previous !== this.planning.exportTemplate)
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
    this.planning.objects.rename(
      id,
      name.trim() ||
        getDefaultPlanObjectName(
          this.planning.objects.items.findIndex((object) => object.id === id),
        ),
    );
    this.#editingObjectId = null;
  }

  private latestMethodName(objectId: string): string {
    const node = this.planning.latestExecutedNode(objectId);
    return (
      getPlanNodeEffectiveMethod(this.planning.objects.items, node)?.name || "—"
    );
  }
}
