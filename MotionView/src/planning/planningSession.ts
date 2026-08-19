import type { PlanningEvents, PlanningDocumentChangeKind } from "./planningEvents";
import { normalizePlanNodes, normalizePlanObjects } from "./planningState";
import type { PlanningNode, PlanningObject, PlanningWaypoint } from "./planningTypes";

interface PlanningHistorySnapshot {
  waypoints: PlanningWaypoint[];
  objects: PlanningObject[];
  nodes: PlanningNode[];
  selected: number[];
  selectedIndex: number;
  selectedNodeId: string | null;
  playDist: number;
  exportTemplate: string;
}

function cloneWaypoint(point: Readonly<PlanningWaypoint>): PlanningWaypoint {
  return { x: point.x, y: point.y, theta: point.theta ?? 0, speed: point.speed ?? 127 };
}

function cloneObject(object: Readonly<PlanningObject>): PlanningObject {
  return { ...object, methods: object.methods.map((method) => ({ ...method })) };
}

function cloneNode(node: Readonly<PlanningNode>): PlanningNode {
  return { ...node };
}

export class PlanningSession {
  readonly waypoints: PlanningWaypoint[] = [];
  readonly objects: PlanningObject[] = [];
  readonly nodes: PlanningNode[] = [];
  readonly selectedWaypoints = new Set<number>();
  selectedWaypoint = -1;
  selectedNodeId: string | null = null;
  exportTemplate: string;
  overlayVisible = false;
  playbackDistance = 0;
  routeRevision = 0;
  readonly undoStack: PlanningHistorySnapshot[] = [];
  readonly redoStack: PlanningHistorySnapshot[] = [];
  #transaction: { snapshot: PlanningHistorySnapshot; kind: PlanningDocumentChangeKind; changed: boolean } | null = null;

  constructor(
    readonly events: PlanningEvents,
    readonly defaultExportTemplate: string,
    readonly maxUndoSteps: number,
  ) {
    this.exportTemplate = defaultExportTemplate;
  }

  mutate(kind: PlanningDocumentChangeKind, mutation: () => void, recordHistory = true): void {
    const before = recordHistory && !this.#transaction ? this.snapshot() : null;
    mutation();
    this.maintainDocumentInvariants();
    if (kind === "route") this.routeRevision += 1;
    if (this.#transaction) {
      this.#transaction.changed = true;
      this.#transaction.kind = kind;
      this.events.documentPreviewChanged.emit({ kind });
      return;
    }
    if (before) this.pushUndoSnapshot(before);
    if (kind === "route" || kind === "imported" || kind === "cleared" || kind === "history") {
      this.events.projectionChanged.emit({ kind: "route" });
    }
    this.events.documentChanged.emit({ kind });
  }

  beginTransaction(kind: PlanningDocumentChangeKind): void {
    if (!this.#transaction) this.#transaction = { snapshot: this.snapshot(), kind, changed: false };
  }

  commitTransaction(): void {
    const transaction = this.#transaction;
    this.#transaction = null;
    if (!transaction?.changed) return;
    this.pushUndoSnapshot(transaction.snapshot);
    if (transaction.kind === "route" || transaction.kind === "history") {
      this.events.projectionChanged.emit({ kind: "route" });
    }
    this.events.documentChanged.emit({ kind: transaction.kind });
  }

  cancelTransaction(): void {
    const transaction = this.#transaction;
    this.#transaction = null;
    if (transaction?.changed) {
      this.applySnapshot(transaction.snapshot);
      this.events.projectionChanged.emit({ kind: "route" });
      this.events.selectionChanged.emit({ kind: "waypoint" });
    }
  }

  undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    this.redoStack.push(this.snapshot());
    this.applySnapshot(snapshot);
    this.events.projectionChanged.emit({ kind: "route" });
    this.events.selectionChanged.emit({ kind: "cleared" });
    this.events.documentChanged.emit({ kind: "history" });
    return true;
  }

  redo(): boolean {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return false;
    this.undoStack.push(this.snapshot());
    this.applySnapshot(snapshot);
    this.events.projectionChanged.emit({ kind: "route" });
    this.events.selectionChanged.emit({ kind: "cleared" });
    this.events.documentChanged.emit({ kind: "history" });
    return true;
  }

  load(value: unknown): void {
    const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
    this.replace(this.waypoints, Array.isArray(data["planned-path"])
      ? data["planned-path"].map((raw) => {
        const point = raw as Record<string, unknown>;
        return {
          x: Number(point?.x) || 0,
          y: Number(point?.y) || 0,
          theta: Number(point?.theta) || 0,
          speed: Number.isFinite(Number(point?.speed))
            ? Math.max(1, Math.min(127, Number(point?.speed)))
            : 127,
        };
      }) : []);
    this.replace(this.objects, normalizePlanObjects(data["planned-objects"]));
    this.replace(this.nodes, normalizePlanNodes(data["planned-nodes"]));
    if (data["planned-export-template"] !== undefined) {
      const template = String(data["planned-export-template"] || "");
      this.exportTemplate = template.trim() ? template : this.defaultExportTemplate;
    }
    this.maintainDocumentInvariants();
    this.routeRevision += 1;
    this.resetTransientDomainState();
    this.events.projectionChanged.emit({ kind: "route" });
    this.events.selectionChanged.emit({ kind: "cleared" });
    this.events.documentChanged.emit({ kind: "imported" });
  }

  clear(): void {
    this.waypoints.length = 0;
    this.objects.length = 0;
    this.nodes.length = 0;
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
      waypoints: this.waypoints.map(cloneWaypoint),
      objects: this.objects.map(cloneObject),
      nodes: this.nodes.map(cloneNode),
      selected: [...this.selectedWaypoints],
      selectedIndex: this.selectedWaypoint,
      selectedNodeId: this.selectedNodeId,
      playDist: this.playbackDistance,
      exportTemplate: this.exportTemplate,
    };
  }

  private applySnapshot(snapshot: PlanningHistorySnapshot): void {
    this.replace(this.waypoints, snapshot.waypoints.map(cloneWaypoint));
    this.replace(this.objects, snapshot.objects.map(cloneObject));
    this.replace(this.nodes, snapshot.nodes.map(cloneNode));
    this.selectedWaypoints.clear();
    for (const index of snapshot.selected) this.selectedWaypoints.add(index);
    this.selectedWaypoint = snapshot.selectedIndex;
    this.selectedNodeId = snapshot.selectedNodeId;
    this.playbackDistance = snapshot.playDist;
    this.exportTemplate = snapshot.exportTemplate || this.defaultExportTemplate;
    this.maintainDocumentInvariants();
    this.routeRevision += 1;
  }

  private pushUndoSnapshot(snapshot: PlanningHistorySnapshot): void {
    if (this.matchesCurrent(snapshot)) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private matchesCurrent(snapshot: PlanningHistorySnapshot): boolean {
    return snapshot.selectedIndex === this.selectedWaypoint
      && snapshot.selectedNodeId === this.selectedNodeId
      && snapshot.playDist === this.playbackDistance
      && snapshot.exportTemplate === this.exportTemplate
      && snapshot.selected.length === this.selectedWaypoints.size
      && snapshot.selected.every((index) => this.selectedWaypoints.has(index))
      && JSON.stringify(snapshot.waypoints) === JSON.stringify(this.waypoints)
      && JSON.stringify(snapshot.objects) === JSON.stringify(this.objects)
      && JSON.stringify(snapshot.nodes) === JSON.stringify(this.nodes);
  }

  private resetTransientDomainState(): void {
    this.selectedWaypoints.clear();
    this.selectedWaypoint = -1;
    this.selectedNodeId = null;
    this.playbackDistance = 0;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.#transaction = null;
  }

  private maintainDocumentInvariants(): void {
    const maxBucket = this.waypoints.length;
    const objects = new Map(this.objects.map((object) => [object.id, object]));
    for (let index = this.nodes.length - 1; index >= 0; index -= 1) {
      const node = this.nodes[index];
      const object = node ? objects.get(node.objectId) : null;
      if (!node || maxBucket === 0 || !object?.methods.some((method) => method.id === node.methodId)) {
        this.nodes.splice(index, 1);
        continue;
      }
      node.beforeWaypoint = Math.max(0, Math.min(maxBucket, Math.round(Number(node.beforeWaypoint) || 0)));
      node.index = Math.max(0, Math.round(Number(node.index) || 0));
    }
    this.nodes.sort((a, b) => a.beforeWaypoint - b.beforeWaypoint || a.index - b.index || a.id.localeCompare(b.id));
    const bucketCounts = new Map<number, number>();
    for (const node of this.nodes) {
      const index = bucketCounts.get(node.beforeWaypoint) ?? 0;
      node.index = index;
      bucketCounts.set(node.beforeWaypoint, index + 1);
    }
    if (this.selectedNodeId && !this.nodes.some((node) => node.id === this.selectedNodeId)) this.selectedNodeId = null;
    for (const index of [...this.selectedWaypoints]) {
      if (index < 0 || index >= this.waypoints.length) this.selectedWaypoints.delete(index);
    }
    if (!this.selectedWaypoints.has(this.selectedWaypoint)) {
      this.selectedWaypoint = this.selectedWaypoints.values().next().value ?? -1;
    }
  }

  private replace<T>(target: T[], values: readonly T[]): void {
    target.length = 0;
    target.push(...values);
  }
}
