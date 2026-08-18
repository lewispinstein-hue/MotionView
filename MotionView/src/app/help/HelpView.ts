import { bindModalBackdropDismissal } from "../dialogs/modalDismissal";
import type { MotionViewApp } from "../MotionViewApp";
import { SHORTCUT_CATALOG } from "../input/shortcutCatalog";
import type { ShortcutHelpGroup } from "../input/shortcutTypes";
import type { HelpDom } from "./HelpDom";

const GROUPS: readonly ShortcutHelpGroup[] = ["Global", "Viewing", "Planning"];

export class HelpView {
  #bound = false;

  constructor(
    private readonly app: MotionViewApp,
    private readonly dom: HelpDom,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.dom.helpClose.addEventListener("click", () => this.close());
    this.dom.showKeybinds.addEventListener("click", () => this.openKeybinds());
    this.dom.keybindsClose.addEventListener("click", () => this.closeKeybinds());
    bindModalBackdropDismissal(this.dom.helpModal, () => this.close());
    bindModalBackdropDismissal(this.dom.keybindsModal, () => this.closeKeybinds());
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (this.isKeybindsOpen) {
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

  open(): void { this.show(this.dom.helpModal); }
  close(): void { this.hide(this.dom.helpModal); }
  openKeybinds(): void { this.show(this.dom.keybindsModal); }
  closeKeybinds(): void { this.hide(this.dom.keybindsModal); }

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

  private show(modal: HTMLElement): void {
    modal.removeAttribute("hidden");
    modal.style.display = "flex";
  }

  private hide(modal: HTMLElement): void {
    modal.setAttribute("hidden", "");
    modal.style.display = "none";
  }
}
