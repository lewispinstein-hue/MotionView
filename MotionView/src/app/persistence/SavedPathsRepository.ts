import { isTauriRuntime, readSavedPaths, writeSavedPaths } from "../../tauri/commands";
export class SavedPathsRepository {
  read(): Promise<string | null> { return isTauriRuntime() ? readSavedPaths() : Promise.resolve(null); }
  write(contents: string): Promise<void> { return isTauriRuntime() ? writeSavedPaths(contents) : Promise.resolve(); }
}
