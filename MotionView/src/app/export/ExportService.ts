import type { MotionViewApp } from "../MotionViewApp";
import type { MotionViewDocumentSerializer } from "../persistence";
import { exportMotionViewJson } from "../../tauri/commands";
import { exportTelemetry } from "../../telemetry/createTelemetry";
import type { ExportRequest } from "./exportTypes";
import { stringifyExportJson } from "./exportJson";

export class ExportService {
  constructor(
    private readonly app: MotionViewApp,
    private readonly serializer: MotionViewDocumentSerializer,
  ) {}
  async export(
    request: Readonly<ExportRequest>,
    overwrite = false,
  ): Promise<Readonly<{ path: string; json: string }>> {
    const payload = this.serializer.exportPayload(
      request.exportType,
      request.pathName,
      this.app.settings.current,
    );
    const json = stringifyExportJson(payload);
    const result = await exportMotionViewJson({
      filenameBase: request.filenameBase,
      location: request.destination.kind,
      customPath: request.destination.customPath,
      jsonContents: json,
      overwrite,
    });
    const planning = request.exportType !== "viewing";
    const viewing = request.exportType !== "planning";
    void exportTelemetry.motionviewJsonExported(
      this.app.planning.telemetryProperties({
        export_type: request.exportType,
        includes_planning: planning,
        includes_viewing: viewing,
        export_location: request.destination.kind,
        exported_viewing_poses: viewing
          ? this.app.viewing.data.poses.length
          : 0,
        exported_viewing_watches: viewing
          ? this.app.viewing.data.watches.length
          : 0,
        exported_viewing_logs: viewing ? this.app.viewing.data.logs.length : 0,
        exported_viewing_waypoints: viewing
          ? this.app.viewing.data.waypoints.length
          : 0,
      }),
    );
    return { path: result.path, json };
  }
}
