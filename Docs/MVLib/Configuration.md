# MVLib Configuration

This page covers the runtime configuration surface in MVLib.

There are 2 main groups:

- `LoggerConfig`: output toggles
- `LoggerTimings`: polling, flushing, and roster-sync timing

All configuration is done through `mvlib::Logger`.

## `LoggerConfig`

`LoggerConfig` is the logger's runtime output state:

```cpp
struct LoggerConfig {
  std::atomic<bool> logToTerminal{true};
  std::atomic<bool> logToSD{true};
  std::atomic<bool> printWatches{true};
  std::atomic<bool> printTelemetry{true};
  std::atomic<bool> printWaypoints{true};
  std::atomic<bool> logSystemInfo{true};
};
```

You normally change these through setters:

```cpp
auto& logger = mvlib::Logger::getInstance();

logger.setLogToTerminal(true);
logger.setLogToSD(true);
logger.setPrintWatches(true);
logger.setPrintTelemetry(true);
logger.setPrintWaypoints(true);
logger.setLogSystemInfo(true);
```

## Output Toggles

### `setLogToTerminal(bool)`

Controls whether MVLib sends live telemetry and logs over the robot terminal link.

Leave this on when:

- you want MotionView live streaming
- you want live watches, logs, and waypoint events

Turn it off when:

- you only want SD logging
- you are intentionally disabling all terminal-side MVLib traffic

Important:

- In `v2.0.0`, terminal output stopped using the old plain-text MotionView stream. MVLib now uses a binary telemetry protocol for live MotionView data.
- If this is off, MotionView will not receive live telemetry from MVLib.

### `setLogToSD(bool)`

Controls whether MVLib writes logs to the SD card.

Leave this on when:

- you want saved logs after the run
- you want to review logs without live streaming

Turn it off when:

- you are not using an SD card
- you want to avoid SD writes entirely

Notes:

- SD logging can become locked after startup if MVLib encounters an SD error.
- Decide on SD behavior before `logger.start()` whenever possible.

### `setPrintWatches(bool)`

Controls whether registered watches are emitted.

If disabled:

- the watches stay registered
- MotionView will not receive watch samples until you re-enable watch printing

### `setPrintTelemetry(bool)`

Controls whether MVLib emits periodic pose/drivetrain telemetry.

If disabled:

- MotionView can still receive logs and watches
- path/pose-driven features will stop updating

### `setPrintWaypoints(bool)`

Controls whether MVLib emits waypoint events.

In current MVLib, that means:

- `CREATED`
- `REACHED`
- `TIMEDOUT`

It does not mean periodic waypoint offset streaming anymore. That old terminal-side offset event flow was removed.

### `setLogSystemInfo(bool)`

Controls whether MVLib emits its own internal/system messages.

This is useful when:

- bringing MVLib up for the first time
- debugging configuration or SD issues

Turn it off if you want MotionView to stay focused on your own logs and telemetry.

## `LoggerTimings`

`LoggerTimings` is the runtime timing struct:

```cpp
struct LoggerTimings {
  uint32_t sdBufferFlushInterval = 1000;
  uint32_t stdoutBufferFlushInterval = 400;
  uint32_t sdPollingRate = 80;
  uint32_t terminalPollingRate = 100;
  uint32_t rosterSyncAllInterval = 8000;
};
```

Set it with:

```cpp
logger.setTimings({
  .sdBufferFlushInterval = 1000,
  .stdoutBufferFlushInterval = 400,
  .sdPollingRate = 80,
  .terminalPollingRate = 100,
  .rosterSyncAllInterval = 8000
});
```

## Timing Fields

### `sdBufferFlushInterval`

Default: `1000`

How often MVLib flushes the SD file buffer with `fflush(file)`.

Lower values:

- reduce buffered data waiting in RAM
- increase flush frequency

Higher values:

- reduce flush overhead
- increase the amount of data sitting in memory before a flush

Also note:

- `ERROR` and `FATAL` SD writes are flushed immediately.

### `stdoutBufferFlushInterval`

Default: `400`

How often MVLib flushes the terminal/stdout buffer.

Use this cautiously. Lower values increase flush frequency and terminal pressure.

### `sdPollingRate`

Default: `80`

How often MVLib polls and writes SD-side data.

Lower values:

- increase SD-side work
- make SD updates happen more frequently

Higher values:

- reduce SD-side activity
- may reduce logger overhead

### `terminalPollingRate`

Default: `100`

How often MVLib polls and emits terminal/live telemetry data.

Lower values:

- make MotionView feel more responsive
- increase live telemetry traffic

Higher values:

- reduce live traffic
- reduce logger overhead

Warning:

- Setting this too low can overwhelm the brain-to-controller link.

### `rosterSyncAllInterval`

Default: `8000`

How often MVLib re-sends watch and waypoint roster metadata for late joiners.

Lower values:

- improve recovery if MotionView attaches late
- increase bandwidth usage

Higher values:

- reduce metadata traffic
- may make late-join recovery slower

## `setLoggingFolder(...)`

MVLib also supports SD log folder routing:

```cpp
bool setLoggingFolder(const char *folder, bool disableOnFail = false);
```

Call this before `logger.start()`.

Example:

```cpp
if (!logger.setLoggingFolder("\\telemetry", true)) {
  logger.warn("SD logging disabled: \\\\telemetry folder not found.");
}
```

Rules:

- pass a path relative to `/usd`
- start it with `\\`
- must not have a trailing `/`
- the folder must already exist on the SD card
- call it before `logger.start()`

Example valid value:

- `\\logs`

Example invalid value:

- `/usd/logs/`

Behavior:

- returns `true` only if the folder exists and MVLib accepts it
- returns `false` for an invalid path, non-existent folder, error during folder verification, or calls made after the logger has started
- if `disableOnFail` is `true`, a failed call locks SD logging off
- if `disableOnFail` is `false`, a failed call leaves MVLib able to fall back to the SD card root directory instead of a custom folder

Notes:

- MVLib checks folder existence with `pros::usd::list_files(...)`
- log files are written under `/usd<folder>/...`
- the generated log filename still uses the normal timestamp/randomized MVLib naming

## Minimum Log Level

Use `setMinLogLevel(...)` to filter normal log output:

```cpp
logger.setMinLogLevel(LogLevel::WARN);
```

That filters out:

- `DEBUG`
- `INFO`

And still allows:

- `WARN`
- `ERROR`
- `FATAL`

This affects MVLib's standard log methods such as `logger.info(...)` and watch output levels.
