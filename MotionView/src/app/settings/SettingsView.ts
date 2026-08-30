import { TypedEvent } from "../typedEvent";
import { bindModalBackdropDismissal } from "../dialogs/modalDismissal";
import type { FieldRenderer } from "../../render/field";
import type { SettingsDom } from "./SettingsDom";

export class SettingsView {
  readonly robotImageRequested = new TypedEvent<Record<string, never>>();
  #bound = false;

  constructor(private readonly field: FieldRenderer, private readonly dom: SettingsDom) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.close();
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

  get isOpen(): boolean { return !this.dom.modal.hasAttribute("hidden") && this.dom.modal.style.display !== "none"; }

  open(): void {
    this.refreshRobotImageAvailability();
    this.dom.modal.removeAttribute("hidden");
    this.dom.modal.style.display = "flex";
    requestAnimationFrame(() => this.dom.modal.querySelector<HTMLElement>(".modalCard")?.focus());
  }

  close(): void {
    this.dom.modal.setAttribute("hidden", "");
    this.dom.modal.style.display = "none";
  }

  refreshRobotImageAvailability(): void {
    const available = this.field.isRobotImageReady();
    this.dom.robotImageToggle.checked = this.field.isRobotImageEnabled();
    this.dom.robotImageControls.hidden = !(available && this.field.isRobotImageEnabled());
    if (this.dom.sidebarRobotImageControls) this.dom.sidebarRobotImageControls.hidden = !available;
  }
}
