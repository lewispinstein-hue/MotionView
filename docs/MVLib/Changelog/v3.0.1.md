# MVLib v3.0.2 Changelog

Source range: `4b572c34d7431d23d9ac611bdc8ce5b4e1b69390..head`

## New Features

- Added session-aware terminal telemetry with startup metadata and replayable watch and waypoint roster information so MotionView can reconstruct the current logger state after connecting.
- Added extended POSE telemetry for non-finite drivetrain readings. MotionView can retain the pose for navigation while explicitly representing unavailable speed data.
- Added EZ-Template cache/install helpers for supported platforms and a runtime decoder test harness for telemetry protocol coverage.

## Improvements

- The background telemetry writer now completes each COBS frame across partial serial writes and temporary backpressure. This preserves frame boundaries during bursts of long text logs. MotionView's updated wireless reader drains cached frames before making another controller request, reducing repeated radio polling and backlog.
- Reworked terminal telemetry delivery with stronger packet prioritization, compact system diagnostics, and clearer session transitions between robot programs.
- Improved public logger and handle operations to wait for a consistent logger-state snapshot instead of returning misleading default data during ordinary mutex contention.
- Improved SD logging behavior by allowing a short bounded wait for an in-progress flush, reporting dropped records, and escaping free-text CSV fields safely.
- Improved cross-platform MVLib archive caching and optional odometry integration behavior.
- Updated public Doxygen documentation to explain the logger-state blocking contract and correct the `WaypointParams` designated-initializer order.
- Added host-side regression coverage using the actual terminal text producers and MotionView decoder, including fragmented packets, CSV punctuation, Unicode, and maximum-length text.

## Bug Fixes

- Fixed a retry limit that could abandon a partially written terminal packet, leaving adjacent text-watch or log frames merged and undecodable under heavy output.
- Fixed periodic terminal roster replay so late-joining and reconnecting viewers can recover watch and active waypoint definitions.
- Updated START telemetry with the full robot timestamp and startup metadata so MotionView can initialize timestamp reconstruction when that packet is received. Timestamp expansion and Stop/Start continuity are handled by the MotionView decoder.
- Fixed drivetrain speed reporting when a motor returns `NaN` or infinity, and made fallback estimated speed preserve forward versus backward direction from the reported heading.
- Fixed logger mutex races that could return empty waypoint offsets, invalid handles, or stale watch state while the periodic logger task was updating.
- Fixed SD log records being dropped under normal mutex contention and corrected CSV escaping for labels and free-text log values.
- Fixed default drivetrain-overheating labels being truncated in the live roster.
- MVLib now replaces carriage returns (`\r`) and newlines (`\n`) in log messages, watch text, and labels with spaces so each live telemetry or SD replay record stays on one line. Commas, quotes, tabs, and Unicode are preserved, with CSV escaping where required.
