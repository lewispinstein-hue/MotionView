import { setStatus } from "../app/status";
import { LiveConsoleBuffer } from "./liveConsole";
import type { LiveDom } from "./LiveDom";
import type { LiveFeature } from "./LiveFeature";
import type { LiveNoticeKind } from "./liveTypes";

export class LiveView {
  readonly #console: LiveConsoleBuffer;
  #bound = false;
  #projectInputTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly live: LiveFeature,
    private readonly dom: LiveDom,
  ) {
    this.#console = new LiveConsoleBuffer(dom.console);
  }

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.live.events.connectionChanged.subscribe(() => this.renderControls());
    this.live.events.streamChanged.subscribe(() => this.renderControls());
    this.live.events.projectChanged.subscribe((event) => {
      if (this.dom.projectInput && this.dom.projectInput.value !== event.path) this.dom.projectInput.value = event.path;
      this.renderProject();
      this.renderControls();
    });
    this.live.events.preferencesChanged.subscribe(() => this.renderPreferences());
    this.live.events.consoleChanged.subscribe((event) => {
      if (event.kind === "reset") this.#console.reset();
      else this.#console.appendLine(event.line);
    });
    this.live.events.notice.subscribe((event) => {
      setStatus(event.message);
      if (event.kind === "error") this.#console.appendLine(`[UI] ${event.message}`);
    });

    this.dom.startStopButton?.addEventListener("click", (event) => void this.toggleStream(event));
    this.dom.refreshButton?.addEventListener("click", () => this.live.stream.refreshNow());
    this.dom.refreshInterval?.addEventListener("change", () => {
      this.live.preferences.setRefreshInterval(Number(this.dom.refreshInterval?.value ?? 0));
    });
    this.dom.projectInput?.addEventListener("input", () => {
      if (this.#projectInputTimer) clearTimeout(this.#projectInputTimer);
      this.live.project.restore(this.dom.projectInput?.value ?? "");
      this.#projectInputTimer = setTimeout(() => void this.live.project.validate(), 500);
    });
    this.dom.autoDetectButton?.addEventListener("click", () => void this.discoverProjects());
    this.render();
  }

  render(): void {
    this.renderControls();
    this.renderProject();
    this.renderPreferences();
  }

  resetConsole(): void {
    this.#console.reset();
  }

  private async toggleStream(event: MouseEvent): Promise<void> {
    if (event.metaKey || event.ctrlKey) await this.live.stop({ force: true });
    else if (this.live.stream.streaming) await this.live.stop();
    else await this.live.start();
  }

  private renderControls(): void {
    const connectionBusy = this.live.connection.state === "connecting" || this.live.connection.state === "disconnecting";
    const streamBusy = this.live.stream.state === "starting" || this.live.stream.state === "stopping";
    const busy = connectionBusy || streamBusy;
    const streaming = this.live.stream.streaming || this.live.stream.state === "stopping";
    if (this.dom.startStopButton) {
      this.dom.startStopButton.disabled = busy || (!this.live.project.valid && !this.live.connection.connected);
      this.dom.startStopButton.textContent = streaming ? "Stop" : "Start";
      this.dom.startStopButton.classList.toggle("isOn", streaming);
      this.dom.startStopButton.title = streaming
        ? "Stop streaming. Cmd/Ctrl+Click to force kill."
        : "Start streaming.";
    }
    if (this.dom.refreshButton) this.dom.refreshButton.disabled = !streaming || busy;
    if (this.dom.fileButton) this.dom.fileButton.disabled = streaming;
    if (this.dom.playButton && streaming) this.dom.playButton.disabled = true;
  }

  private renderProject(): void {
    this.setMessage(this.dom.projectStatus, this.live.project.status.message, this.statusKind());
  }

  private renderPreferences(): void {
    if (this.dom.refreshInterval) this.dom.refreshInterval.value = String(this.live.preferences.refreshIntervalMs);
  }

  private async discoverProjects(): Promise<void> {
    this.setMessage(this.dom.autoStatus, "Scanning...");
    const candidates = await this.live.project.discover();
    this.renderCandidates(candidates);
    this.setMessage(this.dom.autoStatus, `Found ${candidates.length} project(s).`, candidates.length ? "success" : "info");
  }

  private renderCandidates(candidates: readonly string[]): void {
    const target = this.dom.autoResults;
    if (!target) return;
    target.replaceChildren();
    target.hidden = candidates.length === 0;
    for (const path of candidates) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "center";
      row.style.marginBottom = "6px";
      const pathElement = document.createElement("div");
      pathElement.textContent = path;
      pathElement.style.flex = "1";
      pathElement.style.fontFamily = "monospace";
      pathElement.style.fontSize = "12px";
      const useButton = document.createElement("button");
      useButton.className = "iconBtn";
      useButton.style.fontSize = "11px";
      useButton.textContent = "Use";
      useButton.addEventListener("click", () => {
        this.live.project.restore(path);
        void this.live.project.validate();
        target.hidden = true;
        this.setMessage(this.dom.autoStatus, "Applied.", "success");
      });
      row.append(pathElement, useButton);
      target.appendChild(row);
    }
  }

  private statusKind(): LiveNoticeKind {
    if (this.live.project.status.kind === "valid") return "success";
    if (this.live.project.status.kind === "checking") return "info";
    return "error";
  }

  private setMessage(element: HTMLElement | null, message: string, kind: LiveNoticeKind = "info"): void {
    if (!element) return;
    element.textContent = message;
    element.style.color = kind === "error" ? "#ff9b9b" : kind === "success" ? "#9fddb0" : "var(--muted)";
  }
}
