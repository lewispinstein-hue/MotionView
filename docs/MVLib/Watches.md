# MVLib Watches

Watches sample a value over time and send it to MotionView in a structured way.

Use them for values like:

- battery voltage
- flywheel RPM
- current draw
- temperature
- booleans or state flags
- auton stage

## Main API

MVLib provides 2 watch styles through `WatchMode`:

- `WatchMode::onInterval`
- `WatchMode::onChange`

```cpp
template<class Getter, size_t len>
WatchHandle watch(const char (&label)[len], LogLevel baseLevel, WatchMode type,
                  uint32_t intervalMs, Getter&& getter,
                  LevelOverride<std::decay_t<std::invoke_result_t<
                    Getter&>>> ov = {});
```

The core parameters are:

- `label`: watch name shown in MotionView
- `baseLevel`: normal severity
- `type`: watch behavior
- `intervalMs`: interval or debounce, depending on `type`
- `getter`: callable returning the current value
- `ov`: optional `LevelOverride`

The mode parameters work like this:

- `WatchMode::onInterval`: `intervalMs` is the sample/print interval
- `WatchMode::onChange`: `intervalMs` is the debounce interval between emitted changes
- the single `watch(...)` API returns a `WatchHandle`
- floating-point watch values are rendered with two decimal places

## `WatchMode`

```cpp
enum class WatchMode : uint8_t {
  onInterval = 0,
  onChange
};
```

### `WatchMode::onInterval`

Use this when you want a watch sampled and emitted on a regular cadence.

Behavior:

- `intervalMs` is the normal sample/emit interval
- change detection is not used

### `WatchMode::onChange`

Use this when the value only matters when it changes.

Behavior:

- MVLib compares the rendered output string
- `intervalMs` is the debounce interval between emitted changes
- if the rendered value does not change, MVLib does not emit another sample

## `WatchHandle`

`logger.watch(...)` returns a `WatchHandle` you can keep for runtime control.

```cpp
mvlib::WatchHandle batteryWatch = logger.watch("Battery Voltage", LogLevel::INFO,
  WatchMode::onInterval, 1_mvS, []() { return pros::battery::get_voltage(); });
```

```cpp
class WatchHandle {
public:
  bool valid() const;
  bool active() const;
  void setActive(bool v);
  uint32_t intervalMs() const;
  WatchMode type() const;
  void setIntervalMs(uint32_t intervalMs);
  void setType(WatchMode v);
  std::string evaluate(bool emit = false);
  bool resyncRoster() const;
};
```

### `valid()`

Returns whether the watch was created successfully. A watch is invalid if MVLib failed to register it. Right now that mainly means the internal mutex could not be acquired during registration.

If `valid()` is false, do not rely on the handle for control or evaluation.

### `active()`

Returns whether the watch is currently enabled for normal MVLib output.

An active watch can be emitted by the logger's normal watch loop. An inactive watch stays registered, keeps its label and settings, and can still be re-enabled later, but it is skipped by normal watch printing while inactive.

### `setActive(bool v)`

Enables or disables the watch without removing it.

Parameter:

- `v`: `true` enables normal watch emission again. `false` suppresses normal emission until re-enabled.

This only changes whether the watch participates in normal logging. It does not delete the watch or clear its configuration.

### `intervalMs()`

Returns the watch's current timing value.

Behavior:

- for interval watches, this is the normal sample and emit interval
- for on-change watches, this is the debounce interval between emitted changes

### `setIntervalMs(uint32_t intervalMs)`

Updates the watch's current timing value.

Parameter:

- `intervalMs`: new interval in milliseconds, or new debounce interval for on-change watches

Behavior:

- interval watches use the new value as their future emit cadence
- on-change watches use the new value as their future debounce window
- `0` means no waiting window; MVLib can emit on the next eligible sample

### `type()`

Returns whether this watch currently uses on-change emission.

Behavior:

- `WatchMode::onChange` means normal watch printing only emits when the rendered value changes
- `WatchMode::onInterval` means normal watch printing uses interval-based emission instead
- this reports the watch's current mode, including changes made after creation

### `setType(WatchMode v)`

Updates the watch's current mode.

Parameter:

- `v`: new mode

Behavior:

- when set to `WatchMode::onChange`, the watch compares rendered values and uses `intervalMs()` as its debounce window
- when set to `WatchMode::onInterval`, the watch ignores change detection and uses `intervalMs()` as its regular emit interval
- this does not remove or recreate the watch; it only changes how normal watch printing schedules it

### `evaluate(bool emit = false)`

Evaluates the watch immediately and returns the rendered watch value as a string.

Parameter:

- `emit`: if `false`, MVLib only evaluates and returns the current rendered value. If `true`, MVLib also forces one immediate watch emission.

Behavior:

- `evaluate()` bypasses the normal scheduler
- `evaluate(true)` also bypasses normal interval and debounce gating
- `evaluate(true)` sends exactly one immediate watch sample using the watch's normal label, value rendering, and optional `LevelOverride`
- `evaluate(true)` is a manual emit, so it is not blocked just because the watch is inactive
- direct `evaluate(...)` runs the stored watch evaluator, so the main MVLib update loop is paused only for the duration of that manual watch evaluation
- if evaluation fails, it returns an empty string

Example:

```cpp
mvlib::WatchHandle stageWatch =
  logger.watch("Auton Stage", LogLevel::INFO, WatchMode::onChange, 250_mvMs,
    [&]() { return static_cast<int>(autonStage); });

// Prints the current stage without emitting
pros::lcd::print(..., "Stage: %s", stageWatch.evaluate(false).c_str());

stageWatch.evaluate(true); // Force one immediate emit
```

### `resyncRoster()`

Re-sends this watch's roster entry to MotionView.

Use this when the watch exists and is emitting, but MotionView missed the watch name or alternate elevated label because it joined late.

Behavior:

- re-sends the normal roster label for this watch
- also re-sends the elevated label if this watch has one
- only affects this specific watch, unlike `logger.resyncAllWatchesRoster()`
- returns `true` if this watch's roster entry was actually re-sent
- returns `false` if this watch is not valid, inactive, missing, or terminal output is disabled

## Interval-Based Watches

Use this for continuously changing values:

```cpp
logger.watch("Flywheel RPM", LogLevel::INFO, WatchMode::onInterval, 1_mvS,
  [&]() { return flywheel.get_actual_velocity(); });
```

Good fits:

- RPM
- temperature
- current draw
- analog sensor values

If you do not need alerting behavior, you can omit `LevelOverride` entirely.

## On-Change Watches

Use this for event-like values:

```cpp
logger.watch("Auton Stage", LogLevel::INFO, WatchMode::onChange, 250_mvMs,
  [&]() { return static_cast<int>(autonStage); });
```

Good fits:

- booleans
- mode/state enums converted to integers or strings
- values that only matter when they change

Important:

- on-change watches compare the rendered output string
- if the rendered string does not change, MVLib does not emit another sample
- when the rendered string changes, MVLib waits for the debounce interval before emitting
- `0` disables the debounce delay and emits on the next changed sample

## `LevelOverride`

`LevelOverride<T>` lets a watch promote itself to a higher severity when a predicate trips.

```cpp
template<class T>
struct LevelOverride {
  LogLevel elevatedLevel = LogLevel::WARN;
  std::function<bool(const T&)> predicate;
  std::string label;
};
```

Example:

```cpp
logger.watch("Intake Current", LogLevel::INFO, WatchMode::onInterval, 750_mvMs,
  [&]() { return intake.get_current_draw(); },
  mvlib::LevelOverride<int32_t>{
    .elevatedLevel = LogLevel::WARN,
    .predicate = PREDICATE(v > 2000),
    .label = "Intake Current High"
  });
```

That means:

- normal samples log at `INFO`
- samples above 2000 log at `WARN`
- the elevated sample can use a different label

If you do not need elevated severity or an alternate label, leave `ov` unset.

## Exact Type Matching Matters

`LevelOverride<T>` must match the getter return type after decay.

Examples:

- getter returns `double` -> use `LevelOverride<double>`
- getter returns `int32_t` -> use `LevelOverride<int32_t>`
- getter returns `int` -> use `LevelOverride<int>`
- getter returns `bool` -> use `LevelOverride<bool>`

If the types do not match, the watch call is designed to fail at compile time.

## `PREDICATE(...)` And `asPredicate<T>(...)`

`PREDICATE(...)` is only for `int32_t` predicates:

```cpp
#define PREDICATE(func) \
  mvlib::asPredicate<int32_t>([](int32_t v) -> bool { return func; })
```

Use it when the getter returns an `int32_t`-compatible type.

Example:

```cpp
.predicate = PREDICATE(v > 50)
```

If your getter returns another type, use `asPredicate<T>(...)` directly:

```cpp
.predicate = mvlib::asPredicate<double>([](const double& v) {
  return v > 550.0;
})
```

## Value Rendering

Watch values are rendered before `WatchMode::onChange` comparison and before SD logging.

Rendering behavior:

- floating-point watches are rendered with two decimal places
- integral watches use `std::to_string(...)`
- booleans render as `true`/`false` in SD logs and MotionView
- `std::string` and `const char *` are sent as text watches

Because on-change watches compare the rendered string, floating-point values count as changed when their two-decimal rendered value changes.

## What MotionView Receives

When terminal output is enabled:

- numeric watch values are sent as binary numeric watch packets when possible
- non-numeric values are sent as structured text-watch packets

When SD logging is enabled:

- watches are also written as readable `[WATCH],...` lines

## Label Length

The C++ `watch(...)` literal overload rejects labels longer than 24 characters.

Live MotionView roster packets reserve 24 bytes for the label including the trailing null byte, so only 23 visible characters are guaranteed to survive unchanged in live telemetry. Use 23 characters or fewer for labels and elevated labels that must display exactly in MotionView.

## Resync Helpers

If MotionView joins late and a watch name is missing, re-send watch roster metadata with:

```cpp
logger.resyncAllWatchesRoster();
```

This is especially useful in `v2.0.0`, where roster metadata is its own live telemetry channel.

If you only need to re-send one watch, use the handle:

```cpp
batteryWatch.resyncRoster();
```

## Practical Examples

### Battery voltage

```cpp
logger.watch("Battery Voltage", LogLevel::INFO, WatchMode::onInterval, 1_mvS,
  []() { return pros::battery::get_voltage(); });
```

### Temperature with alerting

```cpp
logger.watch("Avg Temp", LogLevel::INFO, WatchMode::onInterval, 5_mvS,
  [&]() {
    return (left_mg.get_temperature() + right_mg.get_temperature()) / 2.0;
  },
  mvlib::LevelOverride<double>{
    .elevatedLevel = LogLevel::WARN,
    .predicate = mvlib::asPredicate<double>([](const double& v) {
      return v > 50.0;
    }),
    .label = "Avg Temp High"
  });
```

### Boolean state

```cpp
logger.watch("Clamp Closed", LogLevel::INFO, WatchMode::onChange, 100_mvMs,
  [&]() { return clampClosed; });
```

### Text state

```cpp
logger.watch("Mode", LogLevel::INFO, WatchMode::onChange, 250_mvMs,
  [&]() { return currentModeName; });
```

## Common Mistakes

- Registering the same watch repeatedly inside a loop.
- Using the wrong `LevelOverride<T>` type.
- Assuming `LevelOverride` is required when you do not need alerting behavior.
- Using `PREDICATE(...)` for non-`int32_t` watch types.
- Expecting watch calls to accept a printf-style format specifier.
- Forgetting that `WatchMode::onChange` uses `intervalMs` as a debounce window.
- Using labels longer than 23 visible characters when exact live MotionView display names matter.
