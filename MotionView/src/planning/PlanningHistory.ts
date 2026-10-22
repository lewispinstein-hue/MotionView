import type { PlanningDocumentChangeKind } from "./planningEvents";
import type { PlanningSession } from "./planningSession";

export class PlanningHistory {
  constructor(private readonly session: PlanningSession) {}
  get canUndo(): boolean {
    return this.session.canUndo;
  }
  get canRedo(): boolean {
    return this.session.canRedo;
  }
  begin(kind: PlanningDocumentChangeKind = "route"): void {
    this.session.beginTransaction(kind);
  }
  commit(): void {
    this.session.commitTransaction();
  }
  cancel(): void {
    this.session.cancelTransaction();
  }
  undo(): boolean {
    return this.session.undo();
  }
  redo(): boolean {
    return this.session.redo();
  }
}
