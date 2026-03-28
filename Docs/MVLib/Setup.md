# MVLib Setup

This guide explains how to set up MVLib in a PROS V5 project, what each setup step actually enables, and which parts are optional.

At a high level, setup is: install MVLib, include `mvlib/api.hpp`, optionally attach odometry and drivetrain motor groups, then call `logger.start()` once.

MVLib works best in PROS V5 C++ projects. It is not intended for non-PROS projects, non-V5 targets, or projects that mix multiple MVLib odometry adapters at the same time.

## 1. Install MVLib

The standard install flow is:

1. Download the MVLib zip release, named something like `libmvlib@1.3.0.zip`.
2. Move that zip into the root of your PROS project.
3. Run:

```bash
pros c fetch libmvlib@1.3.0.zip
pros c apply libmvlib@1.3.0
pros make all
```

`pros c fetch` imports the package into the project, `pros c apply` adds the library files, and `pros make all` builds the project with the new files.

## 2. Include the Main Header

For most teams, the only header you need to include directly is:

```cpp
#include "mvlib/api.hpp"
```

`mvlib/api.hpp` is the convenience header. It pulls in the logger, log macros, config values, checkpoints, and MVLib time literals.

**Optional shorthand:** If you want shorter code, define `MVLIB_USE_SIMPLES` before the include:

```cpp
#define MVLIB_USE_SIMPLES
#include "mvlib/api.hpp"
```

That lets you write `LogLevel::INFO` instead of `mvlib::LogLevel::INFO`, and `1_mvS` / `100_mvMs` as readable time values.

## 3. Decide Whether You Want Odometry

Odometry is optional.

If you skip odometry, MVLib still gives you:

- Standard logs
- MotionView-formatted logs
- Watches
- Drivetrain velocity telemetry

If you do attach odometry (highly recommended), MotionView can also draw the robot path, show pose over time, and sync logs, watches, and checkpoints to your robot.

## 4. Attach Odometry
**Rule: include only one adapter**

Use exactly one of these headers:

- `mvlib/Optional/lemlib.hpp`
- `mvlib/Optional/ezTemplate.hpp`
- `mvlib/Optional/okapi.hpp`
- `mvlib/Optional/customOdom.hpp`

Do not include more than one. MVLib throws a compile-time error if you mix adapters.

### LemLib

```cpp
#include "main.h"
#include "mvlib/api.hpp"
#include "mvlib/Optional/lemlib.hpp"

extern lemlib::Chassis chassis;
```

Then in `initialize()`:

```cpp
auto& logger = mvlib::Logger::getInstance();
mvlib::setOdom(&chassis);
```

This reads pose from `chassis.getPose()` and forwards it to MVLib.

### EZ-Template

```cpp
#include "main.h"
#include "mvlib/api.hpp"
#include "mvlib/Optional/ezTemplate.hpp"

extern ez::Drive chassis;
```

Then:

```cpp
auto& logger = mvlib::Logger::getInstance();
mvlib::setOdom(&chassis);
```

This reads pose from the EZ-Template drive and returns no pose if odometry is disabled or the pointer is invalid.

### Okapi

```cpp
#include "main.h"
#include "mvlib/api.hpp"
#include "mvlib/Optional/okapi.hpp"

extern std::shared_ptr<okapi::OdomChassisController> odomChassis;
```

Then:

```cpp
auto& logger = mvlib::Logger::getInstance();
mvlib::setOdom(odomChassis.get());
```

This reads pose from Okapi and converts it to inches and degrees before passing it into MVLib.

### Custom odometry

```cpp
#include "main.h"
#include "mvlib/api.hpp"
#include "mvlib/Optional/customOdom.hpp"

void initialize() {
  auto& logger = mvlib::Logger::getInstance();

  mvlib::setOdom([&]() -> std::optional<mvlib::Pose> {
    if (!odomReady()) return std::nullopt;

    return mvlib::Pose{
      tracking.getX(),
      tracking.getY(),
      tracking.getHeading()
    };
  });
}
```

This is the most flexible option. MVLib simply calls your function when it needs a pose. If your odometry is not ready yet, return `std::nullopt`.

### Which option should you use?

Use the adapter that matches the odometry stack you already have. Use `customOdom.hpp` if none of the built-in adapters fit, and skip odometry entirely if you only want watches and logs.

## 5. Optionally Register the Drivetrain

If you have left and right drivetrain motor groups, register them:

```cpp
logger.setRobot({
  .leftDrivetrain = &left_motors,
  .rightDrivetrain = &right_motors
});
```

This gives MVLib direct drivetrain velocity data, which is usually more accurate than estimating speed from pose alone. Use it if your drivetrain is clearly split into left and right motor groups and you want better speed telemetry. Skip it if your drivetrain does not fit that model, or if you would rather let MVLib estimate speed from pose. If you are unsure whether the mapping is correct, it is better to leave this unset than to pass the wrong motors.

## 6. Start the Logger

Once setup is done, start the logger once:

```cpp
logger.start();
```

`start()` launches MVLib's background task. That task handles telemetry output, watch polling, MotionView-formatted logging, SD logging when enabled, and checkpoint reporting.

Configure odometry, drivetrain references, watches, and checkpoints before calling `start()`.

## 7. Recommended Setup Examples

If your robot has odometry and left/right drivetrain motor groups, this is a practical baseline:

```cpp
#include "main.h"
#define MVLIB_USE_SIMPLES
#include "mvlib/api.hpp"
#include "mvlib/Optional/lemlib.hpp"

extern lemlib::Chassis chassis;
extern pros::MotorGroup left_motors;
extern pros::MotorGroup right_motors;

void initialize() {
  auto& logger = mvlib::Logger::getInstance();

  mvlib::setOdom(&chassis);

  logger.setRobot({
    .leftDrivetrain = &left_motors,
    .rightDrivetrain = &right_motors
  });

  logger.start();
}
```

That setup gives you robot path rendering in MotionView, telemetry output, drivetrain speed data, and a base you can extend with watches and checkpoints.

If your robot does not have odometry yet, a smaller setup still works:

```cpp
#include "main.h"
#include "mvlib/api.hpp"

extern pros::MotorGroup left_motors;
extern pros::MotorGroup right_motors;

void initialize() {
  auto& logger = mvlib::Logger::getInstance();

  logger.setRobot({
    .leftDrivetrain = &left_motors,
    .rightDrivetrain = &right_motors
  });

  logger.start();
}
```

That version will not produce a robot path, but you still get logs, watches, checkpoints, and drivetrain-based telemetry.

## 8. Add a First Watch

MVLib becomes much more useful once you register a few watches.

```cpp
auto& logger = mvlib::Logger::getInstance();

logger.watch("Battery Voltage:", mvlib::LogLevel::INFO, 1_mvS,
  []() { return pros::battery::get_voltage(); },
  mvlib::LevelOverride<int32_t>{}, "%d");
```

This samples the battery once per second and sends the value to MotionView's watch list. If the value is event-like rather than continuously changing, use the `onChange` overload instead:

```cpp
logger.watch("Auton Stage:", mvlib::LogLevel::INFO, true,
  []() { return static_cast<int>(autonStage); },
  mvlib::LevelOverride<int>{},
  "%d");
```

That version only prints when the value changes. One important rule: the type in `mvlib::LevelOverride<T>` must match the watch getter's return type exactly. If the getter returns `double`, the override type must be `mvlib::LevelOverride<double>`.

## 9. Runtime Controls and Timing

MVLib exposes a few runtime toggles:

```cpp
logger.setLogToTerminal(true);
logger.setLogToSD(true);
logger.setPrintTelemetry(true);
logger.setPrintWatches(true);
logger.setPrintCheckpoints(true);
logger.setLoggerMinLevel(mvlib::LogLevel::INFO);
```

- `setLogToTerminal(bool)` enables or disables terminal output
- `setLogToSD(bool)` enables or disables SD logging
- `setPrintTelemetry(bool)` enables or disables telemetry output
- `setPrintWatches(bool)` enables or disables watch output
- `setPrintCheckpoints(bool)` enables or disables checkpoint output
- `setLoggerMinLevel(...)` filters out messages below a chosen severity
These are mainly useful when you want to narrow output while debugging or reduce noise during normal use.

MVLib also exposes compile-time timing settings in `mvlib/config.hpp`: `detail::sd_flush`, `detail::terminal_polling_rate`, and `detail::sd_polling_rate`. By default those are `1_mvS`, `120_mvMs`, and `80_mvMs`, and they feed `mvlib::SD_FLUSH_INTERVAL_MS`, `mvlib::TERMINAL_POLLING_RATE_MS`, and `mvlib::SD_POLLING_RATE_MS`. In practice they control how often MVLib flushes SD output, emits terminal data, and writes into the SD buffer. You usually should not change these at first. If you do tune them, lower values feel more responsive, higher values reduce overhead, and overly aggressive terminal polling can cause connection lag or dropped communication.

## 10. Common Mistakes

These are the setup problems most likely to cause confusion:

- Including multiple optional odometry headers in the same project file.
- Calling `logger.start()` before odometry or drivetrain setup is finished.
- Passing the wrong type to `mvlib::LevelOverride<T>`.
- Assuming odometry is required when watches and logs work without it.

For example, this order is wrong:

```cpp
logger.start();
mvlib::setOdom(&chassis);
```

Set up first. Start second.

## 11. Default Recommendation

For most teams, the best starting point is simple:

- include `mvlib/api.hpp`
- attach exactly one odometry adapter if your project already has odometry
- call `setRobot(...)` if you have left and right drivetrain motor groups
- add one or two useful watches
- use the default logger settings
- call `start()`