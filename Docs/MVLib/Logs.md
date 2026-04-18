# MVLib Logs

MVLib provides 5 standard log functions:

- `logger.debug(...)`
- `logger.info(...)`
- `logger.warn(...)`
- `logger.error(...)`
- `logger.fatal(...)`

Use these for discrete events you want MotionView to show on the run timeline.

## Declarations

```cpp
void debug(const char *fmt, ...);
void info(const char *fmt, ...);
void warn(const char *fmt, ...);
void error(const char *fmt, ...);
void fatal(const char *fmt, ...);
```

All 5 use `printf`-style formatting.

## What Changed In `v2.0.0`

Live MotionView logging is no longer the old plain-text terminal format.

In `v2.0.0`:

- terminal/live logs are sent through MVLib's binary telemetry protocol
- SD logs are still written as readable text lines

So the important behavior is:

- MotionView still receives and displays these logs
- you should no longer think of them as hand-written `[LOG],...` text being printed to the live terminal stream

## Examples

### `debug(...)`

Use for low-priority debug details.

```cpp
logger.debug("Flywheel target set to %d", targetRpm);
```

### `info(...)`

Use for expected runtime milestones.

```cpp
logger.info("Started autonomous routine %d", selectedAuton);
```

### `warn(...)`

Use for non-fatal problems or suspicious states.

```cpp
logger.warn("Intake current high: %d", intake.get_current_draw());
```

### `error(...)`

Use for real failures.

```cpp
logger.error("Failed to detect ring at expected point");
```

### `fatal(...)`

Use for critical failures.

```cpp
logger.fatal("Odometry failed to calibrate");
```

## Filtering

These functions respect the logger minimum level:

```cpp
logger.setLoggerMinLevel(mvlib::LogLevel::WARN);
```

With that setting:

- `debug(...)` and `info(...)` are filtered out
- `warn(...)`, `error(...)`, and `fatal(...)` still emit

## Routing

These functions follow normal MVLib routing:

- if terminal logging is enabled, MotionView receives them live
- if SD logging is enabled, they are also written to the SD log

## Important `v2.0.0` Note

After `Logger::getInstance()` is created, do not use raw `printf`, `std::cout`, or other plain terminal prints for MVLib live logging.

Why:

- MVLib disables the normal PROS user-serial framing path when the logger is instantiated
- raw terminal text can collide with MVLib's binary telemetry stream

Use `logger.debug/info/warn/error/fatal(...)` instead.

## Logs vs Watches

Use logs for events:

- "Autonomous started"
- "Clamp closed"
- "Sensor calibration failed"
- "Reached matchload corner"

Use watches for sampled values:

- battery voltage
- RPM
- current draw
- temperature
- auton state over time
