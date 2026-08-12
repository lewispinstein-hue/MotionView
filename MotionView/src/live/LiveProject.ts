import type { BridgeService } from "../app/BridgeService";
import type { LiveEvents } from "./LiveEvents";
import type { LiveProjectStatus, ProsDirectoryResponse, ProsDiscoveryResponse } from "./liveTypes";

export class LiveProject {
  #path = "";
  #valid = false;
  #restored = false;
  #status: LiveProjectStatus = { kind: "missing", message: "PROS directory not set. Live viewing disabled." };
  #validationId = 0;

  constructor(
    private readonly bridge: BridgeService,
    private readonly events: LiveEvents,
  ) {}

  get path(): string { return this.#path; }
  get valid(): boolean { return this.#valid; }
  get status(): LiveProjectStatus { return this.#status; }

  restore(path: string): void {
    const next = this.normalizePath(path);
    this.#restored = next.length > 0;
    this.#path = next;
    this.#valid = false;
    this.#status = next
      ? { kind: "checking", message: "Waiting to validate PROS project..." }
      : { kind: "missing", message: "PROS directory not set. Live viewing disabled." };
    this.emit();
  }

  async validate(path = this.#path): Promise<boolean> {
    const validationId = ++this.#validationId;
    const next = this.normalizePath(path);
    this.#path = next;
    this.#valid = false;
    if (!next) {
      this.#status = { kind: "missing", message: "PROS directory not set. Live viewing disabled." };
      this.emit();
      return false;
    }

    this.#status = { kind: "checking", message: "Validating PROS project..." };
    this.emit();
    let ready = false;
    for (let attempt = 0; attempt < 5 && validationId === this.#validationId; attempt += 1) {
      ready = await this.bridge.waitUntilReady(attempt === 0 ? 4_000 : 1_000, 250);
      if (ready) break;
      if (attempt < 4) await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    if (validationId !== this.#validationId) return false;
    if (!ready) {
      this.#status = { kind: "unavailable", message: "Bridge not ready yet. Try again in a moment." };
      this.emit();
      return false;
    }

    const response = await this.bridge.post<ProsDirectoryResponse>("/api/pros-dir", { dir: next });
    if (validationId !== this.#validationId) return false;
    if (response.ok && response.json?.ok) {
      this.#path = this.normalizePath(response.json.dir ?? next);
      this.#valid = true;
      this.#status = { kind: "valid", message: `Using PROS project: ${this.#path}` };
      this.emit();
      this.events.notice.emit({ kind: "success", message: `PROS directory set to: ${this.#path}` });
      return true;
    }

    const reason = response.json?.status || "validation failed";
    this.#status = { kind: "invalid", message: `Invalid PROS directory: ${reason}` };
    this.emit();
    this.events.notice.emit({ kind: "error", message: `Failed to set PROS directory: ${reason}` });
    return false;
  }

  async loadBackendPath(): Promise<void> {
    if (this.#restored || this.#path) {
      await this.validate();
      return;
    }
    if (!(await this.bridge.waitUntilReady())) {
      this.#status = { kind: "unavailable", message: "Bridge not ready yet." };
      this.emit();
      return;
    }
    const response = await this.bridge.get<ProsDirectoryResponse>("/api/pros-dir");
    const path = this.normalizePath(response.json?.dir ?? "");
    if (!response.ok || !response.json?.ok || !path) {
      this.#valid = false;
      this.#status = { kind: "missing", message: "PROS directory not set. Live viewing disabled." };
      this.emit();
      return;
    }
    this.#path = path;
    this.#valid = true;
    this.#status = { kind: "valid", message: `Using PROS project: ${path}` };
    this.emit();
  }

  async discover(): Promise<readonly string[]> {
    if (!(await this.bridge.waitUntilReady())) {
      this.events.notice.emit({ kind: "error", message: "Backend not ready." });
      return [];
    }
    const response = await this.bridge.get<ProsDiscoveryResponse>("/api/pros-dir/auto");
    if (!response.ok || !response.json?.ok) {
      this.events.notice.emit({ kind: "error", message: response.json?.status || "Auto-detect failed." });
      return [];
    }
    return response.json.candidates ?? [];
  }

  private normalizePath(path: string): string {
    const value = String(path ?? "").trim();
    return value === "None" ? "" : value;
  }

  private emit(): void {
    this.events.projectChanged.emit({ path: this.#path, valid: this.#valid, status: this.#status });
  }
}

