import * as mode from "./modeController";
import * as status from "./status";
import * as units from "../shared/units";
import * as tauri from "../tauri/commands";
import * as telemetry from "../telemetry/createTelemetry";
import { AppEvents } from "./appEvents";
import { BridgeService } from "./BridgeService";

export class CoreServices {
  readonly events = new AppEvents();
  readonly bridge = new BridgeService();
  readonly mode = mode;
  readonly status = status;
  readonly units = units;
  readonly tauri = tauri;
  readonly telemetry = telemetry;
}
