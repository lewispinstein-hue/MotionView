# MVLib Waypoints

Waypoints are named target poses you register so MotionView can tell you when the robot:

- reached a target
- timed out before reaching it
- should expose the target in the viewer roster

They are most useful for autonomous debugging.
Also useful for driver practice. For example, set up waypoints with timeouts to practice timed runs.

## What You Need First

Waypoints depend on pose data.

That means you should already have odometry attached through one of the supported adapters or a custom pose getter

Without pose data, waypoint creation still succeeds, but reach math will not happen.

## Main API

```cpp
template<size_t len>
WaypointHandle addWaypoint(const char (&name)[len], WaypointParams details);
```

Example:

```cpp
auto goalPickup = logger.addWaypoint("Goal Pickup", {
  .tarX = 48,
  .tarY = -24,
  .linearTol = 2
});
```

## `WaypointParams`

```cpp
struct WaypointParams {
  double tarX;
  double tarY;
  std::optional<double> tarT = std::nullopt;
  std::optional<uint32_t> timeoutMs = std::nullopt;
  float linearTol;
  std::optional<float> thetaTol = std::nullopt;
  bool retriggerable = false;
};
```

### Fields

- `tarX`: target X position
- `tarY`: target Y position
- `linearTol`: required linear tolerance
- `tarT`: optional target heading
- `thetaTol`: optional heading tolerance
- `timeoutMs`: optional timeout starting from waypoint creation time
- `retriggerable`: whether the waypoint can continue reporting repeated reaches instead of deactivating on first reach

## Important `v2.0.0` Changes

- `WaypointParams::logOffsetEveryMs` no longer exists.
- MVLib no longer emits periodic terminal-side waypoint `OFFSET` events.
- Live waypoint output is now centered on:
  - `CREATED`
  - `REACHED`
  - `TIMEDOUT`
- Waypoint roster metadata can be re-sent with the new roster resync helpers.

## Heading Behavior

If you provide `tarT` but not `thetaTol`, MVLib automatically uses `linearTol` as the heading tolerance.

If you provide `thetaTol` without `tarT`, MVLib clears `thetaTol` because there is no target heading to compare against.

## Timeouts

Timeouts start when the waypoint is created:

```cpp
auto goal = logger.addWaypoint("Goal", {
  .tarX = 48,
  .tarY = -24,
  .linearTol = 2,
  .timeoutMs = 3_mvS
});
```

If the waypoint is still active after 3000 ms, MVLib marks it timed out.

## Retriggerable Waypoints

Example:

```cpp
auto lineCross = logger.addWaypoint("Center Line", {
  .tarX = 0,
  .tarY = 0,
  .linearTol = 2.0f,
  .timeoutMs = 30_mvS,
  .retriggerable = true
});
```

Behavior:

- a non-retriggerable waypoint deactivates after the first `REACHED`
- a retriggerable waypoint stays active after `REACHED`
- a retriggerable waypoint still deactivates on timeout if `timeoutMs` is set

## `WaypointHandle`

`addWaypoint(...)` returns a `WaypointHandle`:

```cpp
class WaypointHandle {
public:
  WaypointOffset getOffset() const;
  WaypointParams getParams() const;
  std::string getLabel() const;
  bool reached() const;
  bool timedOut() const;
  bool active() const;
  bool resyncRoster() const;
};
```

### `getOffset()`

Returns the current `WaypointOffset` for this waypoint.

Behavior:

- if pose data is available, the offset is computed from the robot's current pose to this waypoint's target
- if the waypoint tracks heading, `offT` is included
- if the waypoint has a timeout, timeout-related fields are included
- if pose data is unavailable, the returned offset is effectively empty/defaulted

Use this when you want the raw positional error and timeout state:

```cpp
auto off = goalPickup.getOffset();
logger.info("Goal offset: %.2f, %.2f", off.offX, off.offY);
```

### `getParams()`

Returns the waypoint's stored `WaypointParams`.

This is the waypoint configuration MVLib is currently using for target position, tolerances, timeout, and retriggerability.

### `getLabel()`

Returns the waypoint's label exactly as it was registered.

### `reached()`

Returns whether the waypoint is currently within tolerance.

Behavior:

- position must be within `linearTol`
- if the waypoint has a target heading, heading must also be within `thetaTol`
- this is the current geometric state, not "has this ever been reached"

For retriggerable waypoints, `reached()` can become true more than once over the waypoint's lifetime.

### `timedOut()`

Returns whether the waypoint has timed out. A waypoint becomes timed out after it has existed longer than its `timeoutMs` allows.

Behavior:

- only waypoints with `timeoutMs` can time out
- a timed out waypoint is automatically deactivated
- once a waypoint times out, `timedOut()` continues returning `true` for that waypoint
- if no timeout was configured, this returns `false`

### `active()`

Returns whether MVLib is still actively tracking this waypoint.

Active means the waypoint is still participating in MVLib's internal waypoint lifecycle: it can still be checked for `REACHED` or `TIMEDOUT`, and it is still eligible for active waypoint behavior.

Behavior:

- a non-retriggerable waypoint becomes inactive after its first `REACHED`
- a retriggerable waypoint stays active after `REACHED`
- any waypoint becomes inactive after `TIMEDOUT`
- an inactive waypoint remains registered, but MVLib no longer treats it as an active waypoint target

### `resyncRoster()`

Re-sends this waypoint's roster metadata to MotionView.

Use it when the waypoint exists but its name did not appear in the viewer because MotionView joined late or missed the original roster packet.

Behavior:

- returns `true` if this waypoint's roster entry was actually re-sent
- returns `false` if the waypoint is no longer active, does not exist, or roster output is not currently available

## `WaypointOffset`

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

### Fields

- `totalOffset`: Euclidean linear distance from the target
- `offX`: target X minus current X
- `offY`: target Y minus current Y
- `offT`: wrapped heading error in degrees, if heading is tracked
- `remainingTimeout`: milliseconds left before timeout, if one exists
- `reached`: whether the waypoint is currently within tolerance
- `timedOut`: whether timeout has already occurred

## What MVLib Emits

With waypoint printing enabled, MVLib emits:

- `CREATED` when you call `addWaypoint(...)`
- `REACHED` when the waypoint enters tolerance
- `TIMEDOUT` when timeout expires first

In `v2.0.0`, live terminal waypoint events are sent through MVLib's binary telemetry protocol. SD logging still writes readable `[WPOINT],...` lines.

## Roster Resync Helpers

To re-send every active waypoint name:

```cpp
logger.resyncAllWaypointsRoster();
```

This is useful if MotionView joins late and misses waypoint roster metadata.

## Practical Examples

### Position-only waypoint

```cpp
auto ringZone = logger.addWaypoint("Ring Zone", {
  .tarX = 60,
  .tarY = -18,
  .linearTol = 3.0f
});
```

### Position + heading waypoint

```cpp
auto allianceStake = logger.addWaypoint("Alliance Stake", {
  .tarX = 24,
  .tarY = 12,
  .tarT = 180,
  .linearTol = 1.5f,
  .thetaTol = 8.0f
});
```

### Timeout-constrained waypoint

```cpp
auto matchload = logger.addWaypoint("Matchload Corner", {
  .tarX = 70,
  .tarY = -47,
  .tarT = 0,
  .linearTol = 2.0f,
  .thetaTol = 10.0f,
  .timeoutMs = 5_mvS
});
```

## Common Mistakes

- Expecting periodic `OFFSET` events from the live stream. That API was removed.
- Using waypoints without any pose source configured.
- Forgetting that timeouts start at creation time.
- Assuming a waypoint stays active after `REACHED` when `retriggerable` is `false`.
