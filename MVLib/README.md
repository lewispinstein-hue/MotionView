# MVLib: Telemetry + Logging For MotionView

<p align="center">
  <img src="./../assets/Logo.png" alt="MotionView Logo" width="180" />
</p>

# What is this?
`MVLib` is a simple logging and telemetry library for PROS V5 teams that want **clear, replayable data** in MotionView. It gives you structured logs, live “watches,” and pose data so MotionView can draw your robot path, list watches, and show details when you hover or click the field.

Odometry and a tank-style drivetrain are not required. With a single line of setup, MVLib immediately replaces scattered `printf`s with structured logs and live watches that appear in an organized dashboard.

## What Can MVLib Do?
- **See your robot path** in MotionView, on a real field, with real numbers.
- **Track important values** like battery, motor temps, flywheel RPM, or auton events.
- **Debug faster** with consistent, viewable logs instead of scattered `printf`s.
- **Share runs** with your team and compare improvements.
- **Develop autonomous** with live viewing, event watching, and playback.
- **Iterate quickly**: log runs effortlessly, spot issues or change routes, and make changes faster.

## Cool! Now How do I Install it?
1. Download the latest .zip from [GitHub](https://github.com/lewispinstein-hue/MotionView/tree/main/MVLib) named `libmvlib@<version>.zip`.
2. Move the download zip file into the root of your PROS project.
3. Open a PROS terminal and run `pros c fetch libmvlib@<version>.zip`
4. Then, run `pros c apply libmvlib@<version>`
5. Add the `mvlib` headers to your project, and finally run `pros make all` to finish.

## Documentation
Find the GitHub Pages [here](https://lewispinstein-hue.github.io/MotionView/)

## Quick Setup (PROS V5)

1. Install MVlib .zip into your PROS project.
2. Include the api header:

```cpp
#define MVLIB_USE_SIMPLES // Optional; for more concise code
#include "mvlib/api.hpp"
```

3. Add **one** odom adapter header if you want pose tracking:

```cpp
#include "mvlib/Optional/lemlib.hpp"
// or
#include "mvlib/Optional/ezTemplate.hpp"
// or
#include "mvlib/Optional/okapi.hpp"
// or
#include "mvlib/Optional/customOdom.hpp"
```

4. Start the logger in `initialize()`:

```cpp
// -------- Example: Bare Bones setup (no watches) -------- //
#include "main.h"
#include "mvlib/api.hpp"
#include "mvlib/Optional/lemlib.hpp" // Example: Using LemLib odom
extern lemlib::Chassis chassis; // Your chassis
void initialize() {
  auto& logger = mvlib::Logger::getInstance();
  logger.setBuildDate(__DATE__);

  // Attach your odom 
  mvlib::setOdom(&chassis);
  // Needed for accurate speed telemetry
  logger.setRobot({
    .leftDrivetrain = &left_mg,
    .rightDrivetrain = &right_mg
  });

  logger.start();
}
```

That’s it. Once the robot runs, MotionView can read your logs and show the path and watches.

## Watches

Watches let you sample values over time and send them to MotionView as structured watch entries.

Teams usually use them for:

- battery voltage
- drivetrain temperature
- flywheel RPM
- intake current
- constant monitoring

Every watch returns a `WatchHandle`.
`LevelOverride` is optional, and on `WatchMode::onChange` watches `intervalMs` is the debounce interval.

Example:

```cpp
auto& logger = mvlib::Logger::getInstance();

logger.watch("Flywheel RPM", LogLevel::INFO, WatchMode::onInterval, 1_mvS,
  [&]() { return flywheel.get_actual_velocity(); });

logger.watch("Auton Stage", LogLevel::INFO, WatchMode::onChange, 250_mvMs,
  [&]() { return autonStage; });
```

That means:

- `WatchMode::onInterval` watches emit on their normal interval
- `WatchMode::onChange` watches emit only after the rendered value changes and the debounce interval has elapsed
- floating-point watch values are rendered with two decimal places
- you only need `LevelOverride` when you want elevated severity and/or an alternate label

MotionView shows these in the watch list and can associate nearby watch values with points in the run.

For the detailed watch guide, including `WatchMode`, optional `LevelOverride`, on-change debounce, `PREDICATE`, and more examples, see the [`Watches Guide`](https://lewispinstein-hue.github.io/MotionView/MVLib/Watches).

## Logs

MVLib also has MotionView-formatted event logs:

- `logger.debug(...)`
- `logger.info(...)`
- `logger.warn(...)`
- `logger.error(...)`
- `logger.fatal(...)`

Best used for discrete events, not continuously changing values.

```cpp
logger.debug("Started auton route: %s", autonRoute.c_str());
logger.info("Started autonomous %d", selectedAuton);
logger.warn("Intake current high: %d", intake.get_current_draw());
logger.error("Failed to detect ring at expected point");
```

These show up in MotionView as normal run events with a severity level and timestamp. For the full reference, see the [Logs Guide](../Docs/MVLib/Logs.md).

## Waypoints

Waypoints are named target poses you register with `logger.addWaypoint(...)`. They let MotionView tell you when the robot reached a location, timed out before getting there, or stayed offset from it.

They are especially useful in autonomous debugging because they answer questions like:

- did the robot ever reach the target?
- was it close enough in position?
- was it facing the right direction?
- did it take too long?

Example:

```cpp
auto& logger = mvlib::Logger::getInstance();
mvlib::setOdom(...);
logger.setRobot({ ... });

auto goalPickup = logger.addWaypoint("Goal Pickup", {
  .tarX = 48,          // Target 48 X
  .tarY = -24,         // Target -24 Y
  .tarT = 90,          // Target 90 degrees heading
  .linearTol = 2.0f,   // +/- 2 from target before "reached"
  .thetaTol = 10.0f,   // +/- 10 degrees before "reached"
  .timeoutMs = 10_mvS, // Timeout if not reached within 10 seconds
});

auto off = goalPickup.getOffset();
logger.info("Distance to target: %.2f\n", off.totalOffset);
```

This waypoint:

- targets a specific field position
- also requires the robot to face the right direction
- times out after 10 seconds if it is not reached
- can be queried at runtime with `getOffset()`, `reached()`, and `timedOut()`

Practical use cases:

- checking whether a route segment reached a scoring spot
- verifying wall-stake or goal approach alignment
- proving that an auton miss came from lateness rather than just bad accuracy

For the full waypoint guide, including `WaypointParams`, `WaypointHandle`, `WaypointOffset`, and more examples, see the [Waypoint Guide](../Docs/MVLib/Waypoints.md). Note that a pose getter needs to be set for waypoints to work.

## What You Need

- **PROS V5** project
- Optional: an **SD card** for saving logs
- Optional: **odom library** (LemLib / EZ‑Template / Okapi / custom) if you want path tracking

## Incompatible With

- **Non‑PROS projects** (VEXcode, Vexide, etc.)
- **Non‑V5 targets**

## Notes
Even without odometry, MVLib can be a replacement for `printf` debugging. Use watches and logs to organize and structure your debugging.
With odometry, MVLib (and MotionView) are much more powerful.
If you have a drivetrain that can't be represented with 2 MotorGroups, you can leave the robot unset and MVLib will estimate your robot's speed using its pose.
