type ElementConstructor<T extends Element> = {
  new (...args: never[]): T;
};

export function requiredElement<T extends Element>(
  id: string,
  constructor: ElementConstructor<T>,
  root: Document = document,
): T {
  const element = root.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  if (!(element instanceof constructor)) {
    throw new Error(`Element #${id} is not a ${constructor.name}`);
  }
  return element;
}

export function optionalElement<T extends Element>(
  id: string,
  constructor: ElementConstructor<T>,
  root: Document = document,
): T | null {
  const element = root.getElementById(id);
  if (!element) return null;
  if (!(element instanceof constructor)) {
    throw new Error(`Element #${id} is not a ${constructor.name}`);
  }
  return element;
}

export function requiredCanvasContext(
  canvas: HTMLCanvasElement,
  contextId: "2d" = "2d",
): CanvasRenderingContext2D {
  const context = canvas.getContext(contextId);
  if (!context) {
    throw new Error(`Canvas #${canvas.id || "(unnamed)"} does not support ${contextId}`);
  }
  return context;
}
