import type { PlanningDocumentChangeKind } from "./planningEvents";

/** Generic undo/redo and transaction bookkeeping for one Planning session. */
export class PlanningSessionHistory<
  TSnapshot extends { activePathId: string; historyPathId: string },
> {
  readonly undoStack: TSnapshot[] = [];
  readonly redoStack: TSnapshot[] = [];
  #transaction:
    | {
        snapshot: TSnapshot;
        kind: PlanningDocumentChangeKind;
        changed: boolean;
      }
    | undefined;

  constructor(private readonly maxSteps: number) {}

  get inTransaction(): boolean {
    return !!this.#transaction;
  }

  begin(snapshot: TSnapshot, kind: PlanningDocumentChangeKind): void {
    if (!this.#transaction) {
      this.#transaction = { snapshot, kind, changed: false };
    }
  }

  markChanged(kind: PlanningDocumentChangeKind): void {
    if (!this.#transaction) return;
    this.#transaction.changed = true;
    this.#transaction.kind = kind;
  }

  commit(
    historyPathId: string,
    matchesCurrent: (snapshot: TSnapshot) => boolean,
  ): PlanningDocumentChangeKind | null {
    const transaction = this.#transaction;
    this.#transaction = undefined;
    if (!transaction?.changed) return null;
    this.push(transaction.snapshot, historyPathId, matchesCurrent);
    return transaction.kind;
  }

  cancel(): TSnapshot | null {
    const transaction = this.#transaction;
    this.#transaction = undefined;
    return transaction?.changed ? transaction.snapshot : null;
  }

  push(
    snapshot: TSnapshot,
    historyPathId: string,
    matchesCurrent: (snapshot: TSnapshot) => boolean,
  ): void {
    if (matchesCurrent(snapshot)) return;
    snapshot.historyPathId = historyPathId;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxSteps) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(
    current: TSnapshot,
    apply: (snapshot: TSnapshot) => void,
  ): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    current.historyPathId = snapshot.activePathId;
    current.activePathId = snapshot.historyPathId;
    this.redoStack.push(current);
    apply(snapshot);
    return true;
  }

  redo(
    current: TSnapshot,
    apply: (snapshot: TSnapshot) => void,
  ): boolean {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return false;
    current.historyPathId = snapshot.activePathId;
    current.activePathId = snapshot.historyPathId;
    this.undoStack.push(current);
    apply(snapshot);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.#transaction = undefined;
  }
}
