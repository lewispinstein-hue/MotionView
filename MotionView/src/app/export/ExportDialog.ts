import type { MotionViewApp } from "../MotionViewApp";
import { bindModalBackdropDismissal } from "../dialogs/modalDismissal";
import type { ExportDom } from "./ExportDom";
import type { ExportService } from "./ExportService";
import type { ExportLocation, ExportRequest } from "./exportTypes";
import type { MotionViewExportType } from "../persistence";

function filename(value: string): string { return value.replace(/\.json\s*$/i, "").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").replace(/[^A-Za-z0-9 _-]/g, "").trim(); }
function pathName(value: string): string { return value.replace(/\s+/g, " ").trim(); }

export class ExportDialog {
  #bound = false;
  #submitError = "";
  constructor(private readonly app: MotionViewApp, private readonly dom: ExportDom, private readonly service: ExportService) {}
  bind(): void {
    if (this.#bound) return; this.#bound = true;
    this.dom.open.addEventListener("click", () => this.open());
    this.dom.close.addEventListener("click", () => this.close()); this.dom.cancel.addEventListener("click", () => this.close()); this.dom.confirm.addEventListener("click", () => void this.submit());
    this.dom.pathName.addEventListener("input", () => { this.#submitError = ""; this.dom.pathName.value = pathName(this.dom.pathName.value); this.render(); });
    this.dom.filename.addEventListener("input", () => { this.#submitError = ""; this.dom.filename.value = filename(this.dom.filename.value); this.render(); });
    this.dom.location.addEventListener("change", () => { this.#submitError = ""; this.render(); }); this.dom.type.addEventListener("change", () => { this.#submitError = ""; this.render(); }); this.dom.customPath.addEventListener("input", () => { this.#submitError = ""; this.render(); });
    bindModalBackdropDismissal(this.dom.modal, () => this.close());
    window.addEventListener("keydown", (event) => { if (event.key === "Escape" && this.isOpen) { event.preventDefault(); event.stopImmediatePropagation(); this.close(); } }, true);
    this.app.planning.events.documentChanged.subscribe(() => this.renderAvailability()); this.app.viewing.events.dataChanged.subscribe(() => this.renderAvailability()); this.app.live.events.streamChanged.subscribe(() => this.renderAvailability()); this.app.live.events.projectChanged.subscribe(() => this.render());
    this.renderAvailability();
  }
  get isOpen(): boolean { return !this.dom.modal.hasAttribute("hidden"); }
  open(type: MotionViewExportType = this.app.core.mode.getMode()): void { if (!this.dom.pathName.value) this.dom.pathName.value = "Untitled Path"; if (!this.dom.filename.value) this.dom.filename.value = "motionview-path"; this.dom.type.value = type; this.#submitError = ""; this.dom.success.hidden = true; this.render(); this.dom.modal.removeAttribute("hidden"); this.dom.modal.style.display = "flex"; requestAnimationFrame(() => this.dom.pathName.focus()); }
  close(): void { this.dom.modal.setAttribute("hidden", ""); this.dom.modal.style.display = "none"; }
  private renderAvailability(): void { this.dom.open.disabled = this.app.live.stream.state !== "idle" || !(this.app.planning.hasData || this.app.viewing.data.hasData); }
  private render(): void {
    this.syncProjectOption(); const type = this.exportType; const location = this.location; const validType = type === "viewing" ? this.app.viewing.data.hasData : type === "planning" ? this.app.planning.hasData : this.app.viewing.data.hasData || this.app.planning.hasData;
    this.dom.customWrap.hidden = location !== "custom"; this.dom.filenameHint.textContent = this.dom.filename.value ? `File: ${filename(this.dom.filename.value)}.json` : "Only letters, numbers, spaces, dashes, and underscores are kept."; this.dom.customHint.textContent = location === "project" ? "Exports to the configured PROS project's MotionView-Routes folder." : "Enter a folder path.";
    const message = !pathName(this.dom.pathName.value) ? "Enter a path name to continue." : !filename(this.dom.filename.value) ? "Enter a filename to continue." : location === "custom" && !this.dom.customPath.value.trim() ? "Enter a custom folder path to continue." : !validType ? `There is no ${type === "both" ? "Viewing or Planning" : type === "viewing" ? "Viewing mode" : "Planning mode"} data to export.` : this.#submitError;
    this.dom.validation.textContent = message; this.dom.confirm.disabled = !!message;
  }
  private async submit(): Promise<void> {
    this.render(); if (this.dom.confirm.disabled) return; this.dom.confirm.disabled = true; this.dom.success.hidden = true;
    const request: ExportRequest = { exportType: this.exportType, filenameBase: filename(this.dom.filename.value), pathName: pathName(this.dom.pathName.value), destination: { kind: this.location, customPath: this.location === "custom" ? this.dom.customPath.value.trim() : this.location === "project" ? this.projectDirectory : null } };
    try { await this.service.export(request); this.#submitError = ""; this.dom.success.textContent = `Successfully exported ${request.pathName}.`; this.dom.success.hidden = false; this.dom.validation.textContent = ""; this.app.core.status.setStatus(`Exported ${request.filenameBase}.json.`); }
    catch (error) { console.error("Failed to export MotionView JSON:", error); this.#submitError = `Failed to export file: ${error instanceof Error ? error.message : String(error)}`; }
    finally { this.render(); }
  }
  private syncProjectOption(): void { const option = this.dom.location.querySelector<HTMLOptionElement>('option[value="project"]'); if (this.projectDirectory && !option) { const created = document.createElement("option"); created.value = "project"; created.textContent = "Project Folder"; this.dom.location.insertBefore(created, this.dom.location.querySelector('option[value="custom"]')); } else if (!this.projectDirectory && option) { if (this.dom.location.value === "project") this.dom.location.value = "downloads"; option.remove(); } }
  private get projectDirectory(): string { const path = this.app.live.project.valid ? this.app.live.project.path.trim() : ""; if (!path || path === "None") return ""; const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/"; return `${path.replace(/[\\/]+$/, "")}${separator}MotionView-Routes`; }
  private get location(): ExportLocation { const value = this.dom.location.value; return value === "desktop" || value === "documents" || value === "project" || value === "custom" ? value : "downloads"; }
  private get exportType(): MotionViewExportType { const value = this.dom.type.value; return value === "planning" || value === "both" ? value : "viewing"; }
}
