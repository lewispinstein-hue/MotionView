import swapIconUrl from "../../assets/svg/planning/swapPlanningMotions.svg?url";
import type { PlanMotionTemplates, PlanWaypointIndicatorIcon, PlanWaypointMotion } from "../../state/models";
import type { PlanningDom } from "../PlanningDom";
import { createWaypointIndicatorIcon, getWaypointIndicatorTooltip } from "../planningIndicators";
import { createDefaultMotionTemplates, MAX_WAYPOINT_MOTIONS, PLANNING_MOTION_TYPES } from "../planningMotions";
import { PlanningMotionSelection } from "../planningMotionSelection";
import { PlanningMotionCodeEditor } from "./PlanningMotionCodeEditor";

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

/** Owns modal-local drafts; only Confirm returns content to the Planning domain. */
export class PlanningMotionEditorView {
  #mode: PlanningMotionEditorOptions["mode"] | null = null;
  #templates = createDefaultMotionTemplates("");
  #selection: PlanningMotionSelection | null = null;
  #selectedId: string | null = null;
  #selectedTemplate: PlanWaypointIndicatorIcon = "forward";
  readonly #codePreview: PlanningMotionCodeEditor;

  constructor(private readonly dom: PlanningDom) {
    this.#codePreview = new PlanningMotionCodeEditor(
      dom.templateCode,
      (id, code) => this.#selection?.updateCode(id, code),
      (id) => { this.#selectedId = id; },
    );
  }

  get active(): boolean {
    return this.#mode !== null;
  }

  get result(): PlanningMotionEditorResult {
    if (this.#mode === "templates") return { motionTemplates: { ...this.#templates } };
    return { motions: this.#selection?.result ?? [] };
  }

  get focusTarget(): HTMLElement {
    return this.#mode === "waypoint" ? this.#codePreview.focusTarget : this.dom.templateCode;
  }

  bind(): void {
    this.dom.templateCode.addEventListener("input", () => {
      if (this.#mode === "templates") this.#templates[this.#selectedTemplate] = this.dom.templateCode.value;
    });
  }

  open(options: PlanningMotionEditorOptions): void {
    this.#mode = options.mode;
    this.#templates = { ...options.templates };
    this.#selection = options.mode === "waypoint" ? new PlanningMotionSelection(options.motions, this.#templates) : null;
    this.#selectedId = this.#selection?.motions[0]?.id ?? null;
    this.#selectedTemplate = "forward";
    this.dom.templateModal.classList.add("hasMotionPreview");
    this.dom.motionPreview.hidden = false;
    this.dom.templateIndicatorPicker.hidden = true;
    this.dom.templateConfirm.textContent = "Confirm";
    this.render();
  }

  close(): void {
    this.#mode = null;
    this.#selection = null;
    this.dom.motionPreview.replaceChildren();
    this.dom.motionPreview.hidden = true;
    this.dom.templateModal.classList.remove("hasMotionPreview");
    this.dom.templateCode.disabled = false;
    this.dom.templateCode.hidden = false;
    this.dom.templateDescription.setAttribute("for", "planTemplateInput");
    this.#codePreview.hide();
  }

  private render(): void {
    this.dom.motionPreview.replaceChildren();
    if (this.#mode === "templates") this.renderTemplateTabs();
    else this.renderWaypointSelector();
    this.renderCode();
  }

  private motionContent(type: PlanWaypointIndicatorIcon): DocumentFragment {
    const content = document.createDocumentFragment();
    const name = document.createElement("span");
    name.textContent = MOTIONS.find((entry) => entry.type === type)!.name;
    content.append(createWaypointIndicatorIcon(type), name);
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

  private renderWaypointSelector(): void {
    const selection = this.#selection!;
    const picker = document.createElement("div");
    picker.className = "planMotionPicker";
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "Select one or two motion types");
    for (const motion of MOTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "planMotionChoice";
      button.dataset.motionType = motion.type;
      button.title = getWaypointIndicatorTooltip(motion.type);
      button.setAttribute("aria-label", motion.name);
      button.setAttribute("aria-pressed", String(selection.isSelected(motion.type)));
      button.disabled = !selection.isSelected(motion.type) && selection.motions.length >= MAX_WAYPOINT_MOTIONS;
      button.appendChild(this.motionContent(motion.type));
      button.addEventListener("click", () => {
        if (!selection.toggle(motion.type)) return;
        this.render();
        this.dom.motionPreview.querySelector<HTMLElement>(`[data-motion-type="${motion.type}"]`)?.focus();
      });
      picker.appendChild(button);
    }

    const row = document.createElement("div");
    row.className = "planMotionOrderRow";
    const summary = document.createElement("div");
    summary.className = "planMotionOrderSummary";
    summary.setAttribute("aria-label", "Execution order");
    summary.setAttribute("aria-live", "polite");
    summary.setAttribute("aria-atomic", "true");
    const icons = document.createElement("span");
    icons.className = "planMotionOrderIcons";
    const label = document.createElement("span");
    label.className = "planMotionOrderLabel";
    label.textContent = selection.motions.map((motion) => MOTIONS.find((entry) => entry.type === motion.type)!.name).join(" → ");
    for (const motion of selection.motions) icons.appendChild(createWaypointIndicatorIcon(motion.type));
    summary.append(icons, label);

    const swap = document.createElement("button");
    swap.type = "button";
    swap.className = "planMotionSwap";
    swap.title = "Swap execution order";
    swap.setAttribute("aria-label", swap.title);
    swap.disabled = selection.motions.length !== 2;
    swap.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="${swapIconUrl}#icon-swapPlanningMotions"></use></svg>`;
    swap.addEventListener("click", () => {
      if (!selection.swap()) return;
      this.render();
      this.dom.motionPreview.querySelector<HTMLElement>(".planMotionSwap")?.focus();
    });
    row.append(summary, swap);
    this.dom.motionPreview.append(picker, row);
  }

  private renderCode(): void {
    if (this.#mode === "waypoint") {
      const motions = this.#selection!.motions;
      if (!motions.some((motion) => motion.id === this.#selectedId)) this.#selectedId = motions[0]!.id;
      this.dom.templateGroupTitle.textContent = "Waypoint Code";
      this.dom.templateDescription.textContent = "Motions run in the order shown above. Code edits stay attached to their motion when swapped.";
      this.dom.templateCode.hidden = true;
      this.dom.templateDescription.setAttribute("for", "planMotionCodeInput");
      this.#codePreview.show(motions.map((motion) => ({
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
}
