import swapIconSvg from "../../assets/svg/planning/swapPlanningMotions.svg?raw";
import type { PlanMotionTemplates, PlanWaypointIndicatorIcon, PlanWaypointMotion } from "../../state/models";
import type { PlanningDom } from "../PlanningDom";
import { createWaypointIndicatorIcon, getWaypointIndicatorTooltip } from "../planningIndicators";
import { createDefaultMotionTemplates, MAX_WAYPOINT_MOTIONS, PLANNING_MOTION_TYPES } from "../planningMotions";
import { PlanningMotionSelection } from "../planningMotionSelection";
import { PlanningMotionCodeEditor } from "./PlanningMotionCodeEditor";
import {
  editPlanningMotionTemplate,
  editPlanningSwingDriveSide,
  isPlanningTemplateLibrary,
  normalizePlanningTemplateConfiguration,
  type PlanningTemplateConfiguration,
  type PlanningTemplateLibrary,
} from "../planningTemplatePresets";
import { supportsPlanningMotion, isVexcodePlanningLibrary } from "../planningTemplateCapabilities";


interface PlanningMotionEditorBaseOptions {
  readonly templates: Readonly<PlanMotionTemplates>;
}

export type PlanningMotionEditorOptions = PlanningMotionEditorBaseOptions & ({
  readonly mode: "waypoint";
  readonly templateLibrary?: PlanningTemplateLibrary;
  readonly motions?: readonly Readonly<PlanWaypointMotion>[];
  readonly forwards: boolean;
} | {
  readonly mode: "templates";
  readonly templateConfiguration: Readonly<PlanningTemplateConfiguration>;
});

export interface PlanningMotionEditorResult {
  readonly motions?: PlanWaypointMotion[];
  readonly forwards?: boolean;
  readonly motionTemplates?: PlanMotionTemplates;
  readonly templateConfiguration?: PlanningTemplateConfiguration;
}

const MOTIONS = PLANNING_MOTION_TYPES;

/** Owns motion selection and code drafts until Confirm. */
export class PlanningMotionEditorView {
  #mode: PlanningMotionEditorOptions["mode"] | null = null;
  #templates = createDefaultMotionTemplates("");
  #templateConfiguration: PlanningTemplateConfiguration | null = null;
  #waypointLibrary: PlanningTemplateLibrary = "custom";
  #selection: PlanningMotionSelection | null = null;
  #selectedId: string | null = null;
  #forwards = true;
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

  get editingWaypoint(): boolean {
    return this.#mode === "waypoint";
  }

  get result(): PlanningMotionEditorResult {
    if (this.#mode === "templates") return {
      motionTemplates: { ...this.#templates },
      templateConfiguration: normalizePlanningTemplateConfiguration(this.#templateConfiguration),
    };
    return { motions: this.#selection?.result ?? [], forwards: this.#forwards };
  }

  get focusTarget(): HTMLElement {
    return this.#mode === "waypoint" ? this.#codePreview.focusTarget : this.dom.templateCode;
  }

  bind(): void {
    this.dom.waypointCodeToggle.addEventListener("click", () =>
      this.setCodeExpanded(this.dom.templateGroupBody.hasAttribute("hidden")),
    );
    this.dom.templateCode.addEventListener("input", () => {
      if (this.#mode !== "templates" || !this.#templateConfiguration) return;
      editPlanningMotionTemplate(this.#templateConfiguration, this.#selectedTemplate, this.dom.templateCode.value);
      this.updateTemplateLibraryControls();
    });
    this.dom.templateLibrary.addEventListener("change", () => {
      const library = this.dom.templateLibrary.value;
      if (this.#mode !== "templates" || !this.#templateConfiguration || !isPlanningTemplateLibrary(library)) return;
      this.#templateConfiguration.library = library;
      this.#templates = this.#templateConfiguration.templates[library];
      if (!supportsPlanningMotion(library, this.#selectedTemplate)) this.#selectedTemplate = "forward";
      this.render();
    });
    for (const [side, input] of [["left", this.dom.swingLeftDriveSide], ["right", this.dom.swingRightDriveSide]] as const) {
      input.addEventListener("input", () => {
        if (this.#mode !== "templates" || !this.#templateConfiguration) return;
        editPlanningSwingDriveSide(this.#templateConfiguration, side, input.value);
        this.updateTemplateLibraryControls();
      });
    }
  }

  open(options: PlanningMotionEditorOptions): void {
    this.#mode = options.mode;
    this.#waypointLibrary = options.mode === "waypoint" ? options.templateLibrary ?? "custom" : "custom";
    this.#templateConfiguration = options.mode === "templates"
      ? normalizePlanningTemplateConfiguration(options.templateConfiguration) : null;
    this.#templates = this.#templateConfiguration
      ? this.#templateConfiguration.templates[this.#templateConfiguration.library] : { ...options.templates };
    this.dom.templateLibrary.hidden = options.mode !== "templates";
    if (this.#templateConfiguration) this.dom.templateLibrary.value = this.#templateConfiguration.library;
    this.#selection = options.mode === "waypoint" ? new PlanningMotionSelection(options.motions, this.#templates, this.#waypointLibrary) : null;
    this.#forwards = options.mode === "waypoint" ? options.forwards : true;
    this.#selectedId = this.#selection?.motions[0]?.id ?? null;
    this.#selectedTemplate = "forward";
    this.dom.templateModal.classList.add("hasMotionPreview");
    this.dom.motionPreview.hidden = false;
    this.dom.templateIndicatorPicker.hidden = true;
    this.dom.templateGroupTitle.hidden = this.editingWaypoint;
    this.dom.waypointCodeToggle.hidden = !this.editingWaypoint;
    this.setCodeExpanded(!this.editingWaypoint);
    this.dom.templateConfirm.textContent = "Confirm";
    this.render();
  }

  close(): void {
    this.#mode = null;
    this.#selection = null;
    this.#templateConfiguration = null;
    this.dom.templateLibrary.hidden = true;
    this.dom.swingDriveSideFields.hidden = true;
    this.dom.motionPreview.replaceChildren();
    this.dom.motionPreview.hidden = true;
    this.dom.templateModal.classList.remove("hasMotionPreview");
    this.dom.templateGroupTitle.hidden = false;
    this.dom.waypointCodeToggle.hidden = true;
    this.setCodeExpanded(true);
    this.dom.templateCode.disabled = false;
    this.dom.templateCode.hidden = false;
    this.dom.templateDescription.setAttribute("for", "planTemplateInput");
    this.#codePreview.hide();
  }

  private setCodeExpanded(expanded: boolean): void {
    this.dom.templateGroupBody.hidden = !expanded;
    this.dom.waypointCodeToggle.setAttribute("aria-expanded", String(expanded));
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
      tab.dataset.motionTemplate = motion.type;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(this.#selectedTemplate === motion.type));
      tab.disabled = !supportsPlanningMotion(this.#templateConfiguration!.library, motion.type);
      if (tab.disabled) tab.title = "Unavailable in this template preset";
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
    picker.setAttribute("aria-label", "Select up to one movement type and one turn type");
    for (const motion of MOTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "planMotionChoice";
      button.dataset.motionType = motion.type;
      button.title = getWaypointIndicatorTooltip(motion.type);
      button.setAttribute("aria-label", motion.name);
      button.setAttribute("aria-pressed", String(selection.isSelected(motion.type)));
      button.disabled = !supportsPlanningMotion(this.#waypointLibrary, motion.type) ||
        (!selection.isSelected(motion.type) && selection.motions.length >= MAX_WAYPOINT_MOTIONS);
      if (!supportsPlanningMotion(this.#waypointLibrary, motion.type)) button.title = "Unavailable in this template preset";
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
    swap.innerHTML = swapIconSvg.replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
    swap.addEventListener("click", () => {
      if (!selection.swap()) return;
      this.render();
      this.dom.motionPreview.querySelector<HTMLElement>(".planMotionSwap")?.focus();
    });
    row.append(summary, swap);
    this.dom.motionPreview.append(picker, row);
    if (selection.isSelected("forward") || selection.isSelected("boomerang"))
      this.dom.motionPreview.appendChild(this.createDirectionToggle());
    const swing = selection.motions.find(motion => motion.type === "swing");
    if (swing) {
      const side = document.createElement("div"); side.className = "planWaypointDirection";
      const label = document.createElement("span"); label.className = "planWaypointDirectionLabel";
      label.textContent = "Locked drive side"; side.appendChild(label);
      side.title = "Used by the preview and ${lockedDriveSide} / @side in exported code.";
      for (const value of ["left", "right"] as const) {
        const button = document.createElement("button"); button.type = "button"; button.className = "planMotionChoice";
        button.textContent = value === "left" ? "Left" : "Right";
        button.setAttribute("aria-pressed", String((swing.lockedDriveSide ?? "left") === value));
        button.addEventListener("click", () => {
          selection.setLockedDriveSide(swing.id, value);
          for (const option of side.querySelectorAll("button")) option.setAttribute("aria-pressed", String(option === button));
        });
        side.appendChild(button);
      }
      this.dom.motionPreview.appendChild(side);
    }
  }

  private createDirectionToggle(): HTMLElement {
    const direction = document.createElement("div");
    direction.className = "planWaypointDirection";
    direction.setAttribute("role", "group");
    direction.setAttribute("aria-label", "Travel direction");
    direction.title = "Travel direction from this waypoint to the next; used by @fwd and ${forwards}.";
    const label = document.createElement("span");
    label.className = "planWaypointDirectionLabel";
    label.textContent = "Direction";
    direction.appendChild(label);
    for (const forwards of [true, false]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "planMotionChoice";
      button.textContent = forwards ? "Forwards" : "Backwards";
      button.setAttribute("aria-pressed", String(this.#forwards === forwards));
      button.addEventListener("click", () => {
        this.#forwards = forwards;
        for (const choice of direction.querySelectorAll("button"))
          choice.setAttribute("aria-pressed", String(choice === button));
      });
      direction.appendChild(button);
    }
    return direction;
  }

  private renderCode(): void {
    this.dom.swingDriveSideFields.hidden = this.#mode !== "templates" || this.#selectedTemplate !== "swing";
    if (this.#mode === "waypoint") {
      const motions = this.#selection!.motions;
      if (!motions.some((motion) => motion.id === this.#selectedId)) this.#selectedId = motions[0]!.id;
      this.dom.templateDescription.textContent = isVexcodePlanningLibrary(this.#waypointLibrary)
        ? "Motions run in the order shown above. VEXcode Straight faces the next waypoint, then drives @dist. @bearing is the facing heading, including backwards travel. Preview is approximate."
        : "Motions run in the order shown above. Code edits stay attached to their motion when swapped. Field curves are approximate; robot tuning affects the actual path.";
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
    this.dom.templateCode.placeholder = "";
    this.dom.templateDescription.textContent = this.templateDescription();
    if (this.#selectedTemplate === "swing" && this.#templateConfiguration) {
      const sides = this.#templateConfiguration.swingDriveSides[this.#templateConfiguration.library];
      this.dom.swingLeftDriveSide.value = sides.left;
      this.dom.swingRightDriveSide.value = sides.right;
    }
    this.dom.templateCode.value = this.#templates[this.#selectedTemplate];
  }

  private templateDescription(): string {
    return isVexcodePlanningLibrary(this.#templateConfiguration!.library)
      ? "VEXcode Straight turns toward the next waypoint before driving. @bearing or ${bearing} is its facing heading, including backwards travel; @dist or ${distance} is the segment distance. Turn uses @th for the destination heading."
      : "Starting code for this motion type." +
      (this.#templateConfiguration?.library === "jar-template" ? " JAR chooses travel direction automatically." : "") +
      (this.#selectedTemplate === "swing" ? " ${lockedDriveSide} or @side inserts the Locked Left or Locked Right value chosen for each waypoint." : "");
  }

  private updateTemplateLibraryControls(): void {
    const configuration = this.#templateConfiguration!;
    this.#templates = configuration.templates[configuration.library];
    this.dom.templateLibrary.value = configuration.library;
    for (const { type } of MOTIONS) {
      const tab = this.dom.motionPreview.querySelector<HTMLButtonElement>(`[data-motion-template="${type}"]`);
      if (!tab) continue;
      tab.disabled = !supportsPlanningMotion(configuration.library, type);
      tab.title = tab.disabled ? "Unavailable in this template preset" : "";
    }
    this.dom.templateDescription.textContent = this.templateDescription();
  }
}
