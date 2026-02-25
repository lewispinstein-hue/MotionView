# MVLib — MotionView Telemetry + Logging

# What is this?
`MVLib` is a simple logging and telemetry library for PROS V5 teams that want **clear, replayable data** in MotionView. It gives you structured logs, live “watches,” and pose data so MotionView can draw your robot path, list watches, and show details when you hover or click the field.

If your team just wants **“why use this”** or **“how do I set it up”**, this README is for you.

## Why Use MVLib

- **See your robot path** in MotionView, on a real field, with real numbers.
- **Track important values** like battery, motor temps, flywheel RPM, or auton events.
- **Debug faster** with consistent, viewable logs instead of scattered `printf`s.
- **Share runs** with your team and compare improvements.
- **Develop autonomous** with live viewing, event watching, and playback.
- **Iterate quickly**: logging runs takes no more than a single button press

## What MotionView Gets From MVLib

MotionView recognizes two kinds of lines that mvlib prints:

- **Pose data** so it can draw your path, speed, and show pose readouts.
- **Watch data** so it can list watches in the sidebar and show the closest watch value when you hover points on the field.

This is exactly what MotionView is built to consume, so MVLib is the easiest way to feed it.

> **Note:** MVLib is not strictly nessicary. Any other logging system, even just a `printf` inside of opcontrol could replicate this functionality. 
> However, MVLib provides easy setup, cross-library support, and seamless integration with MotionView, which is why it's recommended.

## Quick Setup (PROS V5)

1. Copy `include/mvlib/` and `src/mvlib/` into your PROS project.
2. Include the core header:

```cpp
#include "mvlib/core.hpp"
```

3. Add **one** odom adapter header if you want pose tracking:

```cpp
#include "mvlib/Optional/mvlib_optional_lemlib.hpp"
// or
#include "mvlib/Optional/mvlib_optional_ez-template.hpp"
// or
#include "mvlib/Optional/mvlib_optional_okapi.hpp"
// or
#include "mvlib/Optional/mvlib_optional_custom.hpp"
```

4. Start the logger in `initialize()`:

```cpp
// -------- Example: Bare Bones setup (no watches) -------- //
#include "main.h"
#include "mvlib/core.hpp"
#include "mvlib/Optional/mvlib_optional_lemlib.hpp" // Example: Using LemLib odom
void initialize() {
  auto& logger = mvlib::Logger::getInstance();

  // Needed: attach your odom (in this case, LemLib)
  mvlib::setOdom(logger, &chassis);

  // Required for drivetrain speed telemetry
  logger.setRobot({
    .LeftDrivetrain  = mvlib::shared(left_mg),
    .RightDrivetrain = mvlib::shared(right_mg)
  });

  logger.start();
}
```

That’s it. Just 10 lines of code. Once the robot runs, MotionView can read your logs and show the path and watches.

## Real‑World Watch Examples (What Teams Actually Track)

- **Battery voltage** spot brownout risk
- **Drivetrain temperature** find overheating motors
- **Flywheel RPM** see spin‑up consistency
- **Intake current** detect jams
- **Auton stage** know where your routine is when it failed
- **Lift height** see if you reached target

Example watches:

```cpp
auto& logger = mvlib::Logger::getInstance();

// Battery voltage
logger.watch("Battery Percentage:", mvlib::LogLevel::INFO, true, // Instead of logging every 1000ms, we log every time the battery level changes.
  [&]() { return pros::battery::get_voltage(); },
  mvlib::LevelOverride<int32_t>{}, "%d");

// Drivetrain temperature (averaged)
logger.watch("Avg Temp:", mvlib::LogLevel::INFO, 1000_ms, 
    [&]() { return (left_mg.get_temperature() + right_mg.get_temperature()) / 2; }, 
    mvlib::LevelOverride<double>{
    .elevatedLevel = mvlib::LogLevel::WARN,
    .predicate = PREDICATE(v > 50) // Change from a INFO to a WARN when avg temp is over 50.
}, "%0f"); // Print the temperature to 0 decimals.

// Flywheel RPM
logger.watch("Flywheel RPM:", mvlib::LogLevel::INFO, 1000_ms, // For an always changing event like this, prevent spam and log periodically.
  [&]() { return flywheel.get_actual_velocity(); },
  mvlib::LevelOverride<double>{}, "%.1f"); // No level override, and print with 1 decimal

// Intake current (detect jams)
logger.watch("Intake Current:", mvlib::LogLevel::INFO, 1000_ms, 
  [&]() { return intake.get_current_draw(); }, 
    mvlib::LevelOverride<int32_t>{
    .elevatedLevel = mvlib::LogLevel::WARN,
    .predicate = PREDICATE(v > 2000), // We change from INFO to WARN after the intake draws too much current
    .label = "Intake Current High:"   // We also change the label when the current is too high.
}, "%0f")

// Auton stage (prints only when it changes)
logger.watch("Auton Stage:", mvlib::LogLevel::INFO, true, 
  [&]() { return (int)(autonStage); }, 
  mvlib::LevelOverride<int>{}, "%d");
```

MotionView will show these as a **watch list**, and the field hover will show the closest watch value at any point in the run.

## How `.watch()` works: 
`.watch()` samples a value you provide and prints it either **on a timer** or **only when the value changes**. MotionView then shows those entries in the watch list and on the field.

**Overloads and parameters (high level):**
- `watch(label, level, intervalMs, getter, levelOverride, fmt)`
  - `label`: the name MotionView shows
  - `level`: normal severity (INFO/WARN/etc.)
  - `intervalMs`: how often to print
  - `getter`: your function that returns the value
  - `levelOverride` (optional; if unused, pass `{}`): promote the level + change the label when a condition is true
  - `fmt` (optional): number format (e.g., `"%.0f"`)
---
- `watch(label, level, onChange, getter, levelOverride, fmt)`
  - `onChange`: `true` prints only when the value changes (interval ignored)

**How `LevelOverride` works:** it lets a watch temporarily “promote” itself when a condition is true. In the examples above, the watch stays INFO normally, but flips to WARN when the battery drops too low or the intake current spikes. MotionView will show those as more urgent watch entries. <br>
**How to use `PREDICATE`:** By default, `PREDICATE` is limited to the return type of int32_t. This means that if you need to do decimals inside of your PREDICATE, you need to manually access `mvlib::as_predicate`. It works by using variable `v` to compare. `v` is the value of the expression from `getter`. If the expression provided in PREDICATE evaluates to `true`, then LevelOverride is activated and the label and logLevel switch to those from LevelOverride.

> **IMPORTANT NOTE:** When using `.watch()`, the type put into LevelOverride must be the exact return type from the `Getter` function. If the types do not match, your code will NOT compile.

**`LevelOverride` parameters (high level):**
- `elevatedLevel`: the severity to use when the condition is true
- `predicate`: the condition that decides when to elevate (true/false)
- `label`: optional alternate label to show when elevated

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
- If you do have odometry, MotionView becomes much more powerful.
- Keep watches focused on what you actually need to debug.

---
