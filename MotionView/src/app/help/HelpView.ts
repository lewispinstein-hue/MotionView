import { bindModalBackdropDismissal } from "../dialogs/modalDismissal";
import type { MotionViewApp } from "../MotionViewApp";
import { SHORTCUT_CATALOG } from "../input/shortcutCatalog";
import type { ShortcutHelpGroup } from "../input/shortcutTypes";
import type { MotionViewDocumentSerializer } from "../persistence";
import { feedbackTelemetry, type FeedbackArea, type FeedbackProduct, type FeedbackType } from "../../telemetry/createTelemetry";
import type { HelpDom } from "./HelpDom";

const GROUPS: readonly ShortcutHelpGroup[] = ["Global", "Viewing", "Planning"];

export class HelpView {
  #bound = false;
  #product: FeedbackProduct | null = null;
  #feedbackType: FeedbackType | null = null;
  #area: FeedbackArea | null = null;
  #submitting = false;

  constructor(
    private readonly app: MotionViewApp,
    private readonly dom: HelpDom,
    private readonly serializer: MotionViewDocumentSerializer,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.dom.helpClose.addEventListener("click", () => this.close());
    this.dom.showKeybinds.addEventListener("click", () => this.openKeybinds());
    this.dom.showFeedback.addEventListener("click", () => this.openFeedback());
    this.dom.keybindsClose.addEventListener("click", () => this.closeKeybinds());
    this.dom.feedbackClose.addEventListener("click", () => this.closeFeedback());
    this.dom.feedbackCancel.addEventListener("click", () => this.closeFeedback());
    this.dom.feedbackDescription.addEventListener("input", () => this.updateFeedbackForm());
    this.dom.feedbackProductTags.forEach((tag) => tag.addEventListener("click", () => this.selectProduct(tag.dataset.feedbackProduct as FeedbackProduct)));
    this.dom.feedbackTypeTags.forEach((tag) => tag.addEventListener("click", () => this.selectFeedbackType(tag.dataset.feedbackType as FeedbackType)));
    this.dom.feedbackAreaTags.forEach((tag) => tag.addEventListener("click", () => this.selectArea(tag.dataset.feedbackArea as FeedbackArea)));
    this.dom.feedbackSend.addEventListener("click", () => void this.submitFeedback());
    bindModalBackdropDismissal(this.dom.helpModal, () => this.close());
    bindModalBackdropDismissal(this.dom.keybindsModal, () => this.closeKeybinds());
    bindModalBackdropDismissal(this.dom.feedbackModal, () => this.closeFeedback());
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (this.isFeedbackOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.closeFeedback();
      } else if (this.isKeybindsOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.closeKeybinds();
      } else if (this.isOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
      }
    });
    this.dom.version.textContent = this.app.version;
    this.app.core.events.versionChanged.subscribe(({ version }) => { this.dom.version.textContent = version; });
    this.renderShortcuts();
  }

  get isOpen(): boolean { return !this.dom.helpModal.hasAttribute("hidden"); }
  get isKeybindsOpen(): boolean { return !this.dom.keybindsModal.hasAttribute("hidden"); }
  get isFeedbackOpen(): boolean { return !this.dom.feedbackModal.hasAttribute("hidden"); }

  open(): void { this.show(this.dom.helpModal); }
  close(): void { this.hide(this.dom.helpModal); }
  openKeybinds(): void { this.show(this.dom.keybindsModal); }
  closeKeybinds(): void { this.hide(this.dom.keybindsModal); }
  openFeedback(): void {
    this.close();
    this.show(this.dom.feedbackModal);
    this.updateFeedbackForm();
    this.dom.feedbackDescription.focus();
  }

  closeFeedback(): void {
    if (this.#submitting) return;
    this.hide(this.dom.feedbackModal);
  }

  private renderShortcuts(): void {
    this.dom.keybindsContent.replaceChildren();
    for (const group of GROUPS) {
      const section = document.createElement("div");
      section.className = "keybindSection";
      const header = document.createElement("div");
      header.className = "keybindHeader";
      header.textContent = group;
      const description = document.createElement("div");
      description.className = "keybindAction";
      description.style.paddingBottom = "8px";
      description.textContent = group === "Global" ? "These keybinds work in any mode" : `These keybinds work in ${group} mode`;
      section.append(header, description);
      for (const shortcut of SHORTCUT_CATALOG) {
        if (shortcut.helpGroup !== group || !shortcut.display || !shortcut.label) continue;
        const row = document.createElement("div");
        row.className = "keybindRow";
        const keys = document.createElement("span");
        keys.className = "keybindKeys";
        keys.textContent = shortcut.display;
        const label = document.createElement("span");
        label.className = "keybindAction";
        label.textContent = shortcut.label;
        row.append(keys, label);
        section.appendChild(row);
      }
      this.dom.keybindsContent.appendChild(section);
    }
  }

  private selectProduct(product: FeedbackProduct): void {
    this.#product = product;
    this.updateTagSelection(this.dom.feedbackProductTags, product, "feedbackProduct");
    this.updateFeedbackForm();
  }

  private selectFeedbackType(feedbackType: FeedbackType): void {
    this.#feedbackType = feedbackType;
    this.updateTagSelection(this.dom.feedbackTypeTags, feedbackType, "feedbackType");
    this.updateFeedbackForm();
  }

  private selectArea(area: FeedbackArea): void {
    this.#area = this.#area === area ? null : area;
    this.updateTagSelection(this.dom.feedbackAreaTags, this.#area, "feedbackArea");
  }

  private updateTagSelection(tags: readonly HTMLButtonElement[], selected: string | null, dataKey: "feedbackProduct" | "feedbackType" | "feedbackArea"): void {
    for (const tag of tags) {
      const isSelected = tag.dataset[dataKey] === selected;
      tag.classList.toggle("selected", isSelected);
      tag.setAttribute("aria-pressed", String(isSelected));
    }
  }

  private updateFeedbackForm(): void {
    const length = this.dom.feedbackDescription.value.length;
    this.dom.feedbackDescriptionCount.textContent = `${length.toLocaleString()} / 2,000`;
    const valid = !!this.dom.feedbackDescription.value.trim() && !!this.#product && !!this.#feedbackType;
    this.dom.feedbackSend.disabled = this.#submitting;
    if (feedbackTelemetry.remainingRateLimitMs() > 0) {
      this.dom.feedbackValidation.textContent = feedbackTelemetry.rateLimitMessage();
    } else if (valid) this.dom.feedbackValidation.textContent = "";
  }

  private async submitFeedback(): Promise<void> {
    const description = this.dom.feedbackDescription.value.trim();
    if (!description || !this.#product || !this.#feedbackType) {
      this.dom.feedbackValidation.textContent = "Please add a description, product, and feedback type.";
      return;
    }
    if (feedbackTelemetry.remainingRateLimitMs() > 0) {
      this.dom.feedbackValidation.textContent = feedbackTelemetry.rateLimitMessage();
      return;
    }

    this.#submitting = true;
    this.dom.feedbackSend.textContent = "Sending…";
    this.updateFeedbackForm();
    this.dom.feedbackValidation.textContent = "";
    let routeJson: string | null = null;
    try {
      if (this.dom.feedbackRoute.checked) {
        routeJson = JSON.stringify(this.serializer.exportPayload("both", "Feedback submission", this.app.settings.current));
      }
      const result = await feedbackTelemetry.submit({
        description,
        product: this.#product,
        feedbackType: this.#feedbackType,
        area: this.#area,
        routeJson,
        appMode: this.app.core.mode.getMode(),
        submittedAt: new Date().toISOString(),
      });
      if (result === "rate_limited") {
        this.dom.feedbackValidation.textContent = feedbackTelemetry.rateLimitMessage();
        return;
      }
      this.dom.feedbackDeliveryStatus.textContent = result === "sent"
        ? "Thanks! Your feedback was sent."
        : "Feedback saved. It will send automatically when MotionView reconnects.";
      this.dom.feedbackDeliveryStatus.hidden = false;
    } catch (error) {
      console.error("Unable to submit feedback:", error);
      this.dom.feedbackValidation.textContent = "Unable to prepare your feedback. Please try again.";
    } finally {
      this.#submitting = false;
      this.dom.feedbackCancel.disabled = false;
      this.dom.feedbackSend.textContent = "Send feedback";
      this.updateFeedbackForm();
    }
  }

  private show(modal: HTMLElement): void {
    modal.removeAttribute("hidden");
    modal.style.display = "flex";
  }

  private hide(modal: HTMLElement): void {
    modal.setAttribute("hidden", "");
    modal.style.display = "none";
  }
}
