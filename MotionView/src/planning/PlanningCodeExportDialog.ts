import { TypedEvent } from "../app/typedEvent";
import { setStatus } from "../app/status";
import { exportPlanningCode, isTauriRuntime, resolveExportDirectory } from "../tauri/commands";
import { planningTelemetry } from "../telemetry/createTelemetry";
import type { PlanningDom } from "./PlanningDom";
import type { PlanningFeature } from "./PlanningFeature";
import { generatePlanningCode } from "./planningCode";

export type PlanningCodeExportTarget = "downloads" | "desktop" | "documents" | "project" | "custom";

export interface PlanningCodeExportSettings {
  readonly header: string;
  readonly footer: string;
  readonly target: PlanningCodeExportTarget;
  readonly path: string;
}

const DEFAULT_FILENAME = "autonomous.cpp";

export class PlanningCodeExportDialog {
  readonly changed = new TypedEvent<PlanningCodeExportSettings>();
  #projectPath = "";
  #bound = false;

  constructor(
    private readonly planning: PlanningFeature,
    private readonly dom: PlanningDom,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.dom.exportCode.addEventListener("click", () => void this.open());
    this.dom.codeExportClose.addEventListener("click", () => this.close());
    this.dom.codeExportCancel.addEventListener("click", () => this.close());
    this.dom.codeExportConfirm.addEventListener("click", () => void this.export());
    this.dom.codeExportModal.addEventListener("click", (event) => {
      if (event.target === this.dom.codeExportModal) this.close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
      }
    });
    this.dom.codeExportTarget.addEventListener("change", () => void this.selectTarget());
    for (const input of [this.dom.codeExportHeader, this.dom.codeExportFooter, this.dom.codeExportPath]) {
      input.addEventListener("input", () => {
        if (input === this.dom.codeExportPath) this.dom.codeExportTarget.value = "custom";
        this.clearResult();
        this.updateValidation();
        this.emitChanged();
      });
    }
  }

  get settings(): PlanningCodeExportSettings {
    return {
      header: this.dom.codeExportHeader.value,
      footer: this.dom.codeExportFooter.value,
      target: this.target,
      path: this.dom.codeExportPath.value.trim(),
    };
  }

  applySettings(settings: Partial<PlanningCodeExportSettings> | null | undefined): void {
    if (!settings) return;
    this.dom.codeExportHeader.value = String(settings.header ?? "");
    this.dom.codeExportFooter.value = String(settings.footer ?? "");
    this.dom.codeExportTarget.value = this.isTarget(settings.target) ? settings.target : "downloads";
    this.dom.codeExportPath.value = String(settings.path ?? "");
    this.updateProjectAvailability();
    this.updateValidation();
  }

  setProjectPath(path: string): void {
    this.#projectPath = path.trim();
    this.updateProjectAvailability();
  }

  get isOpen(): boolean { return !this.dom.codeExportModal.hasAttribute("hidden"); }

  close(): void {
    this.dom.codeExportModal.setAttribute("hidden", "");
    this.dom.codeExportModal.style.display = "none";
  }

  private async open(): Promise<void> {
    this.updateProjectAvailability();
    if (!this.dom.codeExportPath.value.trim() && this.target !== "custom") await this.fillTargetPath();
    this.clearResult();
    this.updateValidation();
    this.dom.codeExportModal.removeAttribute("hidden");
    this.dom.codeExportModal.style.display = "flex";
    requestAnimationFrame(() => this.dom.codeExportHeader.focus());
  }

  private async selectTarget(): Promise<void> {
    this.clearResult();
    if (this.target !== "custom") await this.fillTargetPath();
    this.updateValidation();
    this.emitChanged();
  }

  private async fillTargetPath(): Promise<void> {
    if (!isTauriRuntime()) {
      this.dom.codeExportValidation.textContent = "Code file export is available in the desktop app.";
      return;
    }
    if (this.target === "project" && !this.#projectPath) {
      this.dom.codeExportValidation.textContent = "Select a valid PROS project before using this target.";
      return;
    }
    try {
      const projectSourcePath = this.target === "project"
        ? this.joinPath(this.#projectPath, "src")
        : undefined;
      const directory = await resolveExportDirectory(this.target, projectSourcePath);
      const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
      this.dom.codeExportPath.value = `${directory.replace(/[\\/]+$/, "")}${separator}${DEFAULT_FILENAME}`;
    } catch (error) {
      this.dom.codeExportValidation.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  private async export(): Promise<void> {
    const code = generatePlanningCode(this.planning);
    const path = this.dom.codeExportPath.value.trim();
    if (!code || !path || !isTauriRuntime()) {
      this.updateValidation();
      return;
    }
    const sections = [this.dom.codeExportHeader.value, code, this.dom.codeExportFooter.value]
      .filter((section) => section.length > 0);
    const contents = sections.join("\n");
    this.dom.codeExportConfirm.disabled = true;
    try {
      const result = await exportPlanningCode(path, contents);
      this.dom.codeExportSuccess.textContent = `Exported to ${result.path}`;
      this.dom.codeExportSuccess.classList.remove("isError");
      this.dom.codeExportSuccess.hidden = false;
      this.dom.codeExportValidation.textContent = "";
      setStatus(`Exported planning code to ${result.path}`);
      this.emitChanged();
      void planningTelemetry.templateExported(this.planning.templateExportTelemetryProperties({
        export_surface: "file",
        exported_chars: contents.length,
      }));
    } catch (error) {
      this.dom.codeExportSuccess.textContent = `Failed to export file: ${error instanceof Error ? error.message : String(error)}`;
      this.dom.codeExportSuccess.classList.add("isError");
      this.dom.codeExportSuccess.hidden = false;
      this.dom.codeExportValidation.textContent = "";
    } finally {
      this.updateValidation();
    }
  }

  private updateValidation(): void {
    const code = generatePlanningCode(this.planning);
    const path = this.dom.codeExportPath.value.trim();
    let message = "";
    if (!isTauriRuntime()) message = "Code file export is available in the desktop app.";
    else if (!code) message = "Add at least one waypoint and a template before exporting code.";
    else if (!path) message = "Enter an export path including a filename.";
    this.dom.codeExportValidation.textContent = message;
    this.dom.codeExportConfirm.disabled = message.length > 0;
  }

  private updateProjectAvailability(): void {
    const option = this.dom.codeExportTarget.querySelector<HTMLOptionElement>('option[value="project"]');
    if (option) option.disabled = !this.#projectPath;
  }

  private emitChanged(): void { this.changed.emit(this.settings); }

  private clearResult(): void {
    this.dom.codeExportSuccess.hidden = true;
    this.dom.codeExportSuccess.classList.remove("isError");
    this.dom.codeExportSuccess.textContent = "";
  }

  private joinPath(parent: string, child: string): string {
    const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
    return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
  }

  private get target(): PlanningCodeExportTarget {
    return this.isTarget(this.dom.codeExportTarget.value) ? this.dom.codeExportTarget.value : "downloads";
  }

  private isTarget(value: unknown): value is PlanningCodeExportTarget {
    return value === "downloads" || value === "desktop" || value === "documents"
      || value === "project" || value === "custom";
  }
}
