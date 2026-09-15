import type { PlanningDocumentChangeKind } from "./planningEvents";
import type { PlanningSession } from "./planningSession";

export class PlanningHistory {
  constructor(private readonly session: PlanningSession) {}
  get canUndo(): boolean { return this.session.undoStack.length > 0; }
  get canRedo(): boolean { return this.session.redoStack.length > 0; }
  begin(kind: PlanningDocumentChangeKind = "route"): void { this.session.beginTransaction(kind); }
  commit(): void { this.session.commitTransaction(); }
  cancel(): void { this.session.cancelTransaction(); }
  undo(): boolean { return this.session.undo(); }
  redo(): boolean { return this.session.redo(); }
}
