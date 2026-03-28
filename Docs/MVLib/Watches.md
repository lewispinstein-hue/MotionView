# MVLib Watches

Watches are MVLib's way of sampling a value over time and sending it to MotionView in a structured format.

They are useful for values that matter during a run but are not part of robot pose, such as:

- battery voltage
- flywheel RPM
- intake current
- motor temperature
- auton stage
- lift height

In MotionView, watches show up in the watch list, and the viewer can associate nearby watch values with points in the run.

## The Main API: `logger.watch(...)`

MVLib provides two watch styles:

- interval-based watches, which print every N milliseconds
- change-based watches, which print only when the value changes

<details>
  <summary><tiny>View Source Code</tiny></summary>

```cpp
template <class Getter, class U>
WatchId watch(std::string label, LogLevel baseLevel, uint32_t intervalMs,
              Getter&& getter, LevelOverride<U> ov = {}, std::string fmt = {});

template <class Getter, class U>
WatchId watch(std::string label, LogLevel baseLevel, bool onChange,
              Getter&& getter, LevelOverride<U> ov, std::string fmt = {});
```
</details>

Both overloads need the same core pieces:

- `label`: the name MotionView shows
- `baseLevel`: the normal log level
- `getter`: a callable that returns the current value
- `ov`: an optional `LevelOverride`
- `fmt`: an optional format string for numeric output

The difference is the third argument:

- `intervalMs` means "print every N milliseconds"
- `onChange` means "print only when the rendered value changes"

## Interval-Based Watches

Use the interval overload when the value changes constantly and you want a steady sample rate.

```cpp
logger.watch("Flywheel RPM:", mvlib::LogLevel::INFO, 1_mvS,
  [&]() { return flywheel.get_actual_velocity(); },
  mvlib::LevelOverride<double>{}, "%.1f");
```

This is a good fit for:

- RPM
- temperature
- current draw
- sensor values that update continuously

Advice:

- Do not set the interval lower than you actually need.
- Faster watch rates create more output and more work for the logger.

## Change-Based Watches

Use the change overload when the value is event-like and repeated polling would just spam the same meaning over and over.

```cpp
logger.watch("Auton Stage:", mvlib::LogLevel::INFO, true,
  [&]() { return static_cast<int>(autonStage); },
  mvlib::LevelOverride<int>{}, "%d");
```

This is a good fit for:

- auton stages
- mode flags
- booleans
- values that change rarely but matter a lot when they do

Important detail:

- change-based watches compare the rendered output, not the raw variable in isolation. If the final printed value stays the same, MVLib does not print again.

## `LevelOverride`

`LevelOverride` lets a watch temporarily promote itself when a condition becomes true.

<details>
  <summary><tiny>View Source Code</tiny></summary>

```cpp
template<class T> struct LevelOverride {
  LogLevel elevatedLevel = LogLevel::WARN;
  std::function<bool(const T &)> predicate;
  std::string label;
};
```
</details>

Use it when you want a watch to be normal most of the time, but more urgent when a threshold is crossed.

Example:

```cpp
logger.watch("Intake Current:", mvlib::LogLevel::INFO, 1_mvS,
  [&]() { return intake.get_current_draw(); },
  mvlib::LevelOverride<int32_t>{
    .elevatedLevel = mvlib::LogLevel::WARN,
    .predicate = PREDICATE(v > 2000),
    .label = "Intake Current High:"
  }, "%d");
```

What happens here:

- the watch normally logs at `INFO`
- once current exceeds 2000, it logs at `WARN`
- when elevated, it can also use a different label

### Exact type matching matters

The type inside `LevelOverride<T>` must exactly match the getter's return type after decay.

Examples:

- getter returns `int32_t` -> use `LevelOverride<int32_t>`
- getter returns `double` -> use `LevelOverride<double>`
- getter returns `int` -> use `LevelOverride<int>`

If the types do not match, the code will not compile.

## `PREDICATE` and `asPredicate`

`PREDICATE(...)` is the short form for simple integer-based watch predicates.

<details>
  <summary><tiny>View Source Code</tiny></summary>

```cpp
#define PREDICATE(func) \
mvlib::asPredicate<int32_t>([](int32_t v) { return func; })
```
</details>

For example:

```cpp
.predicate = PREDICATE(v > 50)
```

That works well when your getter returns an `int32_t`-compatible value.

If your getter returns another type, use `mvlib::asPredicate<T>(...)` directly:

```cpp
.predicate = mvlib::asPredicate<double>([](const double& v) {
  return v > 550.0;
})
```

Use `PREDICATE` for quick integer conditions. Use `asPredicate<T>` when the getter type is not `int32_t` or when you want to be explicit.

## Formatting With `fmt`

The final `fmt` argument controls how numeric values are rendered.

Examples:

- `"%d"` for integers
- `"%.0f"` for rounded floating-point values
- `"%.1f"` for one decimal place
- `"%.2f"` for two decimal places

Example:

```cpp
logger.watch("Avg Temp:", mvlib::LogLevel::INFO, 5_mvS,
  [&]() { return (left_mg.get_temperature() + right_mg.get_temperature()) / 2; },
  mvlib::LevelOverride<double>{},
  "%.0f");
```

If you use change-based watches, formatting matters even more, because formatting affects whether two values are considered the same rendered output.

## Practical Examples

### Battery

```cpp
logger.watch("Battery Voltage:", mvlib::LogLevel::INFO, true,
  []() { return pros::battery::get_voltage(); },
  mvlib::LevelOverride<int32_t>{},
  "%d");
```

Good for brownout awareness and quick system checks.

### Temperature

```cpp
logger.watch("Avg Temp:", mvlib::LogLevel::INFO, 5_mvS,
  [&]() { return (left_mg.get_temperature() + right_mg.get_temperature()) / 2; },
  mvlib::LevelOverride<double>{
    .elevatedLevel = mvlib::LogLevel::WARN,
    .predicate = mvlib::asPredicate<double>([](const double& v) { return v > 50.0; })
  },
  "%.0f");
```

Good for spotting overheating.

### RPM

```cpp
logger.watch("Flywheel RPM:", mvlib::LogLevel::INFO, 500_mvMs,
  [&]() { return flywheel.get_actual_velocity(); },
  mvlib::LevelOverride<double>{},
  "%.1f");
```

Good for spin-up consistency and shot timing.

### Current draw

```cpp
logger.watch("Intake Current:", mvlib::LogLevel::INFO, 750_mvMs,
  [&]() { return intake.get_current_draw(); },
  mvlib::LevelOverride<int32_t>{
    .elevatedLevel = mvlib::LogLevel::WARN,
    .predicate = PREDICATE(v > 2000),
    .label = "Intake Current High:"
  },
  "%d");
```

Good for jam detection.

## What MotionView Gets

When watches are enabled, MVLib prints structured watch lines for MotionView. That is what powers:

- the watch list
- the severity level shown for a watch
- the value shown near points in the run

If `logger.setPrintWatches(false)` is used, the watches remain registered in code, but MotionView will not receive their output.

## Common Mistakes

- Calling `logger.watch(...)` repeatedly in a loop instead of registering it once.
- Using the wrong `LevelOverride<T>` type.
- Using `PREDICATE(...)` for non-`int32_t` values.
- Setting watch intervals much faster than you actually need.
- Using change-based watches for values that always fluctuate.
