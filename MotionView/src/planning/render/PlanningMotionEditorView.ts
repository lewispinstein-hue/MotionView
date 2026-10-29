import removeIconUrl from "../../assets/svg/planning/removePlanningObject.svg?url";
import type { PlanMotionTemplates, PlanWaypointIndicatorIcon, PlanWaypointMotion } from "../../state/models";
import type { PlanningDom } from "../PlanningDom";
import { createWaypointIndicatorIcon } from "../planningIndicators";
import { PlanningMotionCodeEditor } from "./PlanningMotionCodeEditor";
import { createPlanMotionId } from "../planningState";
import { createDefaultMotionTemplates, getMotionCode, MAX_WAYPOINT_MOTIONS, PLANNING_MOTION_TYPES } from "../planningMotions";
import { animateVerticalReorder, captureVerticalPositions } from "./verticalReorderAnimation";

export interface PlanningMotionEditorOptions {
  readonly mode: "waypoint" | "templates";
  readonly templates: Readonly<PlanMotionTemplates>;
  readonly motions?: readonly Readonly<PlanWaypointMotion>[];
}

export interface PlanningMotionEditorResult {
  readonly motions?: PlanWaypointMotion[];
  readonly motionTemplates?: PlanMotionTemplates;
}

const MOTIONS = PLANNING_MOTION_TYPES;

interface MotionDraft {
  id: string;
  type: PlanWaypointIndicatorIcon;
  code: string;
}

interface MotionDrag {
  type: PlanWaypointIndicatorIcon;
  id?: string;
  pointerId: number;
  startX: number;
  startY: number;
  source: HTMLElement;
  ghost: HTMLElement | null;
}

/** Owns modal-local drafts; only Confirm returns content to the Planning domain. */
export class PlanningMotionEditorView {
  #mode: PlanningMotionEditorOptions["mode"] | null = null;
  #templates = createDefaultMotionTemplates("");
  #motions: MotionDraft[] = [];
  #selectedId: string | null = null;
  #selectedTemplate: PlanWaypointIndicatorIcon = "forward";
  #drag: MotionDrag | null = null;
  #suppressDragClick = false;
  readonly #codePreview: PlanningMotionCodeEditor;

  constructor(private readonly dom: PlanningDom) {
    this.#codePreview = new PlanningMotionCodeEditor(
      dom.templateCode,
      (id, code) => {
        const motion = this.#motions.find((entry) => entry.id === id);
        if (motion) motion.code = code;
      },
      (id) => this.selectMotion(id),
    );
  }

  get active(): boolean {
    return this.#mode !== null;
  }

  get result(): PlanningMotionEditorResult {
    if (this.#mode === "templates") return { motionTemplates: { ...this.#templates } };
    return {
      motions: this.#motions.map(({ id, type, code }) => code === this.#templates[type]
        ? { id, type } : { id, type, overrideCode: code }),
    };
  }

  get focusTarget(): HTMLElement {
    return this.#mode === "waypoint" ? this.#codePreview.focusTarget : this.dom.templateCode;
  }

  bind(): void {
    this.dom.templateCode.addEventListener("input", () => {
      if (this.#mode === "templates") {
        this.#templates[this.#selectedTemplate] = this.dom.templateCode.value;
      }
    });
    const root = this.dom.motionPreview;
    // Native HTML dragging can be intercepted by the desktop file-drop handler.
    // Use pointer dragging, just like the main Planning method bank.
    root.addEventListener("dragstart", (event) => event.preventDefault());
    root.addEventListener("pointerdown", (event) => this.startDrag(event));
    window.addEventListener("pointermove", (event) => this.moveDrag(event));
    window.addEventListener("pointerup", (event) => this.finishDrag(event));
    window.addEventListener("pointercancel", (event) => {
      if (event.pointerId === this.#drag?.pointerId) this.endDrag();
    });
    root.addEventListener("lostpointercapture", () => this.endDrag());
    window.addEventListener("blur", () => this.endDrag());
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.endDrag();
    });
    root.addEventListener("click", (event) => {
      if (!this.#suppressDragClick || event.detail === 0) return;
      this.#suppressDragClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  open(options: PlanningMotionEditorOptions): void {
    this.#mode = options.mode;
    this.#templates = { ...options.templates };
    this.#motions = (options.motions ?? []).map((motion) => ({
      id: motion.id, type: motion.type, code: getMotionCode(motion, this.#templates),
    }));
    this.#selectedId = this.#motions[0]?.id ?? null;
    this.#selectedTemplate = "forward";
    this.dom.templateModal.classList.add("hasMotionPreview");
    this.dom.motionPreview.hidden = false;
    this.dom.templateIndicatorPicker.hidden = true;
    this.dom.templateConfirm.textContent = "Confirm";
    this.render();
  }

  close(): void {
    this.#mode = null;
    this.#motions = [];
    this.endDrag();
    this.dom.motionPreview.replaceChildren();
    this.dom.motionPreview.hidden = true;
    this.dom.templateModal.classList.remove("hasMotionPreview");
    this.dom.templateCode.disabled = false;
    this.dom.templateCode.hidden = false;
    this.dom.templateDescription.setAttribute("for", "planTemplateInput");
    this.#codePreview.hide();
  }

  private createMotion(type: PlanWaypointIndicatorIcon): MotionDraft {
    return { id: createPlanMotionId(), type, code: this.#templates[type] };
  }

  private render(positions?: ReadonlyMap<string, number>): void {
    this.dom.motionPreview.replaceChildren();
    if (this.#mode === "templates") this.renderTemplateTabs();
    else this.renderWaypointTimeline();
    this.renderCode();
    if (positions) {
      animateVerticalReorder(
        () => this.dom.motionPreview.querySelectorAll<HTMLElement>("[data-motion-id]"),
        "motionId",
        positions,
      );
    }
  }

  private motionPositions(): ReadonlyMap<string, number> {
    return captureVerticalPositions(
      this.dom.motionPreview.querySelectorAll<HTMLElement>("[data-motion-id]"),
      "motionId",
    );
  }

  private motionContent(type: PlanWaypointIndicatorIcon): DocumentFragment {
    const motion = MOTIONS.find((entry) => entry.type === type)!;
    const content = document.createDocumentFragment();
    content.appendChild(createWaypointIndicatorIcon(type));
    const text = document.createElement("div");
    text.className = "planMotionCardText";
    const name = document.createElement("strong");
    name.textContent = motion.name;
    text.appendChild(name);
    content.appendChild(text);
    return content;
  }

  private renderTemplateTabs(): void {
    const tabs = document.createElement("div");
    tabs.className = "planMotionTemplateTabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Motion templates");
    for (const motion of MOTIONS) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "planMotionTemplateTab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(this.#selectedTemplate === motion.type));
      tab.appendChild(this.motionContent(motion.type));
      tab.addEventListener("click", () => {
        this.#selectedTemplate = motion.type;
        this.render();
        this.dom.motionPreview.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
      });
      tabs.appendChild(tab);
    }
    this.dom.motionPreview.appendChild(tabs);
  }

  private section(title: string, hint: string): HTMLElement {
    const section = document.createElement("section");
    section.className = "planMotionPreviewSection";
    const header = document.createElement("div");
    header.className = "planMotionSectionHeader";
    const name = document.createElement("h3");
    name.textContent = title;
    const help = document.createElement("span");
    help.textContent = hint;
    header.append(name, help);
    section.appendChild(header);
    return section;
  }

  private renderWaypointTimeline(): void {
    const layout = document.createElement("div");
    layout.className = "planMotionWaypointLayout";
    const full = this.#motions.length >= MAX_WAYPOINT_MOTIONS;
    const palette = this.section("Motion Types", full ? "Full" : "");
    const types = document.createElement("div");
    types.className = "planMotionPalette";
    for (const motion of MOTIONS) {
      const card = document.createElement("div");
      card.className = `planMotionPaletteCard${full ? " isDisabled" : ""}`;
      card.dataset.motionType = motion.type;
      card.setAttribute("aria-disabled", String(full));
      card.title = full ? "Four-motion limit reached" : `Drag ${motion.name.toLowerCase()} to the waypoint timeline`;
      const grip = document.createElement("span");
      grip.className = "planMotionGrip";
      grip.textContent = "⠿";
      grip.setAttribute("aria-hidden", "true");
      card.append(grip, this.motionContent(motion.type));
      types.appendChild(card);
    }
    palette.appendChild(types);
    const sequence = this.section("Waypoint Timeline", `${this.#motions.length} / ${MAX_WAYPOINT_MOTIONS}`);
    const timeline = document.createElement("div");
    timeline.className = "planMotionTimeline";
    timeline.dataset.motionTimeline = "";
    timeline.setAttribute("aria-label", "Waypoint motion order, top to bottom");
    const list = document.createElement("div");
    list.className = "planMotionList";
    this.#motions.forEach((motion, index) => {
      const card = document.createElement("div");
      card.className = `planMotionPlaced${motion.id === this.#selectedId ? " isSelected" : ""}`;
      card.tabIndex = 0;
      card.dataset.motionId = String(motion.id);
      card.setAttribute("role", "button");
      const name = MOTIONS.find((entry) => entry.type === motion.type)!.name;
      card.setAttribute("aria-label", `Edit ${name.toLowerCase()}, position ${index + 1}`);
      card.setAttribute("aria-pressed", String(motion.id === this.#selectedId));
      const position = document.createElement("span");
      position.className = "planMotionIndex";
      position.textContent = String(index + 1);
      position.setAttribute("aria-hidden", "true");
      const actions = document.createElement("div");
      actions.className = "planMotionActions";
      for (const direction of [-1, 1] as const) {
        const button = document.createElement("button");
        const order = direction < 0 ? "up" : "down";
        button.type = "button";
        button.className = "planMotionReorder";
        button.dataset.motionReorder = order;
        button.title = `Move ${name.toLowerCase()} ${order}`;
        button.setAttribute("aria-label", button.title);
        button.disabled = direction < 0 ? index === 0 : index === this.#motions.length - 1;
        const path = direction < 0 ? "m3 7.5 3-3 3 3" : "m3 4.5 3 3 3-3";
        button.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.reorderMotion(motion.id, direction);
        });
        actions.appendChild(button);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "planMotionRemove";
      remove.title = `Remove ${name.toLowerCase()}`;
      remove.setAttribute("aria-label", remove.title);
      remove.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="${removeIconUrl}#icon-removePlanningObject"></use></svg>`;
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        const positions = this.motionPositions();
        this.#motions.splice(index, 1);
        if (this.#selectedId === motion.id) this.#selectedId = this.#motions[Math.min(index, this.#motions.length - 1)]?.id ?? null;
        this.render(positions);
      });
      const select = () => {
        this.selectMotion(motion.id);
        this.#codePreview.focus(motion.id);
      };
      card.addEventListener("click", select);
      card.addEventListener("keydown", (event) => {
        if (event.target === card && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          select();
        }
      });
      actions.appendChild(remove);
      card.append(position, this.motionContent(motion.type), actions);
      list.appendChild(card);
    });
    timeline.appendChild(list);
    sequence.appendChild(timeline);
    layout.append(palette, sequence);
    this.dom.motionPreview.appendChild(layout);
  }

  private reorderMotion(id: string, direction: -1 | 1): void {
    const index = this.#motions.findIndex((motion) => motion.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= this.#motions.length) return;
    const positions = this.motionPositions();
    const motion = this.#motions.splice(index, 1)[0]!;
    this.#motions.splice(next, 0, motion);
    this.#selectedId = id;
    this.render(positions);
    const card = [...this.dom.motionPreview.querySelectorAll<HTMLElement>("[data-motion-id]")]
      .find((entry) => entry.dataset.motionId === id);
    const order = direction < 0 ? "up" : "down";
    const button = card?.querySelector<HTMLButtonElement>(`[data-motion-reorder="${order}"]`);
    (button && !button.disabled ? button : card)?.focus();
  }

  private renderCode(): void {
    if (this.#mode === "waypoint") {
      this.dom.templateGroupTitle.textContent = "Waypoint Code Preview";
      this.dom.templateDescription.textContent = "All motions run in order. Edit within a motion’s code; its edits stay attached when reordered.";
      this.dom.templateCode.hidden = true;
      this.dom.templateDescription.setAttribute("for", "planMotionCodeInput");
      this.#codePreview.show(this.#motions.map((motion) => ({
        ...motion,
        name: MOTIONS.find((entry) => entry.type === motion.type)!.name,
      })), this.#selectedId);
      return;
    }
    this.#codePreview.hide();
    this.dom.templateCode.hidden = false;
    this.dom.templateDescription.setAttribute("for", "planTemplateInput");
    const name = MOTIONS.find((entry) => entry.type === this.#selectedTemplate)!.name;
    this.dom.templateGroupTitle.textContent = `${name} template`;
    this.dom.templateDescription.textContent = "Starting code for this motion type. Both @x and ${x} placeholders are supported.";
    this.dom.templateCode.value = this.#templates[this.#selectedTemplate];
  }

  private selectMotion(id: string): void {
    this.#selectedId = id;
    for (const card of this.dom.motionPreview.querySelectorAll<HTMLElement>("[data-motion-id]")) {
      const selected = card.dataset.motionId === id;
      card.classList.toggle("isSelected", selected);
      card.setAttribute("aria-pressed", String(selected));
    }
  }

  private startDrag(event: PointerEvent): void {
    this.#suppressDragClick = false;
    if (this.#mode !== "waypoint" || event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return;
    const source = event.target.closest<HTMLElement>("[data-motion-type], [data-motion-id]");
    if (!source || event.target.closest("button")) return;
    const motion = source.dataset.motionId == null ? null : this.#motions.find((entry) => entry.id === source.dataset.motionId);
    if (!motion && this.#motions.length >= MAX_WAYPOINT_MOTIONS) return;
    const type = motion?.type ?? MOTIONS.find((entry) => entry.type === source.dataset.motionType)?.type;
    if (!type) return;
    event.preventDefault();
    this.endDrag();
    this.#drag = {
      type, id: motion?.id, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, source, ghost: null,
    };
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.ghost) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
      drag.ghost = drag.source.cloneNode(true) as HTMLElement;
      drag.ghost.className = "planMotionPaletteCard planMotionDragGhost";
      drag.ghost.removeAttribute("data-motion-type");
      drag.ghost.removeAttribute("data-motion-id");
      drag.ghost.setAttribute("aria-hidden", "true");
      drag.ghost.style.width = `${drag.source.getBoundingClientRect().width}px`;
      document.body.appendChild(drag.ghost);
      drag.source.classList.add("isDragging");
      this.dom.motionPreview.setPointerCapture(event.pointerId);
      this.#suppressDragClick = true;
    }
    event.preventDefault();
    drag.ghost.style.left = `${event.clientX + 12}px`;
    drag.ghost.style.top = `${event.clientY + 12}px`;
    const target = this.dropTarget(event);
    if (target) this.showDropTarget(target.timeline, target.index);
    else this.clearDropTarget();
  }

  private finishDrag(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const target = drag.ghost ? this.dropTarget(event) : null;
    this.endDrag();
    if (!target) return;
    event.preventDefault();
    const positions = this.motionPositions();
    let index = target.index;
    let motion: MotionDraft;
    if (drag.id == null) motion = this.createMotion(drag.type);
    else {
      const previous = this.#motions.findIndex((entry) => entry.id === drag.id);
      if (previous < 0) return;
      motion = this.#motions.splice(previous, 1)[0]!;
      if (previous < index) index -= 1;
    }
    this.#motions.splice(Math.min(index, this.#motions.length), 0, motion);
    this.#selectedId = motion.id;
    this.render(positions);
  }

  private dropTarget(event: PointerEvent): { timeline: HTMLElement; index: number } | null {
    if (!this.#drag) return null;
    if (this.#drag.id == null && this.#motions.length >= MAX_WAYPOINT_MOTIONS) return null;
    const timeline = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-motion-timeline]");
    if (!timeline || !this.dom.motionPreview.contains(timeline)) return null;
    const cards = [...timeline.querySelectorAll<HTMLElement>("[data-motion-id]")];
    const index = cards.findIndex((card) => {
      const bounds = card.getBoundingClientRect();
      return event.clientY < bounds.top + bounds.height / 2;
    });
    return { timeline, index: index < 0 ? cards.length : index };
  }

  private showDropTarget(timeline: HTMLElement, index: number): void {
    const cards = [...timeline.querySelectorAll<HTMLElement>("[data-motion-id]")];
    const bounds = timeline.getBoundingClientRect();
    const before = cards[index]?.getBoundingClientRect();
    const last = cards.at(-1)?.getBoundingClientRect();
    const top = before ? before.top - bounds.top - 3 : last ? last.bottom - bounds.top + 1 : bounds.height / 2;
    this.clearDropTarget();
    const line = document.createElement("div");
    line.className = "planMotionDropLine";
    line.style.top = `${top}px`;
    line.setAttribute("aria-hidden", "true");
    timeline.appendChild(line);
  }

  private clearDropTarget(): void {
    this.dom.motionPreview.querySelectorAll(".planMotionDropLine").forEach((line) => line.remove());
  }

  private endDrag(): void {
    const drag = this.#drag;
    this.#drag = null;
    drag?.source.classList.remove("isDragging");
    drag?.ghost?.remove();
    if (drag && this.dom.motionPreview.hasPointerCapture(drag.pointerId)) {
      this.dom.motionPreview.releasePointerCapture(drag.pointerId);
    }
    this.clearDropTarget();
  }
}
