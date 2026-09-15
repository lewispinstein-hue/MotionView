import type { Pose } from "./models";

export interface PoseReader extends Iterable<Readonly<Pose>> {
  readonly length: number;
  readonly [index: number]: Readonly<Pose> | undefined;
  at(index: number): Readonly<Pose> | undefined;
  map<T>(callback: (pose: Readonly<Pose>, index: number, reader: PoseReader) => T, thisArg?: unknown): T[];
}

export interface PoseStore extends PoseReader {
  push(pose: Partial<Pose> | null | undefined): number;
  reserve(capacity: number): void;
  clear(): void;
  setSpeedNorm(index: number, value: number): void;
  toArray(): Pose[];
}

export function createPoseStore(initialCapacity = 1024): PoseStore {
  let capacity = Math.max(16, Number(initialCapacity) || 16);
  let length = 0;

  let tValues = new Float64Array(capacity);
  let xValues = new Float32Array(capacity);
  let yValues = new Float32Array(capacity);
  let thetaValues = new Float32Array(capacity);
  let lVelValues = new Float32Array(capacity);
  let rVelValues = new Float32Array(capacity);
  let speedRawValues = new Float32Array(capacity);
  let speedNormValues = new Float32Array(capacity);

  const readNullable = (value: number) => (Number.isNaN(value) ? null : value);
  const writeNullable = (value: unknown) => (typeof value === "number" && Number.isFinite(value)) ? value : Number.NaN;

  function grow(nextLength: number) {
    if (nextLength <= capacity) return;
    while (capacity < nextLength) capacity *= 2;

    const nextT = new Float64Array(capacity);
    const nextX = new Float32Array(capacity);
    const nextY = new Float32Array(capacity);
    const nextTheta = new Float32Array(capacity);
    const nextLVel = new Float32Array(capacity);
    const nextRVel = new Float32Array(capacity);
    const nextSpeedRaw = new Float32Array(capacity);
    const nextSpeedNorm = new Float32Array(capacity);

    nextT.set(tValues.subarray(0, length));
    nextX.set(xValues.subarray(0, length));
    nextY.set(yValues.subarray(0, length));
    nextTheta.set(thetaValues.subarray(0, length));
    nextLVel.set(lVelValues.subarray(0, length));
    nextRVel.set(rVelValues.subarray(0, length));
    nextSpeedRaw.set(speedRawValues.subarray(0, length));
    nextSpeedNorm.set(speedNormValues.subarray(0, length));

    tValues = nextT;
    xValues = nextX;
    yValues = nextY;
    thetaValues = nextTheta;
    lVelValues = nextLVel;
    rVelValues = nextRVel;
    speedRawValues = nextSpeedRaw;
    speedNormValues = nextSpeedNorm;
  }

  function getPose(index: number): Pose | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= length) return undefined;
    return {
      t: readNullable(tValues[index]),
      x: xValues[index],
      y: yValues[index],
      theta: thetaValues[index],
      l_vel: readNullable(lVelValues[index]),
      r_vel: readNullable(rVelValues[index]),
      speed_raw: speedRawValues[index],
      speed_norm: speedNormValues[index],
    };
  }

  function pushPose(pose: Partial<Pose> | null | undefined) {
    if (!pose) return length;
    grow(length + 1);

    tValues[length] = writeNullable(pose.t);
    xValues[length] = Number(pose.x) || 0;
    yValues[length] = Number(pose.y) || 0;
    thetaValues[length] = Number(pose.theta) || 0;
    lVelValues[length] = writeNullable(pose.l_vel);
    rVelValues[length] = writeNullable(pose.r_vel);
    speedRawValues[length] = Number(pose.speed_raw) || 0;
    speedNormValues[length] = Number(pose.speed_norm) || 0;

    length += 1;
    return length;
  }

  function clear() {
    length = 0;
  }

  function mapPoses<T>(callback: (pose: Pose, index: number, store: PoseStore) => T, thisArg?: unknown) {
    const out = new Array<T>(length);
    for (let i = 0; i < length; i += 1) {
      out[i] = callback.call(thisArg, getPose(i) as Pose, i, proxy);
    }
    return out;
  }

  function setSpeedNorm(index: number, value: number) {
    if (!Number.isInteger(index) || index < 0 || index >= length) return;
    speedNormValues[index] = Number(value) || 0;
  }

  const api = {
    at: getPose,
    push: pushPose,
    reserve: grow,
    clear,
    map: mapPoses,
    setSpeedNorm,
    toArray: () => mapPoses((pose) => pose),
    [Symbol.iterator]: function* poseIterator() {
      for (let i = 0; i < length; i += 1) yield getPose(i) as Pose;
    },
  };

  const proxy = new Proxy(api, {
    get(target, prop, receiver) {
      if (prop === "length") return length;
      if (typeof prop === "string" && /^\d+$/.test(prop)) return getPose(Number(prop));
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as PoseStore;

  return proxy;
}
