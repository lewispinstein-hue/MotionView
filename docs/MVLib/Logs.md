# MVLib Logs

Use logs to record decisions and events in your robot code, such as starting autonomous, commanding the clamp to close, or deciding to retry a pickup. In MotionView, open the **Logs** tab to read those messages alongside the run and filter them by severity. [Viewing Mode](../MotionView/ViewingMode/ViewingMode.md?id=logs)

Use watches for values you want to sample over time and waypoints for targets you want to check against the robot's pose. [Watches](./Watches.md) · [Waypoints](./Waypoints.md)

## API reference

```cpp
void debug(const char* fmt, ...);
void info(const char* fmt, ...);
void warn(const char* fmt, ...);
void error(const char* fmt, ...);
void fatal(const char* fmt, ...);
```

All five methods use `printf`-style formatting. Use `%d` for an `int`, `%.1f` for a number with one decimal place, and `%s` with `name.c_str()` for a `std::string`.

| Method | When to use it |
| --- | --- |
| `debug(...)` | Details for tuning or diagnosis, such as the flywheel target or a command timestamp. |
| `info(...)` | Expected milestones, such as the routine starting or a pickup succeeding. |
| `warn(...)` | A problem the robot can recover from, such as an unconfirmed pickup it can retry. |
| `error(...)` | A step failed and the routine needs to skip it or take a fallback. |
| `fatal(...)` | A critical failure prevents the routine from continuing. Your code still needs to stop the robot or return as appropriate. |

### When a message reaches the recording

The logger's minimum severity applies before sending a message live or saving it to SD. At the default `INFO`, `info()`, `warn()`, `error()`, and `fatal()` are eligible. Use `DEBUG` to capture debug messages too. Raising the minimum to `WARN` during a run drops future `INFO` and `DEBUG` messages. If you may need them after the run, keep recording them and filter the Logs tab in MotionView instead. [Configuration](./Configuration.md?id=minimum-log-level)

A direct log call can send a live message before `start()` if terminal output is enabled and the viewer is listening. The SD file opens during `start()`, so put a startup confirmation after that call if it needs to appear in the file. Direct logs still follow these rules while the periodic logger task is paused. [SD Logging](./SDLogging.md)

After the first call to `Logger::getInstance()`, use the logger for terminal messages. Raw `printf` and `std::cout` output can interfere with live telemetry.

## Examples

### Trace an autonomous pickup

Log the routine at entry, the command where you issue it, and the outcome where you check the sensor. For this test, enable `DEBUG` during setup to capture the clamp command.

```cpp
logger.setMinLogLevel(mvlib::LogLevel::DEBUG);
```

```cpp
logger.info("Started autonomous routine %d", selectedAuton);

// Immediately after issuing the command.
logger.debug("Commanded goal clamp to close");

// When the confirmation window ends.
if (goalDetected) {
  logger.info("Goal pickup confirmed");
} else {
  logger.warn("Goal pickup unconfirmed after %u ms",
              static_cast<unsigned>(pickupWaitMs));
}
```

Find the warning in MotionView and check the path and clamp watch at that point on the timeline. A matching waypoint can show whether the robot reached the pickup pose. If the routine polls the sensor repeatedly, put the warning after the confirmation window expires. That yields one event with the elapsed time. Use a watch if you need to see the sensor readings during the wait.

### Report a failure

Use `error()` if the routine can continue with a different plan. Call it at the point where the code chooses that fallback.

```cpp
logger.error("Goal pickup failed, skipping score");
```

Use `fatal()` if the routine cannot start, for example when odometry is required and calibration failed. This example returns from the autonomous routine.

```cpp
if (!odomReady()) {
  logger.fatal("Odometry unavailable, aborting autonomous");
  return;
}
```

## Troubleshooting

**I see warnings but no startup or debug messages.** Check `setMinLogLevel(...)` and the Logs tab's filter. For messages from MVLib itself, check `setLogSystemInfo(true)` too.

**I see a message live but it is missing from the SD file.** Confirm the SD file opened and the call happened after `start()`. [SD troubleshooting](./SDLogging.md?id=troubleshooting)

**The log says the clamp closed, but it was still open.** Check where the message is written. A message next to the motor or solenoid command only confirms the command ran. Use distinct messages for the command and for a later sensor confirmation so the timeline shows where the two diverged.
