# MotionView v1.4.0 Changelog

Source range: `4b572c34d7431d23d9ac611bdc8ce5b4e1b69390..head`

## New Features

- Added custom field image uploads. Uploaded images are saved with their configurable real-world dimensions and can be used alongside the bundled competition fields.
- Added multiple Planning paths in one project, with path management and shared objects and methods for placed events.
- Added a Derive button to each Planning path to create and open an independent copy of its waypoints, nodes, and export settings, with undo/redo support.
- Added a remembered Planning setting to show or hide nodes on the field path in both Planning Mode and the Viewing Mode overlay while keeping timeline nodes visible.
- Expanded Planning Mode with per-waypoint code overrides; rotate, swing, forward, and boomerang indicators; and insertion of new waypoints directly on an existing path segment.
- Added selected-path highlighting in Planning Mode so the segment associated with the selected waypoint is easier to identify.
- Expanded Planning export templates with movement-direction data and shorthand aliases for waypoint and placed-method variables.
- Added independent remembered overwrite-confirmation choices for MotionView JSON and Planning code exports, plus clearer successful-copy feedback.
- Added a Settings action to reset the window position and size when the saved layout is unsuitable for the current display.
- Added the ability to right-click on a path to insert a new waypoint in between existing segments.
- Added drag-and-drop route imports in both browser and desktop builds, using the same validation and confirmation flow as selecting a file.
- Added drag-and-drop reordering for Methods within a Planning Object, including a predicted drop position and placement animation.

## Improvements

- **Wireless streaming keeps up under heavy text telemetry:** the V5 terminal now drains all frames already returned by a controller read before making another radio request. In hardware testing, long text logs at the minimum `intervalMs` streamed without observable buffering or catch-up latency.
- Live streaming now shows its Started banner as soon as the terminal is ready, before the first telemetry record. Startup failures show actionable PROS messages, and a controller upload in progress prevents a competing wireless stream from opening the same port.
- Planning node tooltips now switch immediately between nearby nodes on the field and timeline after the initial hover delay, with a shared hover state that avoids flicker.
- Planning's timeline now supports horizontal scrolling with a vertical mouse wheel, matching the top bar and Viewing sidebar tabs while preserving horizontal trackpad input.
- Reworked live-stream telemetry around explicit session metadata, roster replay, compact system messages, and stronger error recovery so MotionView can distinguish normal terminal exits, received new-program markers, and recoverable stream failures.
- Improved live decoding across malformed batches, late connections, reconnects, delayed or multiple timestamp wraps, and terminal shutdowns while keeping valid telemetry available.
- Disabled Start now explains the current blocker in its tooltip, including a missing or invalid PROS project directory, project validation, bridge readiness, and connection or stream operations in progress.
- Updated live sidebar virtualization so rows are retained and refreshes defer during pointer interaction. Streaming updates no longer reset the cursor or make sidebar action buttons difficult to click.
- Added descriptive tooltips, accessible names, and pressed states to watch graph and pin buttons.
- Increased the background opacity of floating information, graph, and pinned-watch panels from 60% to 80%, and display floating-panel timestamps in seconds with fixed millisecond precision.
- Kept Planning node tooltips within the viewport, added motion-type help tooltips, and improved Planning playback and selection feedback.
- Made Planning timeline waypoint connectors easier to target across the full line and marker; selecting one now moves the playback robot to that waypoint, while double-clicking opens its editor.
- Improved bundled PROS and MVLib tooling with cross-platform archive caching, EZ-Template installation helpers, and clearer Windows terminal startup behavior.
- Expanded release verification with decoder/MVLib transport, bridge, live capture, export, persistence, Planning, import-case, and native Rust regression checks.

## Bug Fixes

- Suppressed the irrelevant LibreSSL/`urllib3` warning in the bundled terminal. Corrupted binary telemetry now produces a short diagnostic instead of a long hex dump, and decoding continues with the next valid frame.
- Fixed saved-data loss risks with atomic writes, ordered autosaves, and one backup from the last clean shutdown. Damaged or missing current settings and recordings recover from a valid backup with a notification; defaults regenerate when no valid copy exists.
- Fixed native close/quit handling so the final saved snapshot reflects the current UI after pending live records are processed. If the shutdown backup cannot be saved, MotionView stays open and offers a retry.
- Fixed accidental replacement of existing JSON exports, repeated submissions while replacement confirmation is pending, and unclear export errors. JSON export success now shows the full destination.
- Fixed Planning Project exports targeting a previously selected project. The resolved destination follows the current project, preserves custom filenames, and ignores stale directory responses.
- Fixed route imports so an invalid capture cannot clear the current route and a capture without Planning data does not erase the existing Planning route.
- Fixed repeated live-stream attempts losing their automatic refresh timer after a terminal exit. The configured interval resumes on Start, while Off remains manual.
- Fixed buffered telemetry being discarded on Stop, force-stop, terminal exit, disconnect, or quit, including final records received while stopping.
- Fixed Stop/Start corrupting the route timeline after timestamp rollover. Local timestamp context now continues the same recording while the robot program keeps running, including multiple missed wraps; a received START begins a new recording. Stale poses cannot break chronological pose order.
- Fixed fragmented binary frames being mistaken for text because their prefix was printable or contained a newline. Malformed COBS packets are rejected, and text banners or separator lines no longer reset timestamp or roster state.
- Fixed oversized terminal lines stopping the pipe reader. The bad line is discarded, a Decoder Error is shown in the live console, and subsequent valid telemetry continues to be processed.
- Fixed fallback Python launches escaping the selected virtual environment when its interpreter is a symlink.
- Fixed legacy watches with missing IDs being treated as ID 0, and removed argument-limit failures from large watch projections and graph calculations.
- Fixed invalid drivetrain speed readings so the pose remains available for field navigation and timeline scrubbing while its speed trace is shown as a gap instead of fabricated data. Missing or blank readings now display as unavailable.
- Fixed playback retaining a pose from a recording that has been replaced or cleared, and fixed zero image opacity being lost during persistence or rendering.
- Fixed background editing shortcuts operating through open modals, keyboard focus escaping dialogs, and focus restoration after nested dialogs close.
- Fixed top-bar controls overlapping at narrow window sizes and restored windows opening outside the available monitor work area after display changes.
- Fixed Planning export edge cases, including integer speed formatting, code-file overwrite confirmation, template rendering, modal scope, timeline insertion, undo behavior, selected-waypoint editing, and mirror icons.
- Fixed modal backdrops closing when a text selection began inside a modal and ended outside it.
- Fixed live-stream and desktop edge cases involving stale sockets, out-of-order watch markers, autosave during streaming, single-instance focus, exit cleanup, and window-size persistence.
- Fixed custom field persistence, field robot-width orientation, text inputs with spaces, and Windows live-terminal launching.
- Fixed telemetry import filename capitalization and added a check to catch mismatches on case-sensitive platforms.
- Resolved 24 reviewed pull requests covering MotionView and MVLib correctness, telemetry reliability, Planning Mode behavior, export safety, and desktop lifecycle handling.
