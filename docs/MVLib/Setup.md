# MVLib Setup

MVLib connects a PROS V5 C++ project to MotionView. Start with a battery watch and a startup log to verify the connection, then add the data you need.

- For logs and watches, start the logger and choose an output. You can test this with the robot sitting still.
- For a path or waypoint reach checks, attach a pose source. Registering motor groups alone gives MVLib a speed source, while the path still needs position and heading.
- For per-side velocity or drivetrain watchdogs, register the motor groups as well. If you only need the path, pose-based speed estimation can use the pose source by itself.

## Install MVLib in your PROS project

Download a package compatible with your MotionView version and place the ZIP in the PROS project root. Use `libmvlib@<version>.zip` for a standard PROS project on kernel 4.2.1 or newer. Substitute the version from your ZIP filename in both commands. [Downloads](../../Download.md) · [Version compatibility](../../Home.md?id=version-compatibility)

```bash
pros c fetch libmvlib@<version>.zip
pros c apply libmvlib@<version>
pros make all
```

If you are updating an existing project, run `pros c info-project` and check the `libmvlib` entry before uploading. A successful build confirms the installed headers and library work with your project. Uploading that build is what puts the version on the robot. [Updating to v3.0.0](./UpdatingTo-v3.0.0.md)

### Install MVLib with EZ-Template

For an EZ-Template project, use the source-based `libmvlib-ez-template@<version>.zip` package instead. It supports PROS kernels 4.1.1 through 4.2.2 by compiling MVLib with the toolchain installed in the project. Do not use the precompiled `libmvlib` package for this setup.

From the project root, fetch and apply the EZ-Template package:

```bash
pros c fetch libmvlib-ez-template@<version>.zip
pros c apply libmvlib-ez-template@<version>
```

Then run the cache script for your terminal. This is required once after every fresh apply or update of `libmvlib-ez-template`; it compiles `src/mvlib` into `firmware/libmvlib.a`, removes the source copy, and verifies that the project builds against the archive. Subsequent `pros make` and upload commands use the cached archive.

**macOS or Linux (Bash)**

```bash
curl -fsSL https://raw.githubusercontent.com/lewispinstein-hue/MotionView/main/MVLib/scripts/cache-ez-template.sh | bash
```

**Windows (PowerShell)**

```powershell
Invoke-RestMethod -Uri "https://raw.githubusercontent.com/lewispinstein-hue/MotionView/main/MVLib/scripts/cache-ez-template.ps1" | Invoke-Expression
```

Run the Windows command in PowerShell, not Command Prompt. The script runs `pros make` itself, so do not remove `src/mvlib` manually or move the archive yourself. On success it reports that MVLib was cached. Confirm that `firmware/libmvlib.a` exists, `src/mvlib` is gone, and `include/mvlib` remains. If the script fails, it leaves or restores the source directory so you can correct the reported build error and run it again.

## API reference

### Start and control the logger

Include `mvlib/api.hpp` for the logger, watches, waypoints, and time literals.

| Method | When to call it |
| --- | --- |
| `static Logger& getInstance()` | Get the shared logger. After the first call, route terminal messages through MVLib's log methods. Raw `printf` or `std::cout` output can interfere with the live stream. |
| `void start()` | Call once per program run, after configuration. Starts periodic updates and opens the SD log if enabled. |
| `void pause()` | Pauses periodic updates, including watch sampling and waypoint checks. Direct log calls still work, and waypoint deadlines still count from registration. |
| `void resume()` | Resumes periodic updates after `pause()`. |
| `uint32_t status() const` | Returns the PROS task state. Before the task starts, it returns `pros::E_TASK_STATE_INVALID`. |

Set the SD destination and call `setBuildDate(__DATE__)` before `start()` if you use generated filenames. The logger supports live-only, SD-only, and combined output. [Configuration](./Configuration.md) · [SD Logging](./SDLogging.md)

Use `pause()` when you want to suspend periodic work across the whole logger. When you resume, updates pick up with the current readings. A waypoint whose deadline passed during the pause can time out on the next check. If you only want to hide waypoint events while continuing to check reaches and deadlines, use `setPrintWaypoints(false)`.

### Choose how to write types and times

Use qualified names such as `mvlib::LogLevel` and pass timing values in milliseconds. For shorthand, define `MVLIB_USE_SIMPLES` before the first inclusion of `mvlib/api.hpp`. This enables names such as `LogLevel` and `WatchMode` and time literals such as `1_mvS` and `250_mvMs`.

### Attach odometry to see the robot's path :id=attach-odometry-to-see-the-robots-path

Logs and watches work with or without odometry. Pose updates and waypoint reach checks need a working pose source. Include only the adapter for your odometry library and call `mvlib::setOdom(...)` after your normal odometry setup, before `logger.start()`. Keep the object you pass to MVLib alive for as long as the logger uses it.

| Source | Header | Argument to `mvlib::setOdom(...)` |
| --- | --- | --- |
| LemLib | `mvlib/Optional/lemlib.hpp` | Pointer to a `lemlib::Chassis`. |
| EZ-Template | `mvlib/Optional/ezTemplate.hpp` | Pointer to an `ez::Drive` with odometry enabled. |
| OkapiLib | `mvlib/Optional/okapi.hpp` | Pointer to an `okapi::OdomChassisController`. Pass `odomChassis.get()` if your project holds it in a `std::shared_ptr`. Position defaults to inches and heading is in degrees. Pass a second argument to choose another length unit. |
| Custom odometry | `mvlib/Optional/customOdom.hpp` | Callable returning `std::optional<mvlib::Pose>`. Return `std::nullopt` until pose is available. |

Attach the adapter after your chassis is initialized and odometry is ready. If your tracker becomes unavailable during a run, a custom adapter can return `std::nullopt` for those reads. Logs and watches can continue, but MVLib needs a pose to draw a new path point or record a waypoint reach. Timed waypoints still have their original deadlines. [Waypoint timeouts](./Waypoints.md?id=how-the-timeout-works)

### Register the drivetrain

```cpp
struct Drivetrain {
  pros::MotorGroup* leftDrivetrain;
  pros::MotorGroup* rightDrivetrain;
};

bool setRobot(Drivetrain drivetrain, bool useSpeedEstimation = false);
```

`Drivetrain` is a type on `mvlib::Logger`. Pass both motor groups before startup if you want per-side motor velocity or drivetrain watchdogs. Keep both groups alive while the logger uses them.

`setRobot(...)` returns `true` on successful registration. A null pointer, a previous successful registration, or an already started logger causes the call to return `false`.

If you omit the groups, MVLib estimates speed from pose. Pass `true` as the second argument to register the groups and still use pose-based speed. Both speed modes need a valid pose to appear in MotionView.

## Examples

### Verify live output with a battery watch

Add the headers and merge the example into your existing `initialize()`. It samples once per second and converts the battery reading from millivolts to volts.

```cpp
#include "main.h"
#include "pros/misc.hpp"
#include "mvlib/api.hpp"

void initialize() {
  auto& logger = mvlib::Logger::getInstance();
  logger.setBuildDate(__DATE__);

  logger.watch("Battery Voltage (V)", mvlib::LogLevel::INFO,
    mvlib::WatchMode::onInterval, 1000,
    []() { return pros::battery::get_voltage() / 1000.0; });

  logger.start();
  logger.info("Robot logger ready");
}
```

Upload and run the program, then connect MotionView and open **Watches**. To see **Robot logger ready** live, have MotionView listening when the program starts. You can also find the message in the SD recording if the file opened successfully. [Live streaming setup](../MotionView/SetupLivestreaming.md) · [Viewing Mode](../MotionView/ViewingMode/ViewingMode.md?id=live-streaming)

If the startup message appears but the battery watch stays blank, the link is receiving direct logs. Check that periodic updates are running and automatic watch output is enabled. If both appear but the field is empty, the logger is working and the example still needs a pose source to draw a path.

### Add LemLib odometry and motor groups

This example assumes your project already defines the chassis and motor groups. Calibrate the chassis before starting the logger.

```cpp
#include "main.h"
#include "mvlib/api.hpp"
#include "mvlib/Optional/lemlib.hpp"

extern lemlib::Chassis chassis;
extern pros::MotorGroup left_motors;
extern pros::MotorGroup right_motors;

void initialize() {
  chassis.calibrate();

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

### Supply a custom pose

Use the custom adapter if you already have a tracker that provides position and heading. Here, `odomReady()` and `tracking` belong to your project. Report position in inches for MotionView's field scale and heading in degrees, with 0° facing +Y.

```cpp
#include "mvlib/Optional/customOdom.hpp"
```

```cpp
mvlib::setOdom([]() -> std::optional<mvlib::Pose> {
  if (!odomReady()) return std::nullopt;
  return mvlib::Pose{
    tracking.getX(),
    tracking.getY(),
    tracking.getHeading()
  };
});
```

Return an empty pose while the tracker is calibrating. Returning a default pose at the origin would tell MVLib the robot really is at the origin, so a waypoint there could be recorded as reached. Once the tracker is ready, check a known position and turn before relying on a waypoint's tolerances.

## Troubleshooting

**There is no live data.** Check that the uploaded program runs, `start()` is called, and MotionView is connected to the correct robot. Check the version pair and make sure terminal output is enabled. [Live streaming setup](../MotionView/SetupLivestreaming.md) · [Version compatibility](../../Home.md?id=version-compatibility)

**The battery watch works, but there is no path.** Check that your adapter is attached, odometry is producing a valid pose, and `setPrintTelemetry(true)` is in effect. Move the robot and verify the displayed pose before testing waypoints.

**Startup reports a missing drivetrain and speed estimation.** Speed estimation is the fallback when you omit `setRobot(...)`. If you intended to use motor velocities, check both pointers and confirm the call succeeds before `start()`.

**The project builds until I add the odometry header.** Check that the corresponding library is installed and that your project includes a single MVLib adapter. If you are upgrading from v2, check for renamed methods and changed signatures. [Updating to v3.0.0](./UpdatingTo-v3.0.0.md)
