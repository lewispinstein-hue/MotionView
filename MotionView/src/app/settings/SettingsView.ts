import { TypedEvent } from "../typedEvent";
import { bindModalBackdropDismissal } from "../dialogs/modalDismissal";
import type { FieldRenderer } from "../../render/field";
import type { SettingsDom } from "./SettingsDom";
import { isTauriRuntime } from "../../tauri/commands";

export class SettingsView {
  readonly robotImageRequested = new TypedEvent<Record<string, never>>();
  readonly customFieldImageRequested = new TypedEvent<Record<string, never>>();
  #bound = false;

  constructor(
    private readonly field: FieldRenderer,
    private readonly dom: SettingsDom,
    private readonly resetWindow: () => Promise<void>,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.close();
    this.dom.closeButton.addEventListener("click", () => this.close());
    this.dom.resetWindowLayoutButton.disabled = !isTauriRuntime();
    this.dom.resetWindowLayoutButton.addEventListener("click", () => void this.resetWindowLayout());
    this.dom.uploadRobotImageButton.addEventListener("click", () =>
      this.robotImageRequested.emit({}),
    );
    this.dom.uploadCustomFieldImageButton.addEventListener("click", () =>
      this.customFieldImageRequested.emit({}),
    );
    bindModalBackdropDismissal(this.dom.modal, () => this.close());
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || !this.isOpen) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return (
      !this.dom.modal.hasAttribute("hidden") &&
      this.dom.modal.style.display !== "none"
    );
  }

  open(): void {
    this.refreshRobotImageAvailability();
    this.refreshCustomFieldImageAvailability();
    this.dom.modal.removeAttribute("hidden");
    this.dom.modal.style.display = "flex";
    requestAnimationFrame(() =>
      this.dom.modal.querySelector<HTMLElement>(".modalCard")?.focus(),
    );
  }

  close(): void {
    this.dom.modal.setAttribute("hidden", "");
    this.dom.modal.style.display = "none";
  }

  private async resetWindowLayout(): Promise<void> {
    this.dom.resetWindowLayoutButton.disabled = true;
    this.dom.windowLayoutStatus.textContent = "Resetting window position and size…";
    try {
      await this.resetWindow();
      this.dom.windowLayoutStatus.textContent = "Window centered at its default size.";
    } catch (error) {
      this.dom.windowLayoutStatus.textContent = `Could not reset window: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.dom.resetWindowLayoutButton.disabled = !isTauriRuntime();
    }
  }

  refreshRobotImageAvailability(): void {
    const available = this.field.isRobotImageReady();
    this.dom.robotImageToggle.checked = this.field.isRobotImageEnabled();
    this.dom.robotImageControls.hidden = !(
      available && this.field.isRobotImageEnabled()
    );
    if (this.dom.sidebarRobotImageControls)
      this.dom.sidebarRobotImageControls.hidden = !available;
  }

  refreshCustomFieldImageAvailability(): void {
    this.dom.customFieldControls.hidden = !this.field.hasCustomFieldImage();
  }
}
