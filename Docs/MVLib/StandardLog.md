# MVLib Standard Logs

These functions are MVLib's MotionView-formatted log functions:

- `logger.debug()`
- `logger.info()`
- `logger.warn()`
- `logger.error()`
- `logger.fatal()`

Use them when you want MotionView to parse and display a log message as a normal event in the run.

They are different from the `LOG_*` macros. The macros are useful for general logging, but these functions specifically emit the `[LOG]` format MotionView expects.

## Declarations

<details>
  <summary><tiny>View Source Code</tiny></summary>

```cpp
class Logger {
public:
void debug(const char *fmt, ...);
void info(const char *fmt, ...);
void warn(const char *fmt, ...);
void error(const char *fmt, ...);
void fatal(const char *fmt, ...);
};
```
</details>

All five functions take:

- a `printf`-style format string
- matching format arguments

They only differ by severity level.

## What They Do

Each function writes a MotionView-readable log line in this shape:

```cpp
[LOG],timestamp,LEVEL,message
```

That means MotionView can display:

- when the event happened
- what severity it had
- the message itself

These functions also respect normal MVLib output routing:

- if terminal logging is enabled, they print to terminal
- if SD logging is enabled and available, they also write to SD

## Severity Levels

### `debug(...)`

Use for low-priority debugging detail.

```cpp
logger.debug("Flywheel target set to %d", targetRpm);
```

### `info(...)`

Use for normal runtime events you expect to happen.

```cpp
logger.info("Started autonomous routine %d", selectedAuton);
```

### `warn(...)`

Use for abnormal situations that are minor.

```cpp
logger.warn("Intake current high: %d", intake.get_current_draw());
```

### `error(...)`

Use for failures or serious issues.

```cpp
logger.error("Failed to detect ring at expected point");
```

### `fatal(...)`

Use for critical failures where the rest of the routine may no longer function correctly.

```cpp
logger.fatal("Odometry failed to calibrate!");
```

## Important Notes

- Messages are truncated to 512 bytes.
- These functions are affected by the logger's minimum log level.
- If `minLoggerLevel` is set above a function's severity, that message will not be emitted.

Example:

```cpp
logger.setLoggerMinLevel(mvlib::LogLevel::WARN);
```

With that setting:

- `debug(...)` and `info(...)` are filtered out
- `warn(...)`, `error(...)`, and `fatal(...)` still print

## When To Use These Instead of Watches

Use standard logs when you want to log anything that doesn't need to be constantly monitored.

Examples:

- "Autonomous started"
- "Ring detected"
- "Sensor calibration failed"
- "Drive settled at target"

Use watches when you want MVLib to keep sampling a value over time.

Examples:

- battery voltage
- current draw
- RPM
- temperature

## Guide:

- Prefer `info(...)` for normal milestones in a routine.
- Use `warn(...)` when something looks wrong but the robot can keep going.
- Reserve `error(...)` and `fatal(...)` for genuinely important failures.
- Do not spam `debug(...)` every loop unless you really need that much detail.

These functions are best when you want MotionView to show clear, readable events along the run timeline.
