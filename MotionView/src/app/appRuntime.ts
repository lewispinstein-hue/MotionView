import { MotionViewApp } from "./MotionViewApp";

let motionViewApp: MotionViewApp | null = null;

export function initializeMotionViewApp(): MotionViewApp {
  motionViewApp ??= new MotionViewApp();
  return motionViewApp;
}

export function getMotionViewApp(): MotionViewApp {
  if (!motionViewApp) {
    throw new Error("MotionViewApp has not been initialized. Call initializeMotionViewApp() first.");
  }
  return motionViewApp;
}
