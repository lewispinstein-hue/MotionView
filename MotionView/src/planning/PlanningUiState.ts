/** Transitional owner for Planning presentation/input state. PlanningView will own this in Step 5. */
export class PlanningUiState {
  dragging = false;
  pointerId: number | null = null;
  pendingCanvasClick: any = null;
  dragStart = { x: 0, y: 0 };
  dragOrig: Array<{ i: number; x: number; y: number }> = [];
  selecting = false;
  selectRect: any = null;
  thetaDragging = false;
  thetaDragIdx = -1;
  thetaDragBase: any = null;
  thetaDragStart = 0;
  scrubbing = false;
  fieldHoverNodeId: string | null = null;
  editingObjectId: string | null = null;
  editingObjectOriginalName = "";
  objectEditSelectAll = false;
  templateModalState: any = null;
  pendingObjectRemovalId: string | null = null;
  pendingObjectDeleteAction: (() => void) | null = null;
  pendingObjectDeleteCancelAction: (() => void) | null = null;
  openColorPickerObjectId: string | null = null;
  timelineLayout: any = null;
  timelineDropTarget: any = null;
  pointerDragState: any = null;
  nodeTooltipTimer: number | null = null;
  nodeTooltipVisible = false;
  nodeTooltipPointer: any = null;

  reset(): void {
    const fresh = new PlanningUiState();
    Object.assign(this, fresh);
  }
}
