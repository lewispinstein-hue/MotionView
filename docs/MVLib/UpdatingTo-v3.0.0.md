# Updating MVLib to v3.0.0

Full `v3.0.0` references:

- [Watches](./Watches.md)
- [Waypoints](./Waypoints.md)
- [Configuration](./Configuration.md)
- [Setup](./Setup.md)

## Quick Checklist

- replace old `watch(...)` overloads with `WatchMode::onInterval` or `WatchMode::onChange`
- give every `WatchMode::onChange` watch a debounce interval
- if you stored watch return values, change `WatchId` to `WatchHandle`
- move watch format strings before `LevelOverride`
- replace dynamic watch and waypoint labels with fixed string literals
- shorten all watch and waypoint labels to 24 characters max
- rename `setLoggerMinLevel(...)` to `setMinLogLevel(...)`

## Watches

- Interval watches now use `WatchMode::onInterval`:

```cpp
logger.watch("Flywheel RPM", LogLevel::INFO, WatchMode::onInterval, 1_mvS,
  [&]() { return flywheel.get_actual_velocity(); }, "%.1f");
```

- On-change watches now use `WatchMode::onChange` and require a debounce:

```cpp
logger.watch("Auton Stage", LogLevel::INFO, WatchMode::onChange, 250_mvMs,
  [&]() { return static_cast<int>(autonStage); }, "%d");
```

- Use `0_mvMs` for near-immediate on-change behavior. Use `100_mvMs` to
  `250_mvMs` for most booleans, enums, and stage values.

- If you stored the watch return value, change:

```cpp
WatchId batteryWatch = logger.watch(...);
```

to:

```cpp
WatchHandle batteryWatch = logger.watch(...);
```

- `WatchHandle` can now be used for runtime control:

```cpp
batteryWatch.setActive(false);
batteryWatch.setIntervalMs(500_mvMs);
batteryWatch.evaluate(true);
batteryWatch.resyncRoster();
```

Full `WatchHandle` reference:
[Watches.md](./Watches.md#watchhandle)

- If a watch uses both formatting and `LevelOverride`, the order changed:

```cpp
logger.watch("Intake Current", LogLevel::INFO, WatchMode::onInterval, 750_mvMs,
  getter, "%d", LevelOverride<int32_t>{
    .elevatedLevel = LogLevel::WARN
  });
```

- Dynamic watch labels no longer work. Replace this:

```cpp
std::string label = "Flywheel " + sideName + " RPM";
logger.watch(label, LogLevel::INFO, 500_mvMs, getter, {}, "%.0f");
```

with a fixed label:

```cpp
logger.watch("Flywheel RPM", LogLevel::INFO, WatchMode::onInterval,
  500_mvMs, getter, "%.0f");
```

Full watch reference:
[Watches.md](./Watches.md)

## Waypoints

- Dynamic waypoint names no longer work. Replace this:

```cpp
std::string wpName = selectedAutonName + " Goal Pickup";
auto wp = logger.addWaypoint(wpName, params);
```

with a fixed name:

```cpp
auto wp = logger.addWaypoint("Goal Pickup", params);
```

- If you need extra context, log it separately:

```cpp
logger.info("Auton %s created Goal Pickup waypoint", selectedAutonName.c_str());
```

Full waypoint reference:
[Waypoints.md](./Waypoints.md)

## Logger API Renames

- Rename:

```cpp
logger.setLoggerMinLevel(LogLevel::INFO);
```

to:

```cpp
logger.setMinLogLevel(LogLevel::INFO);
```

Full configuration reference:
[Configuration.md](./Configuration.md)

## Before / After

```cpp
// v2.x.x
logger.setLoggerMinLevel(LogLevel::INFO);

logger.watch("Auton Stage:", LogLevel::INFO, true,
  [&]() { return static_cast<int>(autonStage); },
  LevelOverride<int>{}, "%d");

auto goal = logger.addWaypoint("Blue left matchloader", {
  .tarX = 70,
  .tarY = -47,
  .linearTol = 2.0f
});

// v3.0.0
logger.setMinLogLevel(LogLevel::INFO);

WatchHandle stageWatch = logger.watch("Auton Stage", LogLevel::INFO,
  WatchMode::onChange, 250_mvMs,
  [&]() { return static_cast<int>(autonStage); }, "%d");

auto goal = logger.addWaypoint("Blue Left ML", {
  .tarX = 70,
  .tarY = -47,
  .linearTol = 2.0f
});
```
