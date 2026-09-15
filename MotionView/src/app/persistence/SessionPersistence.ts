import type { MotionViewApp } from "../MotionViewApp";
import { MotionViewDocumentSerializer } from "./MotionViewDocumentSerializer";
import { SavedPathsRepository } from "./SavedPathsRepository";

export class SessionPersistence {
  readonly #repository = new SavedPathsRepository();
  #timer: number | null = null;
  #bound = false;
  constructor(private readonly app: MotionViewApp, private readonly serializer: MotionViewDocumentSerializer) {}
  bind(): void {
    if (this.#bound) return; this.#bound = true;
    this.app.planning.events.documentChanged.subscribe(() => this.schedule());
    this.app.viewing.events.dataChanged.subscribe(() => this.schedule());
  }
  async restore(): Promise<boolean> {
    try {
      const serialized = await this.#repository.read(); if (!serialized) return false;
      const document: unknown = JSON.parse(serialized); this.app.planning.load(document); this.app.viewing.load(document); return this.app.planning.hasData || this.app.viewing.data.hasData;
    } catch (error) { console.warn("Failed to load saved paths:", error); return false; }
  }
  schedule(): void { if (this.#timer !== null) window.clearTimeout(this.#timer); this.#timer = window.setTimeout(() => { this.#timer = null; void this.saveNow(); }, 300); }
  async saveNow(): Promise<void> { if (this.#timer !== null) window.clearTimeout(this.#timer); this.#timer = null; try { await this.#repository.write(this.serializer.savedPaths()); } catch (error) { console.warn("Failed to save paths:", error); } }
}
