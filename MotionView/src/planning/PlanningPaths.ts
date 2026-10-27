import type {
  PlanningCodeExportSettings,
  PlanningPathView,
} from "./planningTypes";
import {
  type PlanningMirrorDirection,
  PlanningRoute,
} from "./PlanningRoute";
import type { PlanningSession } from "./planningSession";

/** Coordinates the independently editable routes in a Planning document. */
export class PlanningPaths {
  constructor(
    private readonly session: PlanningSession,
    private readonly route: PlanningRoute,
  ) {}

  get items(): readonly PlanningPathView[] {
    return this.session.paths;
  }
  get active(): PlanningPathView {
    return this.session.activePath;
  }
  get activeId(): string {
    return this.session.activePathId;
  }
  get codeExportSettings(): Readonly<PlanningCodeExportSettings> {
    return this.session.codeExportSettings;
  }

  add(): string {
    return this.session.addPath();
  }
  derive(id: string): string | null {
    return this.session.derivePath(id);
  }
  select(id: string): boolean {
    return this.session.selectPath(id);
  }
  rename(id: string, name: string): boolean {
    return this.session.renamePath(id, name);
  }
  remove(id: string): boolean {
    return this.session.removePath(id);
  }
  updateCodeExportSettings(
    settings: Partial<PlanningCodeExportSettings>,
  ): void {
    this.session.updateCodeExportSettings(settings);
  }
  setLegacyCodeExportSettings(
    settings: Partial<PlanningCodeExportSettings> | null | undefined,
  ): void {
    this.session.setLegacyCodeExportSettings(settings);
  }
  mirror(
    direction: PlanningMirrorDirection,
    constrain: Parameters<PlanningRoute["mirror"]>[1],
  ): boolean {
    return this.route.mirror(direction, constrain);
  }
}
