# MVLib Watches

Watches sample values from your robot so you can see how they change during a run. In MotionView, open the **Watches** tab to see the latest value, pin it, or graph and compare numeric watches. [Viewing Mode](../MotionView/ViewingMode/ViewingMode.md?id=watches)

- Use an **interval watch** for flywheel RPM, battery voltage, or motor temperature. It reports at a regular cadence even when the value holds steady, which gives you a consistent graph.
- Use an **on-change watch** for clamp state or autonomous stage. It reports an initial value and then reports changes, keeping a steady state from filling the recording with repeats.

Use a log at the point where your code makes a decision or issues a command. For example, log the clamp command and watch the clamp sensor to see whether it closed. [Logs](./Logs.md)

## API reference

### `watch(...)`

```cpp
template<class Getter, size_t len>
WatchHandle watch(const char (&label)[len], LogLevel baseLevel, WatchMode type,
                  uint32_t intervalMs, Getter&& getter,
                  LevelOverride<std::decay_t<std::invoke_result_t<Getter&>>> ov = {});
```

| Argument | What to pass |
| --- | --- |
| `label` | A fixed string literal. Use at most 23 characters for live display. |
| `baseLevel` | The severity of ordinary samples, such as `LogLevel::INFO`. The logger's minimum level filters watch samples. |
| `type` | `WatchMode::onInterval` or `WatchMode::onChange`. |
| `intervalMs` | Sample interval in milliseconds for `onInterval`. Minimum time between reports for `onChange`. |
| `getter` | A callable that returns the current value. Use a number for a graph, or a boolean or string for state. |
| `ov` | Optional `LevelOverride<T>` for samples that meet a condition. |

- Register each watch once. Repeating the call creates another watch.
- Keep getters quick. Captured references must outlive the watch. Use synchronized access for state shared with the logger task.

### How sampling and debounce work

An interval watch reads its getter when a sample is due. The first eligible update can report immediately. After that, the interval is the minimum time between samples. A current spike that starts and ends between reads can be missed, so choose an interval that matches the duration of the behavior you are measuring.

An on-change watch keeps checking the getter during the debounce window. It reports when the current value differs from the last scheduled report and enough time has elapsed since that report. The new value only needs to be present when the window ends.

For example, suppose a clamp watch first reports **open** and has a 100 ms debounce. If the clamp closes 40 ms later and stays closed, the watch can report **closed** on the first eligible update at or after 100 ms. If the clamp opens again before then, the watch can stay quiet the whole time. Setting the debounce to `0` makes a change eligible on the next update. If you need a record of every transition, log it where your code detects it.

## `LevelOverride`

Use a level override when the same watch serves two purposes, such as graphing intake current and making high readings easy to spot. Pass a `LevelOverride<T>` after the getter. MVLib tests its `predicate` on the sampled value. A true result applies `elevatedLevel` and, if supplied, the alternate `label`. A false result uses the watch's base level and original name again. The default elevated level is `WARN`. Leave the alternate label empty to keep the same name for all readings.

### Decide what to record

Consider a watch with base level `INFO` and a `WARN` override when current exceeds 2000 mA. At the default logger minimum of `INFO`, you get the normal readings, the warnings, and the readings after current returns to normal. A minimum of `WARN` keeps only the warnings. If you want to hide this watch's normal readings while keeping other `INFO` logs, set this watch's base level to `DEBUG` and leave the logger minimum at `INFO`. The same settings apply to both live and SD output. MVLib still reads the watch on its usual schedule so it can check for a warning. [Minimum log level](./Configuration.md?id=minimum-log-level)

The override changes the severity of a sample the watch is due to report. After the initial reading, an on-change warning still needs a change in the watched value. Choose the mode based on what you need from the warning.

- **Report while the condition holds.** Use an interval watch on the measurement. An elevated reading can appear on each interval while it stays above the threshold. You also get the actual measurement in the watch.
- **Report when the condition starts or clears.** Use an on-change watch whose getter returns the condition as a boolean. It can warn on the transition to `true` and report recovery at the base level when it sees `false`. A transition still has to be sampled and pass the debounce. A steady `true` produces no new warnings.
- **Record an alert that affects robot behavior.** Make the decision in your mechanism code and log it there. A watch override changes the recorded severity and name. The mechanism code is responsible for any response.

### Match the predicate to the getter

- Use the getter's value type for `T`. A current getter returning `int32_t` takes `LevelOverride<int32_t>`. A temperature getter returning `double` takes `LevelOverride<double>`.
- Use `PREDICATE(v > 2000)` with an `int32_t` getter. The macro gives you an `int32_t` named `v`.
- For other types, use `mvlib::asPredicate<T>(...)` with a lambda that returns `bool`, or assign a matching lambda directly to `.predicate`. Keep an alternate name within the same 23-character live display limit as the main name.

See the current, temperature, and boolean examples below. [Threshold examples](#flag-readings-above-a-threshold)

## `WatchHandle`

`watch(...)` returns a `mvlib::WatchHandle`. Save it when you need to read, pause, or reconfigure that watch later. The watch keeps running even if you discard the handle.

| Method | Behavior |
| --- | --- |
| `bool valid() const` | Returns whether the watch was registered successfully. A valid handle can still refer to an inactive watch. |
| `bool active() const` | Returns whether this individual watch is enabled for automatic sampling. |
| `void setActive(bool active)` | Pass `false` to stop automatic sampling for this watch. Pass `true` to let automatic sampling resume. |
| `uint32_t intervalMs() const` | Returns the current interval or debounce in milliseconds, according to the watch mode. |
| `void setIntervalMs(uint32_t intervalMs)` | Changes the interval or debounce for future automatic samples. Pass `0` to remove the waiting interval. |
| `WatchMode type() const` | Returns the current watch mode. |
| `void setType(WatchMode type)` | Switches modes on the existing watch. The current timing value is reused as an interval or debounce in the new mode. |
| `std::string evaluate(bool emit = false)` | Reads the getter now and returns the value as a string. Pass `true` to also request one report. Returns an empty string if evaluation fails. |
| `bool resyncRoster() const` | Re-sends the watch's name and any alternate name to MotionView. Returns `true` if MVLib could request the resend. Returns `false` for an invalid or inactive watch or when live output is unavailable. |

### Resume a watch or change its cadence

Toggling `setActive(...)` preserves the getter, settings, and the last value used for change detection. For example, an on-change watch that reported **closed** before you paused it can stay quiet when you re-enable it with the clamp still closed. The logger-wide watch switch still applies. An active handle tells you the watch is enabled individually, even when `setPrintWatches(false)` stops all automatic watch sampling.

If you switch a 500 ms interval watch to `onChange` with `setType(...)`, its timing becomes a 500 ms debounce. Call `setIntervalMs(...)` too if the new mode needs a different timing. Use the same handle so you keep a single watch in MotionView.

For a timed drill, call `setActive(false)` from your drill code when the drill ends. The watch timing argument controls how often it reports while active.

### Read or send a sample on demand

Use `evaluate()` to read the watch from your code without sending a sample. Use `evaluate(true)` to request a report now, even if the watch is inactive, the global automatic watch switch is off, or the interval or debounce is still running. The severity override and output settings still apply. The return value is the reading, so a non-empty result can also come from a sample filtered out of both destinations. A manual reading leaves the normal reporting schedule in place.

### Restore missing names

Use `resyncRoster()` for one active watch or `logger.resyncAllWatchesRoster()` for all registered watches. This re-sends the names so MotionView can label samples. To see a new reading from an unchanged on-change watch after connecting late, wait for a change or use `evaluate(true)`.

## Examples

These examples use `MVLIB_USE_SIMPLES` for the shorter names and time literals. [MVLib Setup](./Setup.md?id=choose-how-to-write-types-and-times)

### Compare target and actual flywheel speed

Register both watches during setup. Here `targetRpm` is a shared `std::atomic<int>` updated by your flywheel controller.

```cpp
logger.watch("Flywheel RPM", LogLevel::INFO, WatchMode::onInterval, 200_mvMs,
  []() { return flywheel.get_actual_velocity(); });

logger.watch("Flywheel Target RPM", LogLevel::INFO, WatchMode::onInterval, 200_mvMs,
  []() { return targetRpm.load(); });
```

Open the graph for **Flywheel RPM** and select **Flywheel Target RPM** for comparison. Take a shot and see how long the actual speed takes to recover. Shorten the interval to see faster dips, or lengthen it to reduce live traffic.

### Track clamp state

Here `clampClosed` is a shared `std::atomic<bool>` updated by your mechanism code.

```cpp
logger.watch("Clamp Closed", LogLevel::INFO, WatchMode::onChange, 100_mvMs,
  []() { return clampClosed.load(); });
```

Pin **Clamp Closed** to keep its current state in view. The 100 ms debounce limits how often the watch reports if the state flips quickly.

### Flag readings above a threshold

This watch reports intake current in milliamps. Above 2000 mA it switches from `INFO` to `WARN` and displays **Intake Current High**.

```cpp
logger.watch("Intake Current", LogLevel::INFO, WatchMode::onInterval, 750_mvMs,
  []() { return intake.get_current_draw(); },
  mvlib::LevelOverride<int32_t>{
    .elevatedLevel = LogLevel::WARN,
    .predicate = PREDICATE(v > 2000),
    .label = "Intake Current High"
  });
```

At 2000 mA the comparison is false, so the sample is still `INFO`. At 2001 mA it is `WARN`. If the current stays high, the watch keeps reporting warnings on its interval. A short spike between readings can still be missed.

For motor temperature, the getter returns `double`. This watch uses the default `WARN` level at 50 °C or above and keeps the same label.

```cpp
logger.watch("Intake Temp", LogLevel::INFO, WatchMode::onInterval, 1_mvS,
  []() { return intake.get_temperature(); },
  mvlib::LevelOverride<double>{
    .predicate = mvlib::asPredicate<double>([](double temp) { return temp >= 50.0; })
  });
```

If you only want to see when the motor becomes hot or cools down again, watch the condition as a boolean. The getter returns `bool`, so the override uses `LevelOverride<bool>` with a matching lambda.

```cpp
logger.watch("Intake Hot", LogLevel::INFO, WatchMode::onChange, 250_mvMs,
  []() { return intake.get_temperature() >= 50.0; },
  mvlib::LevelOverride<bool>{
    .predicate = [](bool hot) { return hot; }
  });
```

This watch can report the initial state and then each observed change that passes debounce. A return to `false` is an `INFO` sample. Keep the logger minimum at `INFO` to see it. Use the temperature watch above if you need to graph the actual temperature.

### Save a handle for a one-off reading

Keep the handle when you register the watch during setup. For example, suspend regular battery readings during a test and emit one at a specific checkpoint.

```cpp
auto batteryWatch = logger.watch("Battery Voltage (V)", LogLevel::INFO,
  WatchMode::onInterval, 1_mvS,
  []() { return pros::battery::get_voltage() / 1000.0; });

// When regular readings are no longer needed for this test.
batteryWatch.setActive(false);

// At the checkpoint.
batteryWatch.evaluate(true);
```

Use `batteryWatch.evaluate()` instead if you only need the value in robot code, or call `setActive(true)` later to resume periodic readings.

## Troubleshooting

**The watch is missing.** Check that the logger started, watch output is enabled, and the watch is active. For live viewing, also check terminal output and the viewer's filters.

**The watch appears only at high readings, or I never see recovery.** Check the base level and the logger's minimum level. A `WARN` minimum filters out an `INFO` recovery reading. Lowering the minimum affects future reports, so ask for a fresh sample if an on-change watch is now steady.

**An on-change watch is quiet.** A steady value produces no new reports. Use interval mode for a continuous graph or reduce the debounce if you are missing short changes.

**MotionView is missing a watch name.** Use a name of 23 characters or fewer. If you connected after the program started, use `resyncRoster()` or wait for the next roster sync.
