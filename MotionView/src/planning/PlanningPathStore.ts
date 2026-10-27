import {
  clonePlanningCodeExportSettings,
  clonePlanningPath,
  DEFAULT_PLANNING_CODE_EXPORT_SETTINGS,
} from "./planningDocument";
import {
  createPlanNodeId,
  createPlanPathId,
  getDefaultPlanPathName,
} from "./planningState";
import type {
  PlanningCodeExportSettings,
  PlanningPath,
  PlanningPathView,
} from "./planningTypes";

/** Owns route entries, their active route, and legacy export defaults. */
export class PlanningPathStore {
  readonly entries: PlanningPath[] = [];
  #activePathId = "";
  #legacyCodeExportSettings: PlanningCodeExportSettings = {
    ...DEFAULT_PLANNING_CODE_EXPORT_SETTINGS,
  };

  constructor() {
    const path = this.createEmpty();
    this.entries.push(path);
    this.#activePathId = path.id;
  }

  get activePathId(): string {
    return this.#activePathId;
  }
  get active(): PlanningPath {
    return (
      this.entries.find((path) => path.id === this.#activePathId) ??
      this.entries[0]!
    );
  }
  get paths(): readonly PlanningPathView[] {
    return this.entries;
  }
  get legacyCodeExportSettings(): Readonly<PlanningCodeExportSettings> {
    return this.#legacyCodeExportSettings;
  }

  setLegacyCodeExportSettings(settings: PlanningCodeExportSettings): void {
    this.#legacyCodeExportSettings = clonePlanningCodeExportSettings(settings);
  }

  add(): PlanningPath {
    const path = this.createEmpty();
    this.entries.push(path);
    this.#activePathId = path.id;
    return path;
  }

  derive(id: string): PlanningPath | null {
    const index = this.entries.findIndex((path) => path.id === id);
    const source = this.entries[index];
    if (!source) return null;
    const path = clonePlanningPath(source);
    path.id = createPlanPathId();
    const names = new Set(this.entries.map((entry) => entry.name));
    path.name = `${source.name} (Copy)`;
    let copyIndex = 2;
    while (names.has(path.name)) {
      path.name = `${source.name} (Copy ${copyIndex++})`;
    }
    for (const node of path.nodes) node.id = createPlanNodeId();
    this.entries.splice(index + 1, 0, path);
    this.#activePathId = path.id;
    return path;
  }

  select(id: string): boolean {
    if (!this.entries.some((path) => path.id === id)) return false;
    this.#activePathId = id;
    return true;
  }

  remove(id: string): boolean {
    const index = this.entries.findIndex((path) => path.id === id);
    if (index < 0 || this.entries.length <= 1) return false;
    const wasActive = this.#activePathId === id;
    this.entries.splice(index, 1);
    if (wasActive) {
      this.#activePathId = this.entries[
        Math.min(index, this.entries.length - 1)
      ]!.id;
    }
    return true;
  }

  replace(paths: readonly PlanningPath[], activePathId: string): void {
    this.entries.length = 0;
    this.entries.push(...paths);
    this.#activePathId = activePathId;
    this.ensureActivePath();
  }

  reset(): void {
    this.entries.length = 0;
    const path = this.createEmpty();
    this.entries.push(path);
    this.#activePathId = path.id;
  }

  ensureActivePath(): void {
    if (!this.entries.length) {
      const path = this.createEmpty();
      this.entries.push(path);
      this.#activePathId = path.id;
      return;
    }
    if (!this.entries.some((path) => path.id === this.#activePathId)) {
      this.#activePathId = this.entries[0]!.id;
    }
  }

  private createEmpty(id = createPlanPathId()): PlanningPath {
    return {
      id,
      name: getDefaultPlanPathName(this.entries),
      waypoints: [],
      nodes: [],
      codeExport: clonePlanningCodeExportSettings(
        this.#legacyCodeExportSettings,
      ),
    };
  }
}
