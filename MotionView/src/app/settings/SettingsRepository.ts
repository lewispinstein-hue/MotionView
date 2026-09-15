import { isTauriRuntime, readSettings, writeSettings } from "../../tauri/commands";
import { isMotionViewSettings, type MotionViewSettings } from "./settingsTypes";

/** Owns serialization and native persistence of the settings document. */
export class SettingsRepository {
  async read(): Promise<Readonly<MotionViewSettings> | null> {
    if (!isTauriRuntime()) return null;
    const serialized = await readSettings();
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (!isMotionViewSettings(parsed)) throw new Error("Settings file must contain a JSON object.");
    return parsed;
  }

  async write(settings: Readonly<MotionViewSettings>): Promise<void> {
    if (!isTauriRuntime()) return;
    await writeSettings(JSON.stringify(settings));
  }
}
