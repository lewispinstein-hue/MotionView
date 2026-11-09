# Updating MVLib to v3.0.0

Use this guide to update a v2 robot project while keeping its logs, watches, and waypoint checks. Install the v3 package, update the calls below, then rebuild and verify the recording. [MVLib Setup](./Setup.md)

## API changes

| In v2 | In v3 |
| --- | --- |
| `watch()` took an interval or a boolean for on-change mode. | Pass `WatchMode::onInterval` or `WatchMode::onChange` followed by a timing value in milliseconds. For on-change watches, this is the debounce. |
| `watch()` returned a `WatchId` and could take a format string. | It returns a `mvlib::WatchHandle`. Remove the format string. If you use `LevelOverride<T>`, keep it directly after the getter and match `T` to the getter's return type. |
| Watch and waypoint names could be built with `std::string`. | Use fixed string literals of at most 23 characters for live display. |
| `WaypointOffset::timedOut` was optional. | It is now a `bool` reporting whether the timeout actually occurred. To check whether a deadline was configured, inspect `getParams().timeoutMs`. |
| `setLoggerMinLevel(...)` | Use `setMinLogLevel(...)` with the same severity. |
| `setLoggingFolder(...)` | Use `setLoggingLocation(...)` with a slash-prefixed path relative to the card and a folder policy. |
| `pause(bool)` | Use `pause()` with no arguments. |
| Applications could include `mvlib/telemetry.hpp`. | Include `mvlib/api.hpp` for the supported APIs. |

## Examples

The examples use `MVLIB_USE_SIMPLES` for the shorter names and time literals. [MVLib Setup](./Setup.md#choose-how-to-write-types-and-times)

### Convert an on-change watch

A v2 call could use `true` to track changes and supply a format string.

```cpp
logger.watch("Auton Stage", LogLevel::INFO, true,
  []() { return static_cast<int>(autonStage); },
  mvlib::LevelOverride<int>{}, "%d");
```

In v3, choose the mode and debounce. With 250 ms here, a stage that starts and ends within the debounce window can be missing from the recording. Use `0_mvMs` to preserve the old behavior of reporting a change as soon as the watch observes it. If you need to record every stage transition, log it at the place where you change the stage.

```cpp
logger.watch("Auton Stage", LogLevel::INFO, WatchMode::onChange, 250_mvMs,
  []() { return static_cast<int>(autonStage); });
```

### Convert an interval watch

Keep the previous interval and add `WatchMode::onInterval`. Save the returned handle if your code needs to change the watch during a run. [WatchHandle](./Watches.md#watchhandle)

```cpp
logger.watch("Flywheel RPM", LogLevel::INFO, WatchMode::onInterval, 1_mvS,
  []() { return flywheel.get_actual_velocity(); });
```

If an old format string supplied units, put the units in the label as in **Flywheel RPM**. If the getter returns a value in a different unit than you want to graph, convert it in the getter.

### Replace a dynamic waypoint name

Keep the waypoint name stable and put changing context, such as the selected routine, in a log. Save the handle if your routine checks the timeout later.

```cpp
logger.info("Auton %s approaching goal pickup", selectedAutonName.c_str());
auto goalPickup = logger.addWaypoint("Goal Pickup", params);
```

### Update a timeout check

Replace calls such as `offset.timedOut.value_or(false)` with the boolean flag directly. In v2, a condition on the optional itself checked whether a value was present. In v3, the condition checks whether the waypoint expired. Here, `goalPickup` is the handle from the previous example.

```cpp
const auto offset = goalPickup.getOffset();
if (offset.timedOut) {
  logger.warn("Goal pickup timed out");
}
```

This reports an expiry after the logger observes it. To detect whether the waypoint has a deadline at all, use `goalPickup.getParams().timeoutMs.has_value()`. For a retriggerable waypoint, an expiry can follow one or more successful reaches. [Waypoint handles](./Waypoints.md#waypointhandle)

### Update an SD destination

The example keeps the behavior of a v2 `setLoggingFolder(..., true)` call. Use `useRoot` if logging should continue in the card root when the folder is missing. [SD Logging](./SDLogging.md#setlogginglocation)

```cpp
logger.setMinLogLevel(mvlib::LogLevel::INFO);
logger.setBuildDate(__DATE__);
logger.setLoggingLocation("/telemetry", mvlib::MissingFolderPolicy::disable);
```

## Verify the upgrade

Run the robot and check a live watch, a waypoint event if you use odometry, and the SD file if you record runs.

For an on-change watch, change the value once and leave it steady to check the debounce you chose. For a timed waypoint, test a successful approach and an approach that runs out of time. For an explicit SD filename, run twice to verify the behavior you chose when a file already exists.

**A watch or waypoint call fails to compile.** Check for a dynamic label, an old watch signature, or a mismatched override type. When using designated initializers for a waypoint, place `.timeoutMs` before `.linearTol`. [Waypoint parameters](./Waypoints.md#waypointparams)

**A watch looks sparse after the upgrade.** Use interval mode when you need a continuous graph. On-change watches report a sample only when the value changes after the initial reading. [Watches](./Watches.md)

**The SD file moved or is missing.** Check the startup message and the folder and file policies. [SD troubleshooting](./SDLogging.md#troubleshooting)

See the release notes for the full list of changes. [MVLib v3.0.0 changelog](./Changelog/v3.0.0.md)
