# MotionView Schema v2

This document describes the canonical JSON schema that MotionView v2 exports and is expected to consume for `.json` route files.

MotionView's importer is somewhat permissive, but if you are generating files for MotionView you should target the canonical shape below.

## Top-Level Shape

```json
{
  "planned-path": [],
  "planned-export-template": "",
  "planned-objects": [],
  "planned-nodes": [],
  "poses": [],
  "watches": [],
  "logs": [],
  "waypoints": [],
  "meta": {}
}
```

## Import Rules

- The file must be valid JSON.
- At least one valid entry must exist in one of: `planned-path`, `planned-objects`, `poses`, `watches`, `logs`, or `waypoints`.
- `meta` is optional.
- MotionView does not currently reject files if `meta.SchemaVersion` is missing, but v2 files should set it to `2`.

Planning-mode notes:

- `planned-path`, `planned-objects`, and `planned-nodes` are optional.
- `planned-export-template` is optional. If omitted or empty, MotionView falls back to its built-in default planning waypoint export template.
- `planned-nodes` reference methods by id, so `planned-objects` should be present if `planned-nodes` is present.
- Multiline strings are stored as standard JSON strings. In serialized JSON, line breaks appear as escaped newline sequences such as `\n`, and MotionView restores them back to real newlines when the file is loaded.

## Canonical Schema

### `planned-path`

`planned-path` is an ordered array of planning-mode waypoints.

```json
{
  "x": 0,
  "y": 0,
  "theta": 0,
  "speed": 127
}
```

Fields:

- `x`: number
  - Required.
- `y`: number
  - Required.
- `theta`: number
  - Optional. Defaults to `0`.
- `speed`: number
  - Optional. Defaults to `127`.
  - MotionView clamps the stored value to the waypoint-speed range `[-127, 127]`.

Notes:

- `planned-path` is the canonical planning route shape used by MotionView when saving planning data.
- Waypoints are stored in placement order.

### `planned-export-template`

`planned-export-template` is the Planning mode waypoint export template used by `Copy Code`.

```json
"planned-export-template": "chassis.moveToPoint(${x}, ${y}, ${theta}, {.maxSpeed = someMathFunctionToGetSpeed(${distance});"
```

Fields:

- `planned-export-template`: string
  - Optional.
  - If omitted or empty, MotionView uses its built-in default template.

Notes:

- This template is applied once per planning waypoint.
- The string may contain real line breaks in memory. In the JSON file, those line breaks are represented by escaped `\n` sequences.
- Supported template variables are documented separately in [PlanningTemplate.md](/Users/David/Documents/Tauri%20Live%20Viewer/Docs/MotionView/PlanningTemplate.md).

### `planned-objects`

`planned-objects` is an array of reusable planning event objects. Each object owns its methods.

```json
{
  "id": "plan-object-abc123",
  "name": "Piston 1",
  "color": "#6d8fb3",
  "latestMethod": "Extend",
  "methods": [
    {
      "id": "plan-method-def456",
      "name": "Extend",
      "code": "p1.set_value(true)"
    }
  ]
}
```

Fields:

- `id`: string
  - Required.
  - Should be unique within the file.
- `name`: string
  - Required in practice. MotionView allows an empty string internally while editing, but persisted objects should have a name.
- `color`: string or `null`
  - Optional. Hex color used for node rendering.
  - If omitted or `null`, MotionView falls back to its default muted planning palette.
- `latestMethod`: string
  - Optional. Defaults to `""`.
  - Used by the UI as the latest-called method display for that object.
- `methods`: array of planning methods
  - Optional. Defaults to `[]`.

Method fields:

```json
{
  "id": "plan-method-def456",
  "name": "Extend",
  "code": "p1.set_value(true)"
}
```

- `id`: string
  - Required.
  - Should be unique within the owning object.
- `name`: string
  - Required in practice.
- `code`: string
  - Optional. Defaults to `""`.
  - Export emits this string exactly as stored when a node references the method.

Notes:

- Method code may be multiline.
- In serialized JSON, multiline code is stored as a normal JSON string with escaped newline sequences such as `\n`.

### `planned-nodes`

`planned-nodes` is an array of placed planning-timeline nodes. Each node references one method from one object and stores its position in sequence order relative to the planning waypoints.

```json
{
  "id": "plan-node-ghi789",
  "objectId": "plan-object-abc123",
  "methodId": "plan-method-def456",
  "beforeWaypoint": 1,
  "index": 0
}
```

Fields:

- `id`: string
  - Required.
  - Should be unique within the file.
- `objectId`: string
  - Required.
  - Must reference a valid `planned-objects[].id`.
- `methodId`: string
  - Required.
  - Must reference a valid method id within the referenced object.
- `beforeWaypoint`: integer
  - Required.
  - Bucket index describing where the node appears:
    - `0`: before waypoint `1`
    - `1`: between waypoint `1` and waypoint `2`
    - `2`: between waypoint `2` and waypoint `3`
    - `N`: after waypoint `N`, where `N` is the waypoint count
- `index`: integer
  - Required.
  - Zero-based order within that bucket.

Notes:

- MotionView normalizes node ordering inside each bucket during import/save.
- If a referenced object or method is missing, the node is discarded.
- If all planning waypoints are removed, MotionView clears all planning nodes.

### `poses`

`poses` is an array of robot pose samples ordered by time.

```json
{
  "t": 0,
  "x": 0,
  "y": 0,
  "theta": 0,
  "l_vel": 0,
  "r_vel": 0,
  "speed": 0
}
```

Fields:

- `t`: number or `null`
  - Time in milliseconds.
- `x`: number
  - Required.
- `y`: number
  - Required.
- `theta`: number
  - Optional. Defaults to `0`.
- `l_vel`: number or `null`
  - Optional.
- `r_vel`: number or `null`
  - Optional.
- `speed`: number
  - Exported as raw speed. Optional on import. If omitted, MotionView falls back to `speed_raw` or `0`.

Notes:

- Import also accepts top-level key `robot-path` instead of `poses`.
- On import, entries without numeric `x` and `y` are discarded.
- Poses are sorted by `t`.

### `watches`

`watches` is an array of watch/value snapshots.

```json
{
  "t": 0,
  "id": 1,
  "visible": true,
  "level": "INFO",
  "label": "DriveTemp",
  "value": "42"
}
```

Fields:

- `t`: number
  - Required.
- `id`: integer or `null`
  - Optional.
- `visible`: boolean
  - Optional. Defaults to `true`.
- `level`: string
  - Optional. Defaults to `"INFO"`.
- `label`: string
  - Optional. Defaults to `""`.
- `value`: string
  - Optional. Defaults to `""`.

Importer aliases:

- `watch` instead of `watches`
- `timestamp`, `time`, or `ms` instead of `t`
- `watchId` instead of `id`
- `lvl` or `severity` instead of `level`
- `name` instead of `label`
- `val` or `message` instead of `value`

### `logs`

`logs` is an array of log messages.

```json
{
  "t": 0,
  "level": "INFO",
  "label": "Planner",
  "value": "Path started"
}
```

Fields:

- `t`: number
  - Required.
- `level`: string
  - Optional. Defaults to `"INFO"`.
- `label`: string
  - Optional. Defaults to `""`.
- `value`: string
  - Required in practice. Empty log messages are discarded.

Notes:

- Export uses `value` for the message body.
- If a log is considered a MotionView system log, export prefixes the value with `[MVLIB] `.

Importer aliases:

- `log` instead of `logs`
- `timestamp`, `time`, or `ms` instead of `t`
- `lvl` or `severity` instead of `level`
- `message` or `val` instead of `value`

### `waypoints`

`waypoints` is an array of waypoint records. Each waypoint contains an event timeline.

```json
{
  "id": 3,
  "name": "Goal Rush",
  "events": [
    {
      "t": 1200,
      "type": "CREATED",
      "id": 3,
      "name": "Goal Rush",
      "params": {
        "tarX": 48,
        "tarY": 24,
        "tarT": 90,
        "linearTol": 2,
        "thetaTol": 5,
        "timeoutMs": 1500,
        "retriggerable": false
      }
    },
    {
      "t": 2200,
      "type": "REACHED",
      "id": 3,
      "name": "Goal Rush",
      "params": {
        "remainingTime": 250
      }
    }
  ]
}
```

Waypoint fields:

- `id`: integer
  - Required.
- `name`: string
  - Optional but strongly recommended.
- `events`: array of waypoint events
  - Required for a usable waypoint.

Waypoint event fields:

- `t`: number
  - Required.
- `type`: string
  - Required. Supported values are:
    - `CREATED`
    - `REACHED`
    - `TIMEDOUT`
- `id`: integer or `null`
  - Should match the parent waypoint id.
- `name`: string
  - Optional but recommended.
- `params`: object
  - Required for `CREATED`.
  - Optional for `REACHED` and `TIMEDOUT`.

`CREATED` params:

```json
{
  "tarX": 48,
  "tarY": 24,
  "tarT": 90,
  "linearTol": 2,
  "thetaTol": 5,
  "timeoutMs": 1500,
  "retriggerable": false
}
```

- `tarX`: number, required
- `tarY`: number, required
- `tarT`: number, optional
- `linearTol`: number, optional
- `thetaTol`: number, optional
- `timeoutMs`: number, optional
- `retriggerable`: boolean, optional

`REACHED` params:

```json
{
  "remainingTime": 250
}
```

- `remainingTime`: number, optional

`TIMEDOUT` params:

```json
{}
```

Notes:

- For a waypoint to be accepted, MotionView must be able to find a `CREATED` event with `params.tarX` and `params.tarY`.
- Events are sorted by `t`.
- Waypoints without usable events are discarded.

### `meta`

`meta` is optional, but MotionView v2 exports the following structure:

```json
{
  "SchemaVersion": 2,
  "CreationDate": "30/04/2026, 14:15:16",
  "AppVersion": "0.1.0",
  "Creator": "MotionView",
  "PathName": "Untitled Path",
  "Stats": {
    "PoseCount": 2,
    "WatchCount": 0,
    "LogCount": 0,
    "WaypointCount": 1,
    "WaypointEvents": 2,
    "PlannedWaypointCount": 0,
    "PlannedObjectCount": 0,
    "PlannedNodeCount": 0
  },
  "Times": {
    "StartTime": "0.00s",
    "EndTime": "1.00s",
    "DurationTimeMs": 1000
  },
  "ViewingSettings": {
    "Units": "in",
    "SelectedField": "v5_match_field_2025-2026_pushback",
    "PathOffsets": {
      "X": 0,
      "Y": 0,
      "Theta": 0
    },
    "RobotDimensions": {
      "Width": 12,
      "Height": 12
    },
    "SpeedNorm": {
      "Minimum": 0,
      "Maximum": 127
    }
  }
}
```

Recognized by the importer:

- `meta.ViewingSettings.Units`
- `meta.ViewingSettings.SelectedField`
- `meta.ViewingSettings.PathOffsets.X`
- `meta.ViewingSettings.PathOffsets.Y`
- `meta.ViewingSettings.PathOffsets.Theta`
- `meta.ViewingSettings.RobotDimensions.Width`
- `meta.ViewingSettings.RobotDimensions.Height`
- `meta.ViewingSettings.SpeedNorm.Minimum`
- `meta.ViewingSettings.SpeedNorm.Maximum`

Other `meta` fields are currently informational.

## Minimal Valid Example

```json
{
  "planned-path": [],
  "planned-export-template": "",
  "planned-objects": [],
  "planned-nodes": [],
  "poses": [
    {
      "t": 0,
      "x": 0,
      "y": 0,
      "theta": 0
    },
    {
      "t": 1000,
      "x": 24,
      "y": 12,
      "theta": 90
    }
  ],
  "watches": [],
  "logs": [],
  "waypoints": [],
  "meta": {
    "SchemaVersion": 2,
    "Creator": "MotionView"
  }
}
```

## Compatibility Notes

- Canonical export/save may include `planned-path`, `planned-objects`, and `planned-nodes` for Planning mode state.
- Canonical export/save may include `planned-export-template` for the Planning mode waypoint export template.
- The export modal may produce viewing-only, planning-only, or combined files. When exporting a single mode, unrelated top-level sections may be omitted.
- Canonical export uses `poses`, but import also accepts `robot-path`.
- Canonical export uses `watches`, but import also accepts `watch`.
- Canonical export uses `logs`, but import also accepts `log`.
- Import is tolerant of several field aliases for watches and logs, but these are compatibility paths, not the v2 canonical schema.
