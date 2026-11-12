# MVLib Waypoints

A waypoint is a named target MVLib checks against your robot's odometry. Use waypoints to see whether the robot passed through a ring pickup zone, lined up for a goal pickup, or reached a practice checkpoint before a deadline. Your drive code commands the motion, and MotionView shows the result. [MVLib Setup](./Setup.md?id=attach-odometry-to-see-the-robots-path) · [Viewing Mode](../MotionView/ViewingMode/ViewingMode.md?id=waypoints)

## API reference

### `addWaypoint(...)`

```cpp
template<size_t len>
WaypointHandle addWaypoint(const char (&name)[len], WaypointParams details);
```

Use a fixed string literal of at most 23 characters for live display. Keep the returned `WaypointHandle` if your code needs to inspect the result.

### `WaypointParams`

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

| Field | What to pass |
| --- | --- |
| `tarX`, `tarY` | Target coordinates in the same units and coordinate system as your odometry. |
| `tarT` | Optional target heading in degrees. Leave it unset for a position-only target. |
| `timeoutMs` | Optional deadline in milliseconds from the call to `addWaypoint()`. |
| `linearTol` | Maximum straight-line distance from the target that counts as a reach, in your odometry's distance units. |
| `thetaTol` | Maximum heading error in degrees. When `tarT` is set, this defaults to the numeric value of `linearTol`. It applies only when a target heading is set. |
| `retriggerable` | Set to `true` to keep tracking after the first reach and report later re-entries. |

Keep designated initializers in the order shown above. In particular, `.timeoutMs` goes before `.linearTol`.

### How MVLib decides a reach

During a check, MVLib compares the straight-line distance to `linearTol` and the absolute heading error to `thetaTol` if a target heading is set. Both must be at or below their tolerances in the same pose sample. For example, a robot 1 inch east and 1 inch north of a target is about 1.4 inches away. A 1-inch tolerance still misses it. A robot facing 358° is 4° from a 2° target, so a 5° heading tolerance accepts it.

A one-shot waypoint finishes on the first reach. A retriggerable waypoint stays active and can report another reach after MVLib observes the robot outside tolerance and then inside again. Staying inside with a valid pose produces a single reach. If odometry becomes unavailable and then recovers while the robot is still inside, the first pose after recovery can register another reach.

### How the timeout works

The clock starts when you call `addWaypoint()`, even if `start()` has yet to run or the logger is paused. Register a timed target when the maneuver or drill starts so time spent waiting for the run does not use up its deadline.

- Omit `timeoutMs` for no deadline. A retriggerable waypoint can then keep tracking for the rest of the program run. A value of `0` instead expires on the first check.
- With a timeout, the first active check at or after the deadline ends tracking. If the robot is in tolerance on that check, timeout takes priority. A missing pose still allows a timeout.
- A one-shot waypoint that reached before its deadline is already inactive and stays reached. For a retriggerable waypoint, each reach leaves the original deadline in place. At the deadline it stops tracking, even if the robot is still inside the target.

### Waypoint events

MotionView can show `CREATED` at registration, `REACHED` at each recorded reach, and `TIMEDOUT` when tracking ends because of a deadline. A waypoint registered before `start()` can appear in the SD recording if waypoint output is enabled at registration and startup.

`setPrintWaypoints(false)` suppresses events on both outputs while tracking continues. A waypoint can reach or time out while output is off, and its handle still records that result. Turning output back on makes future events visible. [Configuration](./Configuration.md?id=output)

## `WaypointHandle`

| Method | Behavior |
| --- | --- |
| `WaypointParams getParams() const` | Returns the stored target, tolerances, deadline, and retrigger setting, including the heading tolerance MVLib resolved. |
| `std::string getLabel() const` | Returns the name used at registration. |
| `bool active() const` | Returns `true` while the waypoint is eligible for reach and timeout checks. A first reach ends a one-shot waypoint. A timeout ends either kind. You can still inspect an inactive waypoint. |
| `bool resyncRoster() const` | Re-sends the active waypoint's name to MotionView. In v3.0.2 it also re-sends the target definition. Returns `false` if the waypoint is inactive or live output is unavailable. |

MVLib v3.0.2 also exposes `bool valid() const` to check whether registration succeeded. Keep at least one of terminal and SD logging enabled when creating waypoints.

Call `logger.resyncAllWaypointsRoster()` to re-send all active targets if MotionView joins late.

### `reached()`

`bool reached() const` starts out `false`. It becomes `true` after a logger check observes the waypoint active and within tolerance before its deadline, if one is set. Reading the handle returns that stored result. For example, immediately after stopping at the target, `reached()` can still be `false` until the logger checks the pose.

Once `reached()` is `true`, it stays true for that registration. A retriggerable waypoint can leave tolerance, re-enter it, or eventually time out and still have `reached() == true`. To check current alignment, read `getOffset()` with a valid pose and compare it with the tolerances.

### `timedOut()`

`bool timedOut() const` stays `false` until a logger check finds an active waypoint at or past its configured deadline. It becomes `true` on that check, stays true, and the waypoint becomes inactive. It remains false for a target without a timeout and for a one-shot target that reached before expiry.

Use `timedOut()` to distinguish an expired target from one still waiting to reach. A `false` return by itself covers both a target that is still active and a one-shot target that already succeeded. A retriggerable target can return `true` from both methods. It reached at least once and later finished because its time ran out.

### `WaypointOffset`

`WaypointOffset getOffset() const` combines the error from the current pose with the latest recorded reach and timeout flags. You can read it even after the waypoint becomes inactive. The flags and the current error can describe different moments. For example, the robot can be far from a target it reached earlier.

| Field | What it reports |
| --- | --- |
| `totalOffset` | Straight-line distance to the target. |
| `offX`, `offY` | Target position minus current position along each axis. |
| `offT` | Optional heading error in degrees along the shorter arc, present when pose and a target heading are available. |
| `remainingTimeout` | Optional milliseconds left on the configured timer, clamped to zero. Check `timedOut` for the actual outcome. |
| `reached`, `timedOut` | The same status reported by the handle methods. |

With pose unavailable, the distance and axis offsets default to zero and `offT` is empty. Check odometry before interpreting those zeros as alignment. `remainingTimeout` can reach zero before the logger records a timeout, or after an already successful one-shot reach. Read `timedOut` for the recorded outcome.

## Examples

### Check a position

For a ring pickup, register a position-only target before the drive segment. This records a reach within three inches of the target when odometry is in inches.

```cpp
logger.addWaypoint("Ring Zone", {
  .tarX = 60,
  .tarY = -18,
  .linearTol = 3.0f
});
```

### Check position, heading, and arrival time

Register this just before approaching a goal. It checks whether the robot gets within two inches and eight degrees of the pickup pose within three seconds. The time literal is available with `MVLIB_USE_SIMPLES`. [MVLib Setup](./Setup.md?id=choose-how-to-write-types-and-times)

```cpp
auto goalPickup = logger.addWaypoint("Goal Pickup", {
  .tarX = 48,
  .tarY = -24,
  .tarT = 180,
  .timeoutMs = 3_mvS,
  .linearTol = 2.0f,
  .thetaTol = 8.0f
});
```

Keep the handle to distinguish a pickup that timed out from one that the logger is still tracking. Run this check after the approach, while odometry is available.

```cpp
const auto offset = goalPickup.getOffset();
if (offset.timedOut) {
  logger.warn("Goal pickup timed out, %.1f in from target", offset.totalOffset);
  if (offset.offT) {
    logger.info("Goal pickup heading error %.1f deg", *offset.offT);
  }
} else if (offset.reached) {
  logger.info("Goal pickup pose reached");
}
```

If both flags are false, the logger may still be waiting for a reach or the deadline. The approach ending in your drive code and the logger finishing its waypoint check are separate events.

### Track repeated passes

For a 30-second driving drill, register a retriggerable waypoint so each observed pass can show up in MotionView.

```cpp
logger.addWaypoint("Practice Gate", {
  .tarX = 0,
  .tarY = 0,
  .timeoutMs = 30_mvS,
  .linearTol = 2.0f,
  .retriggerable = true
});
```

Here is what the same drill would report with and without `retriggerable`, assuming the logger observes the poses at the times shown.

| Time since registration | Robot | With `retriggerable = true` | With the default `false` |
| --- | --- | --- | --- |
| 0 s | Outside tolerance | Active. Both flags are false. | Active. Both flags are false. |
| 6 s | First pass | `REACHED`. Still active, with `reached() == true`. | `REACHED`. Inactive, with `reached() == true`. |
| 12 s | Leaves the gate | Still active. `reached()` stays true. | Already finished. |
| 20 s | Passes again | Another `REACHED` event. Still active. | Already finished. |
| 30 s | Drill deadline | `TIMEDOUT`. Inactive, with both flags true. | Inactive. `reached()` stays true and `timedOut()` stays false. |

If the driver misses every pass, either kind can time out at 30 seconds with `reached() == false`.

## Troubleshooting

**The waypoint never reaches.** Check that odometry is updating and that the target uses the same units, origin, and heading convention. Brief passes can happen between checks. If the deadline runs out before the robot moves, register the waypoint closer to the drive command.

**The handle reports a reach, but MotionView shows no event.** Check `setPrintWaypoints(true)` and terminal output. If you connected late, resync active waypoints to make future events identifiable. For an earlier reach, check the SD recording if it was enabled at the time.

**The timer reached zero, but `timedOut()` is still false.** Check `reached()` and `active()`. A successful one-shot waypoint stays reached. An active waypoint can still be waiting for the logger's next update, especially if updates are paused.
