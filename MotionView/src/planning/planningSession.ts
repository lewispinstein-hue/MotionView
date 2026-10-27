import type {
  PlanningDocumentChangeKind,
  PlanningEvents,
} from "./planningEvents";
import {
  clonePlanningCodeExportSettings,
  clonePlanningObject,
  clonePlanningPath,
  DEFAULT_PLANNING_CODE_EXPORT_SETTINGS,
  loadPlanningPaths,
  normalizePlanningCodeExportSettings,
  normalizePlanningPathName,
} from "./planningDocument";
import {
  maintainPlanningDocumentInvariants,
  type PlanningMethodSelection,
} from "./planningInvariants";
import { PlanningPathStore } from "./PlanningPathStore";
import { PlanningSessionHistory } from "./planningSessionHistory";
import { normalizePlanObjects } from "./planningState";
import type {
  PlanningCodeExportSettings,
  PlanningNode,
  PlanningObject,
  PlanningPath,
  PlanningPathView,
} from "./planningTypes";

export type { PlanningMethodSelection } from "./planningInvariants";

interface PlanningHistorySnapshot {
  paths: PlanningPath[];
  activePathId: string;
  /** The active path after the mutation that stored this pre-change snapshot. */
  historyPathId: string;
  objects: PlanningObject[];
  selected: number[];
  selectedIndex: number;
  selectedNodeId: string | null;
  selectedMethod: PlanningMethodSelection | null;
  playDist: number;
  exportTemplate: string;
}

/**
 * Coordinates Planning's shared state. Focused stores own path selection,
 * document parsing, invariants, and history mechanics.
 */
export class PlanningSession {
  readonly #pathStore = new PlanningPathStore();
  readonly objects: PlanningObject[] = [];
  readonly selectedWaypoints = new Set<number>();
  selectedWaypoint = -1;
  selectedNodeId: string | null = null;
  selectedMethod: PlanningMethodSelection | null = null;
  exportTemplate: string;
  overlayVisible = false;
  playbackDistance = 0;
  routeRevision = 0;
  readonly #history: PlanningSessionHistory<PlanningHistorySnapshot>;

  constructor(
    readonly events: PlanningEvents,
    readonly defaultExportTemplate: string,
    maxUndoSteps: number,
  ) {
    this.exportTemplate = defaultExportTemplate;
    this.#history = new PlanningSessionHistory(maxUndoSteps);
  }

  get activePathId(): string {
    return this.#pathStore.activePathId;
  }
  get activePath(): PlanningPath {
    return this.#pathStore.active;
  }
  get paths(): readonly PlanningPathView[] {
    return this.#pathStore.paths;
  }
  get pathEntries(): PlanningPath[] {
    return this.#pathStore.entries;
  }
  get waypoints() {
    return this.activePath.waypoints;
  }
  get nodes(): PlanningNode[] {
    return this.activePath.nodes;
  }
  get codeExportSettings(): Readonly<PlanningCodeExportSettings> {
    return this.activePath.codeExport;
  }
  get canUndo(): boolean {
    return this.#history.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.#history.redoStack.length > 0;
  }

  /** Seeds defaults when opening a legacy route with global export settings. */
  setLegacyCodeExportSettings(
    settings: Partial<PlanningCodeExportSettings> | null | undefined,
  ): void {
    const next = normalizePlanningCodeExportSettings(
      settings,
      DEFAULT_PLANNING_CODE_EXPORT_SETTINGS,
    );
    this.#pathStore.setLegacyCodeExportSettings(next);
    if (
      this.pathEntries.length === 1 &&
      this.activePath.waypoints.length === 0 &&
      this.activePath.nodes.length === 0
    ) {
      this.activePath.codeExport = clonePlanningCodeExportSettings(next);
    }
  }

  addPath(): string {
    let id = "";
    this.mutate("path", () => {
      id = this.#pathStore.add().id;
      this.resetActivePathTransientState();
    });
    this.events.selectionChanged.emit({ kind: "cleared" });
    return id;
  }

  derivePath(id: string): string | null {
    if (!this.pathEntries.some((path) => path.id === id)) return null;
    let derivedId: string | null = null;
    this.mutate("path", () => {
      derivedId = this.#pathStore.derive(id)?.id ?? null;
      this.resetActivePathTransientState();
    });
    this.events.selectionChanged.emit({ kind: "cleared" });
    return derivedId;
  }

  selectPath(id: string): boolean {
    if (id === this.activePathId) return true;
    if (!this.#pathStore.select(id)) return false;
    this.resetActivePathTransientState();
    this.routeRevision += 1;
    this.events.projectionChanged.emit({ kind: "route" });
    this.events.selectionChanged.emit({ kind: "cleared" });
    // Path switches are persisted but deliberately not undoable.
    this.events.documentChanged.emit({ kind: "path" });
    return true;
  }

  renamePath(id: string, name: string): boolean {
    const path = this.pathEntries.find((entry) => entry.id === id);
    if (!path) return false;
    const next = normalizePlanningPathName(name, path.name);
    if (next === path.name) return false;
    this.mutate("path", () => {
      path.name = next;
    });
    return true;
  }

  removePath(id: string): boolean {
    if (
      this.pathEntries.length <= 1 ||
      !this.pathEntries.some((path) => path.id === id)
    ) {
      return false;
    }
    let removed = false;
    this.mutate("path", () => {
      const wasActive = id === this.activePathId;
      removed = this.#pathStore.remove(id);
      if (removed && wasActive) this.resetActivePathTransientState();
    });
    if (removed) this.events.selectionChanged.emit({ kind: "cleared" });
    return removed;
  }

  updateCodeExportSettings(
    settings: Partial<PlanningCodeExportSettings>,
  ): void {
    const next = normalizePlanningCodeExportSettings(
      settings,
      this.activePath.codeExport,
    );
    if (
      next.header === this.activePath.codeExport.header &&
      next.footer === this.activePath.codeExport.footer &&
      next.target === this.activePath.codeExport.target &&
      next.path === this.activePath.codeExport.path
    ) {
      return;
    }
    this.mutate(
      "path-export",
      () => {
        this.activePath.codeExport = next;
      },
      false,
    );
  }

  mutate(
    kind: PlanningDocumentChangeKind,
    mutation: () => void,
    recordHistory = true,
  ): void {
    const before =
      recordHistory && !this.#history.inTransaction ? this.snapshot() : null;
    mutation();
    this.maintainDocumentInvariants();
    if (this.affectsRouteProjection(kind)) this.routeRevision += 1;
    if (this.#history.inTransaction) {
      this.#history.markChanged(kind);
      this.events.documentPreviewChanged.emit({ kind });
      return;
    }
    if (before) {
      this.#history.push(before, this.activePathId, (snapshot) =>
        this.matchesCurrent(snapshot),
      );
    }
    if (this.affectsRouteProjection(kind)) {
      this.events.projectionChanged.emit({ kind: "route" });
    }
    this.events.documentChanged.emit({ kind });
  }

  beginTransaction(kind: PlanningDocumentChangeKind): void {
    this.#history.begin(this.snapshot(), kind);
  }

  commitTransaction(): void {
    const kind = this.#history.commit(this.activePathId, (snapshot) =>
      this.matchesCurrent(snapshot),
    );
    if (!kind) return;
    if (this.affectsRouteProjection(kind)) {
      this.events.projectionChanged.emit({ kind: "route" });
    }
    this.events.documentChanged.emit({ kind });
  }

  cancelTransaction(): void {
    const snapshot = this.#history.cancel();
    if (!snapshot) return;
    this.applySnapshot(snapshot);
    this.events.projectionChanged.emit({ kind: "route" });
    this.events.selectionChanged.emit({ kind: "waypoint" });
  }

  undo(): boolean {
    const changed = this.#history.undo(this.snapshot(), (snapshot) => {
      this.applySnapshot(snapshot);
    });
    if (!changed) return false;
    this.events.projectionChanged.emit({ kind: "route" });
    this.events.selectionChanged.emit({ kind: "cleared" });
    this.events.documentChanged.emit({ kind: "history" });
    return true;
  }

  redo(): boolean {
    const changed = this.#history.redo(this.snapshot(), (snapshot) => {
      this.applySnapshot(snapshot);
    });
    if (!changed) return false;
    this.events.projectionChanged.emit({ kind: "route" });
    this.events.selectionChanged.emit({ kind: "cleared" });
    this.events.documentChanged.emit({ kind: "history" });
    return true;
  }

  load(value: unknown): void {
    const data =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const paths = loadPlanningPaths(
      data,
      this.#pathStore.legacyCodeExportSettings,
    );
    this.#pathStore.replace(paths, String(data["planned-active-path-id"] ?? ""));
    this.replace(this.objects, normalizePlanObjects(data["planned-objects"]));
    if (data["planned-export-template"] !== undefined) {
      const template = String(data["planned-export-template"] || "");
      this.exportTemplate = template.trim()
        ? template
        : this.defaultExportTemplate;
    }
    this.maintainDocumentInvariants();
    this.routeRevision += 1;
    this.resetTransientDomainState();
    this.events.projectionChanged.emit({ kind: "route" });
    this.events.selectionChanged.emit({ kind: "cleared" });
    this.events.documentChanged.emit({ kind: "imported" });
  }

  clear(): void {
    this.#pathStore.reset();
    this.objects.length = 0;
    this.exportTemplate = this.defaultExportTemplate;
    this.overlayVisible = false;
    this.routeRevision += 1;
    this.resetTransientDomainState();
    this.events.projectionChanged.emit({ kind: "route" });
    this.events.selectionChanged.emit({ kind: "cleared" });
    this.events.documentChanged.emit({ kind: "cleared" });
  }

  private snapshot(): PlanningHistorySnapshot {
    return {
      paths: this.pathEntries.map(clonePlanningPath),
      activePathId: this.activePathId,
      historyPathId: this.activePathId,
      objects: this.objects.map(clonePlanningObject),
      selected: [...this.selectedWaypoints],
      selectedIndex: this.selectedWaypoint,
      selectedNodeId: this.selectedNodeId,
      selectedMethod: this.selectedMethod ? { ...this.selectedMethod } : null,
      playDist: this.playbackDistance,
      exportTemplate: this.exportTemplate,
    };
  }

  private applySnapshot(snapshot: PlanningHistorySnapshot): void {
    this.#pathStore.replace(
      snapshot.paths.map(clonePlanningPath),
      snapshot.activePathId,
    );
    this.replace(this.objects, snapshot.objects.map(clonePlanningObject));
    this.selectedWaypoints.clear();
    for (const index of snapshot.selected) this.selectedWaypoints.add(index);
    this.selectedWaypoint = snapshot.selectedIndex;
    this.selectedNodeId = snapshot.selectedNodeId;
    this.selectedMethod = snapshot.selectedMethod
      ? { ...snapshot.selectedMethod }
      : null;
    this.playbackDistance = snapshot.playDist;
    this.exportTemplate = snapshot.exportTemplate || this.defaultExportTemplate;
    this.maintainDocumentInvariants();
    this.routeRevision += 1;
  }

  private matchesCurrent(snapshot: PlanningHistorySnapshot): boolean {
    return (
      snapshot.activePathId === this.activePathId &&
      snapshot.selectedIndex === this.selectedWaypoint &&
      snapshot.selectedNodeId === this.selectedNodeId &&
      snapshot.selectedMethod?.objectId === this.selectedMethod?.objectId &&
      snapshot.selectedMethod?.methodId === this.selectedMethod?.methodId &&
      snapshot.playDist === this.playbackDistance &&
      snapshot.exportTemplate === this.exportTemplate &&
      snapshot.selected.length === this.selectedWaypoints.size &&
      snapshot.selected.every((index) => this.selectedWaypoints.has(index)) &&
      JSON.stringify(snapshot.paths) === JSON.stringify(this.pathEntries) &&
      JSON.stringify(snapshot.objects) === JSON.stringify(this.objects)
    );
  }

  private resetActivePathTransientState(): void {
    this.selectedWaypoints.clear();
    this.selectedWaypoint = -1;
    this.selectedNodeId = null;
    this.selectedMethod = null;
    this.playbackDistance = 0;
  }

  private resetTransientDomainState(): void {
    this.resetActivePathTransientState();
    this.#history.clear();
  }

  private maintainDocumentInvariants(): void {
    this.#pathStore.ensureActivePath();
    maintainPlanningDocumentInvariants(
      this.pathEntries,
      this.activePathId,
      this.objects,
      this,
    );
  }

  private affectsRouteProjection(kind: PlanningDocumentChangeKind): boolean {
    return (
      kind === "route" ||
      kind === "path" ||
      kind === "node" ||
      kind === "object" ||
      kind === "method" ||
      kind === "imported" ||
      kind === "cleared" ||
      kind === "history"
    );
  }

  private replace<T>(target: T[], values: readonly T[]): void {
    target.length = 0;
    target.push(...values);
  }
}
