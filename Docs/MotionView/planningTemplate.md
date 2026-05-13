# Planning Template


This document defines the Planning mode export template system used by MotionView.
Used for visually generating autonomous routines for the robot to follow. Completely platform and language-agnostic — can be used for any robot, any language, and any IDE.

## Purpose

Planning export templates generate one output line per planned waypoint.

MotionView processes waypoints sequentially from first to last. For each waypoint, MotionView evaluates the template once and replaces all supported template variables with the values for that waypoint.

The generated result is the full exported code block.

## Per-Waypoint Generation

For a planned path with `N` waypoints:

- MotionView loops through all `N` waypoints in order
- MotionView generates one line of output for each waypoint
- The template text is reused for every waypoint
- Variable replacement is performed independently for each waypoint
- The final export is the generated lines joined in order


**Notes:**

- The template may contain arbitrary text, including newlines.
- The template is evaluated once per waypoint and the resulting blocks are concatenated in order.

## Supported Template Variables

### `${x}`

The waypoint x-position.

- Source: the current waypoint's stored `x` value
- Unit: the current Planning mode coordinate unit
- Scope: current waypoint

### `${y}`

The waypoint y-position.

- Source: the current waypoint's stored `y` value
- Unit: the current Planning mode coordinate unit
- Scope: current waypoint

### `${theta}`

The waypoint heading.

- Source: the current waypoint's stored heading value
- Unit: degrees
- Scope: current waypoint

### `${distance}`

The distance from the previous waypoint to the current waypoint.

- Source: calculated from the current waypoint and the previous waypoint
- Unit: the current Planning mode coordinate unit
- Scope: current waypoint

Calculation rules:

- For the first waypoint, `${distance}` is `0`
- For every later waypoint, `${distance}` is the straight-line distance from the previous waypoint
- Distance is calculated using the previous waypoint and current waypoint positions only

### `${iteration}`

The current waypoint index.

- Source: the current waypoint position in the planning path
- Type: integer
- Scope: current waypoint

Calculation rules:

- 0-based indexing is used: the first waypoint has an index of `0`, the second waypoint has an index of `1`, etc.

### `${speed}`

The waypoint speed value.

- Source: the current waypoint's stored `speed` field
- Range: `-127` to `127`
- Scope: current waypoint

## Output Rules

- One template pass produces one output line
- One waypoint produces one output line
- Waypoints are exported in planning order
- Variable replacement is text substitution
- Unsupported text is left unchanged

## Example

Waypoints:

```cpp
{
  [.x = 0, .y = 0, .theta = 0, .speed = 50],
  [.x = 0, .y = 10, .theta = 0, .speed = 50],
  [.x = 10, .y = 10, .theta = 90, .speed = 80]
}
```

Template:

```cpp
moveToPoint(${x}, ${y}, ${theta}, {.targetSpeed = ${speed}}); // Distance: ${distance}, Iteration: ${iteration}
```

Generated output:

```cpp
moveToPoint(0, 0, 0, {.targetSpeed = 50}); // Distance: 0, Iteration: 0
moveToPoint(0, 10, 0, {.targetSpeed = 50}); // Distance: 10, Iteration: 1
moveToPoint(10, 10, 90, {.targetSpeed = 80}); // Distance: 10, Iteration: 2
```
