# MVLib Setup

This guide covers the current MVLib setup flow for a PROS V5 C++ project.

At a high level:

1. Install the library package
2. Include `mvlib/api.hpp`
3. Optionally attach odometry
4. Optionally register left/right drivetrain motor groups
5. Optionally set SD folder or timing/config toggles
6. Call `logger.start()`
## 1. Install MVLib

Use the `v3.0.0` package:

```bash
pros c fetch libmvlib@3.0.0.zip
pros c apply libmvlib@3.0.0
pros make all
```

## 2. Include The Main Header

For most projects:

```cpp
#include "mvlib/api.hpp"
```

`mvlib/api.hpp` includes:

- the logger API
- watches
- waypoints
- time literals
- telemetry support headers

### Optional shorthand

If you want the time literals and `LogLevel` alias without the full namespace:

```cpp
#define MVLIB_USE_SIMPLES
#include "mvlib/api.hpp"
```

That enables:

- `1_mvS`
- `100_mvMs`
- `LogLevel::INFO`

Without it, use the fully qualified names and import the literal namespace when you want `_mvS` or `_mvMs`:

```cpp
mvlib::LogLevel::INFO
mvlib::WatchMode::onChange
using namespace mvlib::literals;
```

## 3. Important Terminal Note

As soon as you create the logger instance:

```cpp
auto& logger = mvlib::Logger::getInstance();
```

MVLib disables the normal PROS terminal framing path used by plain `printf`/`std::cout` style output.

After that:

- do not use raw terminal printing for MVLib live data
- use `logger.debug/info/warn/error/fatal(...)`

This matters because live MotionView telemetry now uses a binary stream.

## 4. Attach Odometry

Odometry is optional, but strongly recommended.

Without odometry, you still get:

- standard logs
- watches
- waypoint registration

Without odometry, you do not get live pose telemetry, path drawing, or waypoint reach math.

Calling `setRobot(...)` without a pose source still registers the drivetrain for velocity reporting, but MVLib's live telemetry stream remains pose-gated in the current implementation.

With odometry, MotionView can also draw:

- robot path
- heading
- pose over time
- waypoint reach/timeout behavior based on real position

### Use exactly one odometry adapter

Choose 1 of:

- `mvlib/Optional/lemlib.hpp`
- `mvlib/Optional/ezTemplate.hpp`
- `mvlib/Optional/okapi.hpp`
- `mvlib/Optional/customOdom.hpp`

Do not include more than one.

### LemLib

```cpp
#include "main.h"
#include "mvlib/api.hpp"
#include "mvlib/Optional/lemlib.hpp"

extern lemlib::Chassis chassis;

void initialize() {
  auto& logger = mvlib::Logger::getInstance();
  logger.setBuildDate(__DATE__);
  mvlib::setOdom(&chassis);
  logger.start();
}
```

### EZ-Template

```cpp
#include "mvlib/Optional/ezTemplate.hpp"

extern ez::Drive chassis;

void initialize() {
  auto& logger = mvlib::Logger::getInstance();
  logger.setBuildDate(__DATE__);
  mvlib::setOdom(&chassis);
  logger.start();
}
```

### Okapi

```cpp
#include "mvlib/Optional/okapi.hpp"

extern std::shared_ptr<okapi::OdomChassisController> odomChassis;

void initialize() {
  auto& logger = mvlib::Logger::getInstance();
  logger.setBuildDate(__DATE__);
  mvlib::setOdom(odomChassis.get());
  logger.start();
}
```

You can also pass a different Okapi length unit if needed:

```cpp
mvlib::setOdom(odomChassis.get(), okapi::inch);
```

### Custom odometry

```cpp
#include "mvlib/Optional/customOdom.hpp"

void initialize() {
  auto& logger = mvlib::Logger::getInstance();
  logger.setBuildDate(__DATE__);

  mvlib::setOdom([&]() -> std::optional<mvlib::Pose> {
    if (!odomReady()) return std::nullopt;
    return mvlib::Pose{
      tracking.getX(),
      tracking.getY(),
      tracking.getHeading()
    };
  });

  logger.start();
}
```

## 5. Optionally Register The Drivetrain

If you have left/right `pros::MotorGroup`s, register them:

```cpp
logger.setRobot({
  .leftDrivetrain = &left_motors,
  .rightDrivetrain = &right_motors
});
```

This lets MVLib use actual drivetrain motor velocity instead of estimating speed from pose.

You can also force speed estimation:

```cpp
logger.setRobot({
  .leftDrivetrain = &left_motors,
  .rightDrivetrain = &right_motors
}, true);
```

Use that only if you intentionally want odometry-based speed estimation.

## 6. Optional SD Logging Location Setup

`logger.setLoggingLocation(...)` lets you route all SD log data into a custom folder and/or file.

See [SD Logging](https://lewispinstein-hue.github.io/MotionView/docs/MVLib/SDLogging) for the full path rules, fallback policies, and examples.

Do this before `logger.start()`. If you want MVLib to automatically generate timestamped SD filenames, also provide the user project build date before `logger.start()`:

```cpp
logger.setBuildDate(__DATE__);
```

MVLib uses this date to decide whether the VEX Brain RTC is plausible before using it in an automatic SD filename.

## 7. Start The Logger

Start the background task once:

```cpp
logger.start();
```

Do your setup first:

- odometry
- drivetrain
- watches
- waypoints
- output toggles
- timings
- logging location

Then start the logger.

## 8. Recommended Baseline Setup

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
  logger.setBuildDate(__DATE__);

  mvlib::setOdom(&chassis);

  logger.setRobot({
    .leftDrivetrain = &left_motors,
    .rightDrivetrain = &right_motors
  });

  logger.start();
}
```

## 9. Add A First Watch

```cpp
mvlib::WatchHandle batteryWatch = logger.watch("Battery Voltage", LogLevel::INFO,
  WatchMode::onInterval, 1_mvS, []() { return pros::battery::get_voltage(); });
```

For event-like values, use `WatchMode::onChange`:

```cpp
logger.watch("Auton Stage", LogLevel::INFO, WatchMode::onChange, 250_mvMs,
  []() { return autonStage; });
```

You can keep the returned `WatchHandle` if you want to enable/disable the watch,
change its interval, force an evaluation, or re-send its roster entry later.
For `WatchMode::onChange` watches, `250_mvMs` above is the debounce interval.
`LevelOverride` is optional.

The full watches documentation is [here](https://lewispinstein-hue.github.io/MotionView/docs/MVLib/Watches).

## 10. Optional Runtime Controls

Examples:

```cpp
logger.setLogToTerminal(true);
logger.setLogToSD(true);
logger.setPrintTelemetry(true);
logger.setPrintWatches(true);
logger.setPrintWaypoints(true);
logger.setLogSystemInfo(true);

logger.setMinLogLevel(LogLevel::INFO);

logger.setTimings({
  .sdBufferFlushInterval = 1000,
  .stdoutBufferFlushInterval = 400,
  .sdPollingRate = 80,
  .terminalPollingRate = 100,
  .rosterSyncAllInterval = 8000
});
```

The full runtime controls documentation is [here](https://lewispinstein-hue.github.io/MotionView/docs/MVLib/Configuration).
