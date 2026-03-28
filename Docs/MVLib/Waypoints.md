# MVLib Waypoints

Waypoints are named target poses you register with MVLib so MotionView can tell you when the robot reached a location, timed out before getting there, or is still offset from it.

They are most useful in autonomous debugging. A waypoint gives you a fixed reference point like "matchload corner", "goal pickup", or "turn complete" and lets you answer:

- Did the robot ever get there?
- How far off was it?
- Did it arrive within a timeout?
- Was the heading correct when it arrived?

## What You Need Before Using Waypoints

Waypoints depend on pose data. In practice, that means you should already have MVLib set up with odometry through one of the supported adapters or a custom pose getter.

If MVLib does not have a valid pose source, waypoint math has nothing useful to compare against. You can still create a waypoint handle, but the offsets and reached logic will not mean much until pose data exists.

You also need the logger running:

```cpp
auto& logger = mvlib::Logger::getInstance();
logger.start();
```

If you want MotionView to print waypoint events automatically, leave waypoint printing enabled:

```cpp
logger.setPrintWaypoints(true);
```

That is on by default.

## The Main API: `logger.addWaypoint(...)`

You create a waypoint by giving it a label and a `WaypointParams` struct:

```cpp
auto& logger = mvlib::Logger::getInstance();

auto goalPickup = logger.addWaypoint("Goal Pickup", {
  .tarX = 48,
  .tarY = -24,
  .linearTol = 2.0f
});
```

This registers a waypoint named `"Goal Pickup"` at `(48, -24)` with a 2 inch linear tolerance.
<details>
  <summary><small>View Source Code</small></summary>

```cpp
WaypointHandle addWaypoint(std::string name, WaypointParams details);
```
</details>

When that waypoint is active, MVLib can:

- mark it reached once the robot is close enough
- mark it timed out if you gave it a timeout and the robot missed it
- print periodic offset updates if you asked for them
- let you query the current state through the returned `WaypointHandle`

## `WaypointParams`

`WaypointParams` defines what "reached" means for a waypoint.

<details>
  <summary><small>View Source Code</small></summary>

```cpp
struct WaypointParams {
  double tarX;
  double tarY;
  std::optional<double> tarT = std::nullopt;
  std::optional<uint32_t> timeoutMs = std::nullopt;
  float linearTol;
  std::optional<float> thetaTol = std::nullopt;
  std::optional<uint32_t> logOffsetEveryMs = std::nullopt;
  bool retriggerable = false;
};
```
</details>

### Fields

- `tarX`: target X position.
- `tarY`: target Y position.
- `linearTol`: how close the robot must be in position to count as reached.
- `tarT`: optional target heading.
- `thetaTol`: optional heading tolerance. Only matters if you care about heading.
- `timeoutMs`: optional time limit before the waypoint is considered missed.
- `logOffsetEveryMs`: optional interval for periodic offset logs while the waypoint is still active.
- `retriggerable`: if set `true`, the waypoint will never expire. Every time the waypoint is reached, it's logged, and the `timeoutMs` field controls deactivation time.

### How the fields work together

The minimum required setup is:

```cpp
{
  .tarX = 48,
  .tarY = -24,
  .linearTol = 2.0f
}
```

That means:

- MVLib checks whether the robot is within 2 units of `(48, -24)`
- heading is ignored
- there is no timeout
- there are no periodic offset prints

If you add heading:

```cpp
{
  .tarX = 48,
  .tarY = -24,
  .tarT = 90,
  .linearTol = 2.0f,
  .thetaTol = 10.0f
}
```

Now the waypoint only counts as reached when both of these are true:

- the robot is within `linearTol` of the target position
- the robot heading is within `thetaTol` of `tarT`

If you add a timeout:

```cpp
{
  .tarX = 48,
  .tarY = -24,
  .linearTol = 2.0f,
  .timeoutMs = 3000
}
```

MVLib starts the timeout when the waypoint is created, not when your robot begins a specific movement command. If the waypoint is still not reached after 3000 ms, MVLib marks it timed out.

If you add periodic offset printing:

```cpp
{
  .tarX = 48,
  .tarY = -24,
  .linearTol = 2.0f,
  .logOffsetEveryMs = 500
}
```

MVLib periodically logs the robot's offset from that waypoint every 500 ms while the waypoint is still active.

If you make a waypoint retriggerable:

```cpp
{
  .tarX = 48,
  .tarY = -24,
  .linearTol = 2.0f,
  .timeoutMs = 30_mvS
  .retriggerable = true
}
```

Then the waypoint will never deactivate after being reached. Every time it is reached, it is logged, and the `timeoutMs` field will determine how long the waypoint is active. Retriggerable waypoints are not removable, so use a timeout if you want it to deactivate.

## `WaypointHandle`

`logger.addWaypoint(...)` returns a `WaypointHandle`. That handle is how you inspect the waypoint later from your own code.

<details>
  <summary><small>View Source Code</small></summary>

```cpp
class WaypointHandle {
public:
  WaypointOffset getOffset();
  WaypointParams getParams();
  std::string getLabel();
  bool reached();
  bool timedOut();
  void active();
};
```
</details>

### `getOffset()`

Returns a `WaypointOffset` describing the robot's current error relative to the target.

Use this when you want the raw numbers, not just a yes/no answer.

Example:

```cpp
auto cp = logger.addWaypoint("Alliance Stake", {
  .tarX = 24,
  .tarY = 12,
  .tarT = 180,
  .linearTol = 1.5f,
  .thetaTol = 8.0f
});

auto off = cp.getOffset();
printf("Offset X: %.2f, Y: %.2f\n", off.offX, off.offY);
```

### `getParams()`

Returns the original `WaypointParams` for that waypoint.

Use this when you want to inspect what target and tolerances were registered, especially while debugging multiple waypoints.

### `getLabel()`

Returns the waypoint name you passed into `addWaypoint(...)`.

Use this when your code stores multiple handles and you want a readable label for logs or screen output.

### `reached()`

Returns `true` if the waypoint is currently considered reached.

Use this when you want waypoint state inside your own control logic:

```cpp
if (goalPickup.reached()) {
  nextAutonStage();
}
```

### `timedOut()`

Returns `true` if the waypoint has timed out. This is only true if the waypoint has a timeout set. 
The timer starts as soon as the waypoint is constructed, and ends when `reached()` returns `true` or `timedOut()` returns `true`.

### `active()`

Returns `true` if the waypoint is still active. When a waypoint is `active`, that means that it is not yet reached or timed out. It is being monitored by MVLib's internal state machine.


## `WaypointOffset`

`WaypointOffset` is the snapshot returned by `WaypointHandle::getOffset()`.

<details>
  <summary><small>View Source Code</small></summary>

```cpp
struct WaypointOffset {
  double totalOffset;
  double offX;
  double offY;
  std::optional<double> offT = std::nullopt;
  std::optional<uint32_t> remainingTimeout = std::nullopt;
  bool reached;
  std::optional<bool> timedOut = std::nullopt;
};
```
</details>

### Fields

- `totalOffset`: total linear distance from the waypoint target.
- `offX`: X error relative to the target.
- `offY`: Y error relative to the target.
- `offT`: heading error, if the waypoint tracks heading.
- `remainingTimeout`: milliseconds left before timeout, if the waypoint has one.
- `reached`: whether the waypoint is currently within tolerance.
- `timedOut`: whether the waypoint has already exceeded its timeout, if it has one.

### When each field is useful

- `totalOffset` is the fastest way to answer "how far away was I?"
- `offX` and `offY` are useful when you want to know the direction of the miss, not just the size of it.
- `offT` matters when your robot needs to arrive facing a specific direction.
- `remainingTimeout` helps when you want to see whether you are barely missing a route or failing much earlier.
- `reached` and `timedOut` are the high-level status flags.

## What MVLib Prints For Waypoints

Once a waypoint is active, MVLib can emit three kinds of waypoint events:

- `CREATED`
- `REACHED`
- `TIMEDOUT`

If you set `logOffsetEveryMs`, it can also emit:

- `OFFSET`

The behavior is:

- when you call `addWaypoint(...)`, MVLib logs a `CREATED` event
- if the robot reaches the waypoint, MVLib logs `REACHED` and deactivates that waypoint
- if the timeout expires first, MVLib logs `TIMEDOUT` and deactivates that waypoint
- if the waypoint is still active and `logOffsetEveryMs` is set, MVLib logs `OFFSET` periodically

That deactivation matters. A waypoint is meant to represent a single target event, not a forever-active monitor.

## Common Usage Patterns

### 1. Position-only waypoint

Use this when the robot only needs to arrive near a location.

```cpp
auto ringZone = logger.addWaypoint("Ring Zone", {
  .tarX = 60,
  .tarY = -18,
  .linearTol = 3.0f
});
```

Good for:

- entering a zone
- reaching a preload location
- crossing a line or region

### 2. Position + heading waypoint

Use this when the robot must arrive facing a specific direction.

```cpp
auto wallAlign = logger.addWaypoint("Wall Align", {
  .tarX = 18,
  .tarY = 42,
  .tarT = 180,
  .linearTol = 1.5f,
  .thetaTol = 6.0f
});
```

Good for:

- wall stakes
- goal approach angles
- matchload or scoring alignments

### 3. Timeout-backed waypoint

Use this when you want to know whether a route segment is taking too long.

```cpp
auto earlyRoute = logger.addWaypoint("Early Route", {
  .tarX = 36,
  .tarY = -12,
  .linearTol = 2.0f,
  .timeoutMs = 2500
});
```

Good for:

- catching route stalls
- proving an auton miss happened before the next action
- comparing two route versions

### 4. Periodic offset waypoint

Use this when you want repeated progress reports while the robot is trying to reach a point.

```cpp
auto cornerTurn = logger.addWaypoint("Corner Turn", {
  .tarX = 72,
  .tarY = -48,
  .tarT = 90,
  .linearTol = 2.0f,
  .thetaTol = 8.0f,
  .logOffsetEveryMs = 500
});
```

Good for:

- seeing whether error is shrinking or growing
- debugging a bad approach path
- checking whether heading settles before the robot leaves the area

## Full Example

This is a realistic autonomous-style setup:

```cpp
#include "main.h"
#include "mvlib/api.hpp"
#include "mvlib/Optional/lemlib.hpp"

extern lemlib::Chassis chassis;

void initialize() {
  auto& logger = mvlib::Logger::getInstance();
  mvlib::setOdom(logger, &chassis);
  logger.start();
}

void autonomous() {
  auto& logger = mvlib::Logger::getInstance();

  auto matchload = logger.addWaypoint("Matchload Setup", {
    .tarX = 70,
    .tarY = -47,
    .tarT = 0,
    .linearTol = 2.0f,
    .thetaTol = 10.0f,
    .timeoutMs = 5000,
    .logOffsetEveryMs = 1000
  });

  // Drive code here

  while (!matchload.reached()) {
    // Update location until we reach the waypoint
    printf("Remaining distance: %.2f\n", matchload.getOffset().totalOffset);
    pros::delay(20); 
  }
  printf("Waypoint %s reached with %d ms to spare\n", matchload.getLabel().c_str(), matchload.getOffset().remainingTimeout.value());
}
```

This example does three useful things:

- creates a waypoint with both position and heading requirements
- gives it a timeout so MotionView can tell you whether the segment missed on time
- checks the current offset manually from user code

## Practical Advice

- Create waypoints at meaningful autonomous milestones, not every tiny pose update.
- Use position-only waypoints first. Add heading requirements only where they matter.
- Add `timeoutMs` when you want waypoints to answer "did this segment take too long?"
- Add `logOffsetEveryMs` when you are actively debugging a route and want repeated progress reports.
- Keep labels clear. Names like `"Blue Goal Pickup"` are much easier to debug than `"CP1"`.

## Common Mistakes

- Creating waypoints before MVLib has a valid pose source.
- Forgetting that timeout starts when the waypoint is created.
- Using heading tolerance without providing a target heading.
- Expecting one waypoint to stay active forever after it is reached or timed out.
- Spamming too many offset-printing waypoints at once during a run.

It is best to use waypoints for distinct target moments in the route, then use the handle methods when you need more detail than MotionView's event stream gives you.
