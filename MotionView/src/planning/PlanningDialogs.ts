import type { PlanningDom } from "./PlanningDom";
import { bindModalBackdropDismissal } from "../app/dialogs/modalDismissal";

export interface PlanningConfirmOptions {
  readonly title?: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

export interface PlanningEditorOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly groupTitle?: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly code: string;
  readonly showCode?: boolean;
  readonly name?: string;
  readonly nameDescription?: string;
  readonly confirmLabel?: string;
}

export interface PlanningEditorResult {
  readonly name: string;
  readonly code: string;
}

/** Owns Planning modal state and resolves each modal interaction exactly once. */
export class PlanningDialogs {
  #confirmResolver: ((confirmed: boolean) => void) | null = null;
  #editorResolver: ((result: PlanningEditorResult | null) => void) | null = null;
  #editorUsesName = false;
  #editorUsesCode = true;
  #bound = false;

  constructor(private readonly dom: PlanningDom) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.dom.confirmClose.addEventListener("click", () => this.closeConfirm(false));
    this.dom.confirmCancel.addEventListener("click", () => this.closeConfirm(false));
    this.dom.confirmButton.addEventListener("click", () => this.closeConfirm(true));
    bindModalBackdropDismissal(this.dom.confirmModal, () => this.closeConfirm(false));
    this.dom.templateClose.addEventListener("click", () => this.closeEditor(null));
    this.dom.templateCancel.addEventListener("click", () => this.closeEditor(null));
    this.dom.templateConfirm.addEventListener("click", () => this.confirmEditor());
    bindModalBackdropDismissal(this.dom.templateModal, () => this.closeEditor(null));
  }

  confirm(options: PlanningConfirmOptions): Promise<boolean> {
    this.closeConfirm(false);
    this.#confirmResolver = null;
    this.dom.confirmTitle.textContent = options.title ?? "Confirm";
    this.dom.confirmMessage.textContent = options.message;
    this.dom.confirmButton.textContent = options.confirmLabel ?? "Confirm";
    this.dom.confirmCancel.textContent = options.cancelLabel ?? "Cancel";
    this.show(this.dom.confirmModal, this.dom.confirmModal.querySelector<HTMLElement>(".modalCard"));
    return new Promise((resolve) => { this.#confirmResolver = resolve; });
  }

  edit(options: PlanningEditorOptions): Promise<PlanningEditorResult | null> {
    this.closeEditor(null);
    this.#editorResolver = null;
    this.#editorUsesName = options.name !== undefined;
    this.#editorUsesCode = options.showCode !== false;
    this.dom.templateTitle.textContent = options.title;
    this.dom.templateSubtitle.textContent = options.subtitle ?? "";
    this.dom.templateGroupTitle.textContent = options.groupTitle ?? "Editor";
    this.dom.templateDescription.textContent = options.description ?? "";
    this.dom.templateCode.value = options.code;
    this.dom.templateCode.placeholder = options.placeholder ?? "";
    this.dom.templateCode.hidden = !this.#editorUsesCode;
    this.dom.templateDescription.hidden = false;
    this.dom.templateNameField.hidden = !this.#editorUsesName;
    this.dom.templateName.value = options.name ?? "";
    this.dom.templateNameDescription.textContent = options.nameDescription ?? "Name";
    this.dom.templateConfirm.textContent = options.confirmLabel ?? "Confirm";
    this.dom.templateValidation.hidden = true;
    this.dom.templateValidation.textContent = "";
    this.show(this.dom.templateModal, this.#editorUsesName ? this.dom.templateName : this.dom.templateCode);
    return new Promise((resolve) => { this.#editorResolver = resolve; });
  }

  get isOpen(): boolean {
    return this.#confirmResolver != null || this.#editorResolver != null;
  }

  cancelOpen(): boolean {
    if (this.#editorResolver) { this.closeEditor(null); return true; }
    if (this.#confirmResolver) { this.closeConfirm(false); return true; }
    return false;
  }

  private confirmEditor(): void {
    if (!this.#editorResolver) return;
    const name = this.dom.templateName.value.trim().slice(0, 25);
    if (this.#editorUsesName && !name) {
      this.dom.templateValidation.textContent = "Enter a name to continue.";
      this.dom.templateValidation.hidden = false;
      this.dom.templateName.focus();
      return;
    }
    this.closeEditor({ name, code: this.dom.templateCode.value });
  }

  private closeConfirm(result: boolean): void {
    const resolve = this.#confirmResolver;
    this.#confirmResolver = null;
    this.hide(this.dom.confirmModal);
    resolve?.(result);
  }

  private closeEditor(result: PlanningEditorResult | null): void {
    const resolve = this.#editorResolver;
    this.#editorResolver = null;
    this.#editorUsesName = false;
    this.#editorUsesCode = true;
    this.hide(this.dom.templateModal);
    resolve?.(result);
  }

  private show(modal: HTMLElement, focusTarget: HTMLElement | null): void {
    modal.removeAttribute("hidden");
    modal.style.display = "flex";
    requestAnimationFrame(() => {
      focusTarget?.focus();
      if (focusTarget instanceof HTMLInputElement) focusTarget.select();
      else if (focusTarget instanceof HTMLTextAreaElement) {
        focusTarget.setSelectionRange(focusTarget.value.length, focusTarget.value.length);
      }
    });
  }

  private hide(modal: HTMLElement): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && modal.contains(active)) active.blur();
    modal.setAttribute("hidden", "");
    modal.style.display = "none";
  }
}
