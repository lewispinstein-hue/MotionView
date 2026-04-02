# MVLib: Telemetry + Logging For MotionView

# What is this?
`MVLib` is a simple logging and telemetry library for PROS V5 teams that want **clear, replayable data** in MotionView. It gives you structured logs, live “watches,” and pose data so MotionView can draw your robot path, list watches, and show details when you hover or click the field.

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
Detailed Guides:

- [`Setup.md`](../Guides/MVLib/Setup.md): installation, logger startup, odometry and drivetrain setup.
- [`Configuration.md`](../Guides/MVLib/Configuration.md): user-configurable settings in `include/mvlib/config.hpp` and `LoggerConfig`.
- [`Watches.md`](../Guides/MVLib/Watches.md): the `logger.watch(...)` overloads, `LevelOverride`, `PREDICATE`, formatting, and examples.
- [`Waypoint.md`](../Guides/MVLib/Waypoint.md): `logger.addWaypoint(...)`, waypoint structs, waypoint handles, and waypoint usage patterns.
- [`StandardLog.md`](../Guides/MVLib/StandardLog.md): the MotionView-formatted `debug`, `info`, `warn`, `error`, and `fatal` log functions.

## What MotionView Gets From MVLib

MotionView recognizes two kinds of lines that mvlib prints:

- **Pose data** so it can draw your path, speed, and show pose readouts.
- **Watch data** so it can list watches in the sidebar and show the closest watch value when you hover points on the field.

This is exactly what MotionView is built to consume, so MVLib is the easiest way to feed it.

> **Note:** MVLib is not strictly necessary. However, MVLib provides easy setup, cross-library support, seamless integration with MotionView, and tons of features, which is why it's recommended.

## Quick Setup (PROS V5)

1. Install MVlib .zip into your PROS project.
2. Include the api header:

```cpp
#define USING_MVLIB_SIMPLES // Optional; for more concise code
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

That’s it. Just 10 lines of code. Once the robot runs, MotionView can read your logs and show the path and watches.

## Watches

Watches let you sample values over time and send them to MotionView as structured watch entries.

Teams usually use them for:

- battery voltage
- drivetrain temperature
- flywheel RPM
- intake current
- constant monitoring

Example:

```cpp
auto& logger = mvlib::Logger::getInstance();

logger.watch("Flywheel RPM:", mvlib::LogLevel::INFO, 1_mvS,
  [&]() { return flywheel.get_actual_velocity(); },
  mvlib::LevelOverride<double>{}, "%.1f");

logger.watch("Auton Stage:", mvlib::LogLevel::INFO, true,
  [&]() { return (int)autonStage; },
  mvlib::LevelOverride<int>{}, "%d");
```

MotionView shows these in the watch list and can associate nearby watch values with points in the run.

For the detailed watch guide, including overloads, `LevelOverride`, `PREDICATE`, formatting, and more examples, see [`Watches.md`](../Guides/MVLib/Watches.md).

## Standard Logs

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

These show up in MotionView as normal run events with a severity level and timestamp. For the full reference, see the [StandardLog Guide](../Guides/MVLib/StandardLog.md).

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
  .tarX = 48,         // Target 48 X
  .tarY = -24,        // Target -24 Y
  .tarT = 90,         // Target 90 degrees heading
  .linearTol = 2.0f,  // +/- 2 from target before "reached"
  .thetaTol = 10.0f,  // +/- 10 degrees before "reached"
  .timeoutMs = 3_mvS, // Timeout after 3 seconds of not reaching
  .printOffsetEveryMs = 0.5x_mvS // Log offset every 0.5 seconds (optional)
});

auto off = goalPickup.getOffset();
printf("Distance to target: %.2f\n", off.totalOffset);
```

This waypoint:

- targets a specific field position
- also requires the robot to face the right direction
- times out after 3 seconds if it is not reached
- prints periodic offset updates while active

Practical use cases:

- checking whether a route segment reached a scoring spot
- verifying wall-stake or goal approach alignment
- proving that an auton miss came from lateness rather than just bad accuracy

For the full waypoint guide, including `WaypointParams`, `WaypointHandle`, `WaypointOffset`, and more examples, see the [Waypoint Guide](../Guides/MVLib/Waypoint.md). Note that a pose getter needs to be set for waypoints to work.

## What You Need

- **PROS V5** project
- **C++** (mvlib uses standard C++ features)
- Optional: an **SD card** for saving logs
- Optional: **odom library** (LemLib / EZ‑Template / Okapi / custom) if you want path tracking

## Incompatible With

- **Non‑PROS projects** (VEXcode, RobotMesh, etc.)
- **Non‑V5 targets**
- Including **more than one** optional odom adapter header at the same time

## Notes for Teams

- If you don’t have odometry, you can still use watches and logs.
- With odometry, MVLib (and MotionView) become much more powerful.
- If you have a drivetrain that can't be represented with 2 MotorGroups, you can leave the robot unset and MVLib will estimate your robot's speed using its pose.

---



function updateTopBarStatusLayout() {
  if (!topBarEl || !topBarContentEl || !topBarLeftEl || !topBarCenterEl || !topBarRightEl || !statusEl) return;

  const fullText = statusEl.dataset.fullText ?? statusEl.textContent ?? "";
  statusEl.style.maxWidth = "";
  statusEl.textContent = fullText;

  // Measure against a stable baseline: force the overflow-capable layout so
  // the content width reflects its natural size, independent of the current
  // `isOverflowing` class state.
  topBarEl.classList.add("isOverflowing");
  const requiredWidth = Math.ceil(topBarContentEl.scrollWidth);
  const availableWidth = Math.ceil(topBarEl.clientWidth);
  const isOverflowing = requiredWidth > (availableWidth - TOP_BAR_OVERFLOW_TOLERANCE_PX);

  topBarEl.classList.toggle("isOverflowing", isOverflowing);

  if (isOverflowing) {
    statusEl.textContent = truncateTopBarStatus(fullText);
    statusEl.title = fullText;
  } else {
    const centerRect = topBarCenterEl.getBoundingClientRect();
    const statusRect = statusEl.getBoundingClientRect();
    const available = Math.floor(centerRect.left - statusRect.left - 24);
    if (available > 0) statusEl.style.maxWidth = `${available}px`;
    statusEl.title = statusEl.scrollWidth > statusEl.clientWidth ? fullText : "";
  }
}
