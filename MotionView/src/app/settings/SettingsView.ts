import { TypedEvent } from "../typedEvent";
import { bindModalBackdropDismissal } from "../dialogs/modalDismissal";
import type { FieldRenderer } from "../../render/field";
import type { SettingsDom } from "./SettingsDom";

/** Owns Settings modal visibility and modal-level user intent. */
export class SettingsView {
  readonly closing = new TypedEvent<Record<string, never>>();
  readonly robotImageRequested = new TypedEvent<Record<string, never>>();
  #bound = false;

  constructor(
    private readonly field: FieldRenderer,
    private readonly dom: SettingsDom,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.dom.modal.setAttribute("hidden", "");
    this.dom.modal.style.display = "none";
    this.dom.closeButton.addEventListener("click", () => this.close());
    this.dom.uploadRobotImageButton.addEventListener("click", () => this.robotImageRequested.emit({}));
    bindModalBackdropDismissal(this.dom.modal, () => this.close());
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.isOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    }, true);
  }

  get isOpen(): boolean {
    return !this.dom.modal.hasAttribute("hidden") && this.dom.modal.style.display !== "none";
  }

  open(): void {
    this.dom.robotImageControls.hidden = !(this.field.isRobotImageEnabled() && this.field.isRobotImageReady());
    this.dom.robotImageToggle.checked = this.field.isRobotImageEnabled();
    this.dom.modal.removeAttribute("hidden");
    this.dom.modal.style.display = "flex";
    requestAnimationFrame(() => this.dom.modal.querySelector<HTMLElement>(".modalCard")?.focus());
  }

  close(): void {
    if (!this.isOpen) return;
    this.closing.emit({});
    this.dom.modal.setAttribute("hidden", "");
    this.dom.modal.style.display = "none";
  }
}
