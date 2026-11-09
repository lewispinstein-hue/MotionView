# Planning Template

<p align="left">
    <img src="assets/MotionView/PlanningDocs/PlanningExportTemplate.png" alt="Planning export template editor" width="700" />
</p>

Use Planning export templates to turn a route into calls for your robot's drive library. Write the code for a motion once and use placeholders for the coordinates, heading, speed, and other values that change along the route.

## Purpose

MotionView exports the segments between waypoints. For each segment, it uses the motions assigned to the departure waypoint, in their listed order. Each motion uses its template or its individual code override. All motions on that segment share the same placeholder values.

Custom event methods appear in timeline order. Methods placed before the first waypoint are exported before any motion. Methods placed in the gap between two waypoints are exported after that segment's motion code. Placed method code and any override on that placement can use the same placeholders as motion templates.

## Supported Template Variables

Use either the long form or its shorthand. For example, `${theta}` and `@th` produce the same value, and you can mix both forms in one template.

| Long form | Shorthand | In motion code for a segment | In a placed custom method |
| --- | --- | --- | --- |
| `${x}` | `@x` | Destination waypoint's X coordinate. | Context waypoint's X coordinate. |
| `${y}` | `@y` | Destination waypoint's Y coordinate. | Context waypoint's Y coordinate. |
| `${theta}` | `@th` | Destination waypoint's heading in degrees. | Context waypoint's heading in degrees. |
| `${distance}` | `@dist` | Straight-line distance from departure to destination, in Planning's coordinate units. | Straight-line distance from the previous waypoint to the context waypoint. At the first waypoint this is `0`. |
| `${iteration}` | `@iter` | Zero-based segment index. The first segment is `0`, even if it contains several motions. | Zero-based index of the context waypoint. |
| `${speed}` | `@spd` | Maximum speed setting at the departure waypoint, exported as a whole number on the Planning power scale, where `127` is full power. | Maximum speed setting at the context waypoint. |
| `${minSpeed}` | `@minspd` | Minimum speed setting at departure. Defaults to `0` and is capped by the maximum speed setting. | Minimum speed setting at the context waypoint. |
| `${forwards}` | `@fwd` | Boolean for whether the robot drives forward from departure to destination. | Boolean for travel from the context waypoint to the next waypoint. |
| `${lead}` | `@ld` | Boomerang lead at departure, from `0` to `1`, used to shape the approach. Defaults to `0.6` for a boomerang without a lead setting and `0` when no lead applies. | Boomerang lead at the context waypoint. |
| `${lockedDriveSide}` | `@side` | The selected template library's code for the locked side of the first Swing motion at departure. Defaults to the library's Locked Left value. | The same lookup at the context waypoint. |
| `${bearing}` | `@bearing` | The heading the robot should face for a straight drive along the segment, in degrees. Includes a 180° adjustment for reverse travel. | The facing heading for travel from the context waypoint to the next waypoint. |

For a placed method, the **context waypoint** is the waypoint immediately to its left on the timeline. A method placed before the first waypoint uses that first waypoint. For example, a method placed between A and B uses A's coordinates even though it appears after the A-to-B motion code in the export.

### Choose a heading and direction

Use `@th` when the command should turn to the heading set on the destination waypoint. Use `@bearing` when the command should face along a straight drive to the destination. For example, an eastbound drive has a bearing of 90° going forward or 270° going backward, regardless of the destination waypoint's heading. For a zero-distance segment, `@bearing` uses the departure heading.

`@fwd` uses the direction set on the departure waypoint when you choose one. Otherwise, MotionView infers direction from the waypoint's heading relative to the segment. The output is `true` or `false` in C++ and `True` or `False` in Python.

## Output Rules

- Templates can span multiple lines. Substitution applies to motion templates, individual motion overrides, and placed method code. Export headers and footers are added as written.
- Shorthands are case-sensitive. Keep them separate from letters, digits, and underscores. Use `${iteration}` in a name such as `point_${iteration}`, where `point_@iter` would stay unchanged.
- Unknown placeholders stay as written. Code inserted by `@side` is used as written, including any placeholder-like text it contains.

## Example

Suppose the route has these waypoints and uses one drive motion per segment.

| Waypoint | X | Y | Heading | Max speed | Min speed | Outgoing direction |
| --- | --- | --- | --- | --- | --- | --- |
| Start | 0 | 0 | 0° | 50 | 10 | Forward |
| Corner | 0 | 10 | 0° | 80 | 25 | Backward |
| Finish | 10 | 10 | 90° | 100 | 0 | — |

Motion template:

```cpp
driveSegment(@x, @y, @bearing, @th, @dist, @spd, @minspd, @fwd); // Segment ${iteration}
```

Place a custom method with the code `markPosition(@iter, @x, @y);` between **Start** and **Corner** on the timeline. The generated method call follows the first motion and uses **Start** as its context.

```cpp
driveSegment(0, 10, 0, 0, 10, 50, 10, true); // Segment 0
markPosition(0, 0, 0);
driveSegment(10, 10, 270, 90, 10, 80, 25, false); // Segment 1
```

The second drive uses the corner's speed settings and the finish's coordinates. Its bearing is 270° because the robot backs east, while the destination heading is still 90°.
