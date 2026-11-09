# MVLib Configuration

Configure MVLib to match the run you want to review. Use live output while tuning, SD output for untethered runs, or both to compare what you saw live with a saved recording. Tune the pose rate or disable categories you do not need if the live stream falls behind.

## API reference

### Output

All six switches default to `true`. The category switches apply to both live and SD output. Set SD output and its destination before `logger.start()`. You can change the other switches while the logger runs.

| Method | Effect when set to `false` |
| --- | --- |
| `void setLogToTerminal(bool enabled)` | Turns off live output. SD logging can continue. |
| `void setLogToSD(bool enabled)` | Turns off recording to the card. Calls after `start()` are ignored. |
| `void setPrintWatches(bool enabled)` | Pauses automatic watch sampling. Watches stay registered. |
| `void setPrintTelemetry(bool enabled)` | Suppresses periodic pose and drivetrain data. Waypoint tracking continues. |
| `void setPrintWaypoints(bool enabled)` | Suppresses waypoint events while handles continue to update. Events skipped during that time are lost. |
| `void setLogSystemInfo(bool enabled)` | Suppresses MVLib's own diagnostics, including SD startup messages. User logs have their own severity filter. |

Use `setLoggingLocation(...)` to choose the destination and `setBuildDate(__DATE__)` when using generated filenames. [SD Logging](./SDLogging.md#setlogginglocation)

### Choose what to turn off

First decide whether you want to change the recording or only what MotionView shows. For example, if debug logs are distracting but you may need them later, leave them enabled on the robot and filter the Logs tab. If you raise the robot's minimum level, future debug messages are skipped in both destinations.

The output switches also differ in what keeps running.

- Turning off terminal output leaves SD recording available. When you re-enable terminal output, MotionView can receive new data. Use the SD file to review what happened while live output was off.
- Turning off automatic watch output stops the logger from reading the watch getters on its normal schedule. Turning it back on resumes the registered watches. An on-change watch can stay quiet if its value still matches the last report. A handle can still request a manual sample while automatic output is off. [WatchHandle](./Watches.md#watchhandle)
- Turning off pose output removes the path from the recording for that period. Waypoints still use odometry and can still report reach and timeout events. Turning off waypoint output hides those events while the handles continue to update.
- Pausing the logger also pauses waypoint checks. Use the output switches when you want checks to continue quietly. [Logger startup and controls](./Setup.md#start-and-control-the-logger)

### Minimum log level

`void setMinLogLevel(LogLevel level)` sets the minimum severity for logs and watch samples on both outputs. The default is `INFO`. Use `WARN` to keep warnings and errors, or `LogLevel::OFF` to suppress ordinary logs and watches. Use the separate switches above for pose and waypoint output. [Logs](./Logs.md) · [Watch thresholds](./Watches.md#flag-readings-above-a-threshold)

The minimum applies to each sample's final severity. For instance, an `INFO` current watch with a `WARN` threshold can still show high readings at a `WARN` minimum. MVLib's startup messages are also filtered by level. If you need the SD filename or other startup details, keep system messages enabled and the minimum at `INFO` during setup.

### Built-in watchdogs

```cpp
struct DefaultWatches {
  bool leftDrivetrainWatchdog = true;
  bool rightDrivetrainWatchdog = true;
  bool batteryWatchdog = true;
};

bool setDefaultWatches(DefaultWatches watches);
```

`DefaultWatches` is a type on `mvlib::Logger`. Call `setDefaultWatches(...)` once during setup with the flags you want. Configure the drivetrain with `setRobot(...)` first. Without a valid drivetrain, the call returns `false` and skips the drivetrain watches. Battery watches can still be registered.

The watchdogs report at `WARN` and stay quiet during normal operation.

- Left and right drivetrain temperatures warn at 50 °C or above.
- Battery temperature warns at 45 °C or above. Battery voltage warns outside 11.7–13.25 V.
- Changed warnings use a 750 ms debounce. A steady warning repeats every five seconds.

Use the watchdogs to notice a problem during a run. A motor cooling below the threshold makes the watchdog quiet again. If you need the readings before and after the warning or want to measure how long it took to cool, add an interval temperature watch. The watchdogs follow the automatic watch switch and the logger's minimum level. [Watches](./Watches.md)

### Timings

`void setTimings(LoggerTimings timings)` sets the full group of timings in milliseconds. Pass all your chosen values together. Configure them before `start()` if they need to be in effect from the beginning.

| `LoggerTimings` field | Default | Effect |
| --- | --- | --- |
| `sdBufferFlushInterval` | 1000 ms | How long to wait before the next SD write also flushes pending data. Shorter intervals reduce how much recent data you can lose on power-off. `0` flushes every write. Errors and fatal messages flush immediately. |
| `stdoutBufferFlushInterval` | 400 ms | How often to flush pending terminal output. `0` disables periodic flushing. |
| `terminalPollingRate` | 100 ms | Interval for pose updates when live output is on. This also sets the pose interval in the SD recording while both outputs are on. `0` disables those updates. |
| `sdPollingRate` | 80 ms | Interval for pose updates when live output is off. `0` disables those updates. |
| `rosterSyncAllInterval` | 8000 ms | How often MVLib re-sends watch names and active waypoint definitions so a viewer can join late. Shorter intervals help names appear sooner but use more bandwidth. `0` disables periodic resends. |

Choose the pose interval based on whether terminal output is enabled in MVLib. Disconnecting MotionView while leaving terminal output enabled still uses `terminalPollingRate`. If you turn terminal output off for a run, set `sdPollingRate` for the detail you want in the saved path. Neither interval changes watch cadence or waypoint checks.

If you have already tuned several settings, keep and reuse your `LoggerTimings` value when making another change. Starting from a fresh `LoggerTimings{}` restores defaults for any fields you leave alone.

## Examples

### Choose live, SD, or both

Leave both outputs enabled to see a run live and keep a copy. For a run you plan to review later, disable terminal output before starting the logger.

```cpp
auto& logger = mvlib::Logger::getInstance();
logger.setLogToTerminal(false);
logger.setBuildDate(__DATE__);
logger.start();
```

For live tuning without a card, leave terminal output enabled and call `logger.setLogToSD(false)` before startup. If you only need watches and logs during a bench test, call `logger.setPrintTelemetry(false)` to leave pose updates out of both outputs.

### Keep warnings and errors

```cpp
logger.setMinLogLevel(mvlib::LogLevel::WARN);
```

This also hides normal samples from an `INFO` watch with a `WARN` override. Use `INFO` if you need to see the readings leading up to a warning.

### Enable the built-in watchdogs

After registering your drivetrain, use an empty initializer to enable all the watchdogs. For a test focused on drivetrain heat, turn off the battery watchdog.

```cpp
logger.setDefaultWatches({.batteryWatchdog = false});
```

### Tune timing for the run

If the path gets choppy over a controller link, try sending pose less often. This doubles the live pose interval while keeping the other timings at their defaults.

```cpp
mvlib::LoggerTimings timings{};
timings.terminalPollingRate = 200;
logger.setTimings(timings);
```

## Troubleshooting

**The SD pose recording rate changed when I enabled live streaming.** `terminalPollingRate` now controls both copies of the pose data.

**I turned off pose output and the waypoint still reached.** Waypoint tracking still reads odometry. Use `setPrintWaypoints(false)` to hide the events while keeping handle state.

**The live stream falls behind during a test.** Increase `terminalPollingRate` for fewer pose updates, slow down a high-rate watch, or raise the minimum level if debug messages dominate the stream. Change one setting at a time to see which helped.
