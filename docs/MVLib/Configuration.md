# MVLib Configuration

This page covers the configuration surface in MVLib.

There are 2 main groups:

- `LoggerConfig`: output toggles
- `LoggerTimings`: polling, flushing, and roster-sync timing

All configuration is done through `mvlib::Logger`.

Configure SD behavior, logging location, build date, odometry, drivetrain references, watches, and waypoints before `logger.start()`. Terminal and printing toggles may be changed at runtime. Timing changes are safe at runtime, although each timing field may take effect independently during an update cycle.

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

- This setting is only changeable before `logger.start()`; calls after startup are ignored.
- SD logging is disabled if initialization, a write, or a flush fails.
- When terminal and system messages are enabled, MVLib emits one terminal error when a runtime SD write or flush failure disables logging.

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

`LoggerTimings` is the timing configuration struct:

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

Timings can be changed at runtime. They are stored independently, so set all
fields before `logger.start()` when they must begin together.

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

How often MVLib emits periodic pose telemetry when terminal output is disabled.

This also controls periodic pose records written to SD in SD-only mode. It does
not control SD flushes, watches, waypoint events, or direct log calls.

Lower values:

- increase SD-side work
- make SD updates happen more frequently

Higher values:

- reduce SD-side activity
- may reduce logger overhead

### `terminalPollingRate`

Default: `100`

How often MVLib emits periodic pose telemetry when terminal output is enabled.

When terminal and SD logging are both enabled, this cadence also controls the
periodic pose records written to SD. Watches and waypoint checks run on the
fixed 40 ms MVLib update loop.

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

## `setLoggingLocation(...)`

Allows you to set a custom logging folder and/or file to route all SD card data to.

See [SDLogging.md](./SDLogging.md#setlogginglocation) for the full API contract, path rules, and fallback policy behavior.

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

Set the minimum level before `logger.start()` when possible so the telemetry task and user tasks begin with the same filter state.
