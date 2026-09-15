import { TypedEvent } from "../typedEvent";
import { SettingsRepository } from "./SettingsRepository";
import { DEFAULT_SETTINGS, type MotionViewSettings, type SettingsChangedEvent } from "./settingsTypes";

export class SettingsFeature {
  readonly changed = new TypedEvent<SettingsChangedEvent>();
  readonly loaded = new TypedEvent<{ readonly settings: Readonly<MotionViewSettings> }>();
  readonly saveFailed = new TypedEvent<{ readonly error: unknown }>();
  readonly #repository = new SettingsRepository();
  #settings: MotionViewSettings = { ...DEFAULT_SETTINGS };
  #loaded = false;
  #saveTimer: number | null = null;

  get current(): Readonly<MotionViewSettings> { return this.#settings; }
  get isLoaded(): boolean { return this.#loaded; }

  async load(): Promise<Readonly<MotionViewSettings>> {
    let missing = false;
    try {
      const stored = await this.#repository.read();
      if (stored) this.#settings = { ...DEFAULT_SETTINGS, ...stored };
      else missing = true;
    } catch (error) {
      console.error("Failed to load settings:", error);
      this.saveFailed.emit({ error });
    }
    this.#loaded = true;
    this.changed.emit({ settings: this.#settings, keys: Object.keys(this.#settings) as (keyof MotionViewSettings)[], source: "load" });
    this.loaded.emit({ settings: this.#settings });
    if (missing) this.scheduleSave();
    return this.#settings;
  }

  update(patch: Partial<MotionViewSettings>, source: SettingsChangedEvent["source"] = "user"): void {
    const keys = (Object.keys(patch) as (keyof MotionViewSettings)[])
      .filter((key) => !Object.is(this.#settings[key], patch[key]));
    if (!keys.length) return;
    const changed = Object.fromEntries(keys.map((key) => [key, patch[key]])) as Partial<MotionViewSettings>;
    this.#settings = { ...this.#settings, ...changed };
    this.changed.emit({ settings: this.#settings, keys, source });
    if (this.#loaded) this.scheduleSave();
  }

  updateAppState(patch: Readonly<Record<string, unknown>>): void {
    this.update({ appState: { ...(this.#settings.appState ?? {}), ...patch } }, "system");
  }

  scheduleSave(): void {
    if (this.#saveTimer !== null) window.clearTimeout(this.#saveTimer);
    this.#saveTimer = window.setTimeout(() => { this.#saveTimer = null; void this.saveNow(); }, 250);
  }

  async saveNow(): Promise<void> {
    if (this.#saveTimer !== null) window.clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    try {
      await this.#repository.write(this.#settings);
    } catch (error) {
      console.error("Failed to save settings:", error);
      this.saveFailed.emit({ error });
    }
  }
}
