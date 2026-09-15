import type { FieldBounds, ScreenPoint } from "./fieldTypes";

export interface FieldTransformAccess {
  worldToScreen(xIn: number, yIn: number): ScreenPoint;
  screenToWorld(xPx: number, yPx: number): ScreenPoint;
  getFieldScale(): number;
  getFieldViewZoom(): number;
  getFieldRotationDeg(): number;
  getFieldBounds(): Readonly<FieldBounds>;
}

let access: FieldTransformAccess | null = null;

export function configureFieldTransform(nextAccess: FieldTransformAccess): void {
  access = nextAccess;
}

function getAccess(): FieldTransformAccess {
  if (!access) throw new Error("Field transform access has not been configured.");
  return access;
}

export function worldToScreen(xIn: number, yIn: number): ScreenPoint {
  return getAccess().worldToScreen(xIn, yIn);
}

export function screenToWorld(xPx: number, yPx: number): ScreenPoint {
  return getAccess().screenToWorld(xPx, yPx);
}

export function getFieldScale(): number {
  return getAccess().getFieldScale();
}

export function getFieldViewZoom(): number {
  return getAccess().getFieldViewZoom();
}

export function getFieldRotationDeg(): number {
  return getAccess().getFieldRotationDeg();
}

export function getFieldBounds(): Readonly<FieldBounds> {
  return getAccess().getFieldBounds();
}
