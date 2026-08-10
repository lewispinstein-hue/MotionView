import { TypedEvent } from "../../app/typedEvent";

export interface PlanningMethodDrag {
  readonly source: "sidebar" | "timeline";
  readonly objectId: string;
  readonly methodId: string;
  readonly nodeId?: string;
  readonly startX: number;
  readonly startY: number;
  readonly sourceElement: HTMLElement;
}

export class PlanningDragCoordinator {
  readonly started = new TypedEvent<PlanningMethodDrag>();

  begin(drag: PlanningMethodDrag): void {
    this.started.emit(drag);
  }
}
