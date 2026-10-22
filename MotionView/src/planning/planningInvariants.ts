import type { PlanningObject, PlanningPath } from "./planningTypes";

export interface PlanningMethodSelection {
  readonly objectId: string;
  readonly methodId: string;
}

export interface PlanningSelectionState {
  readonly selectedWaypoints: Set<number>;
  selectedWaypoint: number;
  selectedNodeId: string | null;
  selectedMethod: PlanningMethodSelection | null;
}

/** Repairs references and ordering after any Planning document mutation. */
export function maintainPlanningDocumentInvariants(
  paths: PlanningPath[],
  activePathId: string,
  objects: readonly PlanningObject[],
  selection: PlanningSelectionState,
): void {
  const activePath =
    paths.find((path) => path.id === activePathId) ?? paths[0];
  if (!activePath) return;
  const objectsById = new Map(objects.map((object) => [object.id, object]));
  for (const path of paths) {
    const maxBucket = Math.max(0, path.waypoints.length - 1);
    const hasRouteSegments = path.waypoints.length >= 2;
    for (let index = path.nodes.length - 1; index >= 0; index -= 1) {
      const node = path.nodes[index];
      const object = node ? objectsById.get(node.objectId) : null;
      if (
        !node ||
        !hasRouteSegments ||
        !object?.methods.some((method) => method.id === node.methodId)
      ) {
        path.nodes.splice(index, 1);
        continue;
      }
      node.beforeWaypoint = Math.max(
        0,
        Math.min(maxBucket, Math.round(Number(node.beforeWaypoint) || 0)),
      );
      node.index = Math.max(0, Math.round(Number(node.index) || 0));
    }
    path.nodes.sort(
      (a, b) =>
        a.beforeWaypoint - b.beforeWaypoint ||
        a.index - b.index ||
        a.id.localeCompare(b.id),
    );
    const bucketCounts = new Map<number, number>();
    for (const node of path.nodes) {
      const index = bucketCounts.get(node.beforeWaypoint) ?? 0;
      node.index = index;
      bucketCounts.set(node.beforeWaypoint, index + 1);
    }
  }
  if (
    selection.selectedNodeId &&
    !activePath.nodes.some((node) => node.id === selection.selectedNodeId)
  ) {
    selection.selectedNodeId = null;
  }
  if (
    selection.selectedMethod &&
    !objectsById
      .get(selection.selectedMethod.objectId)
      ?.methods.some((method) => method.id === selection.selectedMethod?.methodId)
  ) {
    selection.selectedMethod = null;
  }
  for (const index of [...selection.selectedWaypoints]) {
    if (index < 0 || index >= activePath.waypoints.length) {
      selection.selectedWaypoints.delete(index);
    }
  }
  if (!selection.selectedWaypoints.has(selection.selectedWaypoint)) {
    selection.selectedWaypoint =
      selection.selectedWaypoints.values().next().value ?? -1;
  }
}
