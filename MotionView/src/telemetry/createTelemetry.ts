import { AppTelemetry } from "./appTelemetry";
import { ExportTelemetry } from "./exportTelemetry";
import { LiveTelemetry } from "./liveTelemetry";
import { PlanningTelemetry } from "./planningTelemetry";
import { TelemetryClient } from "./telemetryClient";
import { ViewingTelemetry } from "./viewingTelemetry";

export const telemetryClient = new TelemetryClient();
export const appTelemetry = new AppTelemetry(telemetryClient);
export const planningTelemetry = new PlanningTelemetry(telemetryClient);
export const viewingTelemetry = new ViewingTelemetry(telemetryClient);
export const liveTelemetry = new LiveTelemetry(telemetryClient);
export const exportTelemetry = new ExportTelemetry(telemetryClient);

export const initTelemetry = telemetryClient.init.bind(telemetryClient);
