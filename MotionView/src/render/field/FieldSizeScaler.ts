export interface FieldDimensions2D {
  readonly width: number;
  readonly height: number;
}

export type FieldDimensionLimit = number | Partial<FieldDimensions2D>;

export interface FieldSizeLimits {
  /** Absolute lower pixel bounds, applied after scaling. */
  readonly minimum?: FieldDimensionLimit;
  /** Absolute upper pixel bounds, applied after scaling. */
  readonly maximum?: FieldDimensionLimit;
  /** Lower bounds expressed in field units and converted to pixels. */
  readonly minimumWorld?: FieldDimensionLimit;
  /** Upper bounds expressed in field units and converted to pixels. */
  readonly maximumWorld?: FieldDimensionLimit;
}

interface FieldScaleSource {
  getScale(): number;
  getViewZoom(): number;
}

function dimensionLimit(
  limit: FieldDimensionLimit | undefined,
  dimension: keyof FieldDimensions2D,
  fallback: number,
): number {
  if (typeof limit === "number") return limit;
  const value = limit?.[dimension];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Converts two-dimensional screen or world sizes using the current field transform. */
export class FieldSizeScaler {
  constructor(private readonly field: FieldScaleSource) {}

  screen(dimensions: FieldDimensions2D, limits: FieldSizeLimits = {}): Readonly<FieldDimensions2D> {
    return this.scale(dimensions, this.field.getViewZoom(), limits);
  }

  world(dimensions: FieldDimensions2D, limits: FieldSizeLimits = {}): Readonly<FieldDimensions2D> {
    return this.scale(dimensions, this.field.getScale(), limits);
  }

  private scale(
    dimensions: FieldDimensions2D,
    factor: number,
    limits: FieldSizeLimits,
  ): Readonly<FieldDimensions2D> {
    return {
      width: this.scaleDimension(dimensions.width, factor, "width", limits),
      height: this.scaleDimension(dimensions.height, factor, "height", limits),
    };
  }

  private scaleDimension(
    value: number,
    factor: number,
    dimension: keyof FieldDimensions2D,
    limits: FieldSizeLimits,
  ): number {
    const fieldScale = this.field.getScale();
    const minimum = Math.max(
      dimensionLimit(limits.minimum, dimension, 0),
      dimensionLimit(limits.minimumWorld, dimension, 0) * fieldScale,
    );
    const maximum = Math.min(
      dimensionLimit(limits.maximum, dimension, Infinity),
      dimensionLimit(limits.maximumWorld, dimension, Infinity) * fieldScale,
    );
    const scaled = Math.abs(Number(value) || 0) * Math.max(0, factor);
    return Math.max(minimum, Math.min(maximum, scaled));
  }
}
