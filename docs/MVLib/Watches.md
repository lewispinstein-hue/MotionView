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

MVLib provides 2 watch styles:

- interval-based watches
- on-change watches

```cpp
template <class Getter, class U>
WatchId watch(std::string label, LogLevel baseLevel, uint32_t intervalMs,
              Getter&& getter, LevelOverride<U> ov = {}, std::string fmt = {});

template <class Getter, class U>
WatchId watch(std::string label, LogLevel baseLevel, bool onChange,
              Getter&& getter, LevelOverride<U> ov, std::string fmt = {});
```

The core parameters are:

- `label`: watch name shown in MotionView
- `baseLevel`: normal severity
- `getter`: callable returning the current value
- `ov`: optional `LevelOverride`
- `fmt`: optional numeric formatting string

The 3rd argument decides the mode:

- `intervalMs` means sample every N ms
- `true` means print only when the rendered value changes

## Interval-Based Watches

Use this for continuously changing values:

```cpp
logger.watch("Flywheel RPM", mvlib::LogLevel::INFO, 1_mvS,
  [&]() { return flywheel.get_actual_velocity(); },
  mvlib::LevelOverride<double>{},
  "%.1f");
```

Good fits:

- RPM
- temperature
- current draw
- analog sensor values

## On-Change Watches

Use this for event-like values:

```cpp
logger.watch("Auton Stage", mvlib::LogLevel::INFO, true,
  [&]() { return static_cast<int>(autonStage); },
  mvlib::LevelOverride<int>{});
```

Good fits:

- booleans
- mode/state enums converted to integers or strings
- values that only matter when they change

Important:

- on-change watches compare the rendered output string
- if the rendered string does not change, MVLib does not emit another sample

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
logger.watch("Intake Current", mvlib::LogLevel::INFO, 750_mvMs,
  [&]() { return intake.get_current_draw(); },
  mvlib::LevelOverride<int32_t>{
    .elevatedLevel = mvlib::LogLevel::WARN,
    .predicate = PREDICATE(v > 2000),
    .label = "Intake Current High"
  });
```

That means:

- normal samples log at `INFO`
- samples above 2000 log at `WARN`
- the elevated sample can use a different label

## Exact Type Matching Matters

`LevelOverride<T>` must match the getter return type after decay.

Examples:

- getter returns `double` -> use `LevelOverride<double>`
- getter returns `int32_t` -> use `LevelOverride<int32_t>`
- getter returns `int` -> use `LevelOverride<int>`
- getter returns `bool` -> use `LevelOverride<bool>`

If the types do not match, the watch overload is designed to fail at compile time.

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

## Formatting With `fmt`

`fmt` is only used for floating-point rendering.

Examples:

- `"%.0f"`
- `"%.1f"`
- `"%.2f"`

Example:

```cpp
logger.watch("Avg Temp", mvlib::LogLevel::INFO, 5_mvS,
  [&]() {
    return (left_mg.get_temperature() + right_mg.get_temperature()) / 2.0;
  },
  mvlib::LevelOverride<double>{},
  "%.0f");
```

Important `v2.0.0` detail:

- floating-point watches use `fmt` if you provide one
- integral watches ignore `fmt` and use `std::to_string(...)`
- `std::string` and `const char*` are sent as text watches

Because on-change watches compare the rendered string, formatting can change when two float values count as "the same".

## What MotionView Receives

When terminal output is enabled:

- numeric watch values are sent as binary numeric watch packets when possible
- non-numeric values are sent as structured text-watch packets

When SD logging is enabled:

- watches are also written as readable `[WATCH],...` lines

## Resync Helpers

If MotionView joins late and a watch name is missing, re-send watch roster metadata with:

```cpp
logger.resyncAllWatchesRoster();
```

This is especially useful in `v2.0.0`, where roster metadata is its own live telemetry channel.

## Practical Examples

### Battery voltage

```cpp
logger.watch("Battery Voltage", mvlib::LogLevel::INFO, 1_mvS,
  []() { return pros::battery::get_voltage(); },
  mvlib::LevelOverride<int32_t>{});
```

### Temperature with alerting

```cpp
logger.watch("Avg Temp", mvlib::LogLevel::INFO, 5_mvS,
  [&]() {
    return (left_mg.get_temperature() + right_mg.get_temperature()) / 2.0;
  },
  mvlib::LevelOverride<double>{
    .elevatedLevel = mvlib::LogLevel::WARN,
    .predicate = mvlib::asPredicate<double>([](const double& v) {
      return v > 50.0;
    }),
    .label = "Avg Temp High"
  },
  "%.0f");
```

### Boolean state

```cpp
logger.watch("Clamp Closed", mvlib::LogLevel::INFO, true,
  [&]() { return clampClosed; },
  mvlib::LevelOverride<bool>{});
```

### Text state

```cpp
logger.watch("Mode", mvlib::LogLevel::INFO, true,
  [&]() { return currentModeName; },
  mvlib::LevelOverride<std::string>{});
```

## Common Mistakes

- Registering the same watch repeatedly inside a loop.
- Using the wrong `LevelOverride<T>` type.
- Using `PREDICATE(...)` for non-`int32_t` watch types.
- Expecting integer watches to honor `fmt`.
- Assuming long labels will always survive intact in live telemetry; MotionView roster names are limited by the telemetry packet format.
