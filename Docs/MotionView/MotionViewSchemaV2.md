# MotionView Schema v2

This document describes the canonical JSON schema that MotionView v2 exports and is expected to consume for `.json` route files.

MotionView's importer is somewhat permissive, but if you are generating files for MotionView you should target the canonical shape below.

## Top-Level Shape

```json
{
  "poses": [],
  "watches": [],
  "logs": [],
  "waypoints": [],
  "meta": {}
}
```

## Import Rules

- The file must be valid JSON.
- At least one valid entry must exist in one of: `poses`, `watches`, `logs`, or `waypoints`.
- `meta` is optional.
- MotionView does not currently reject files if `meta.SchemaVersion` is missing, but v2 files should set it to `2`.

## Canonical Schema

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
    "WaypointEvents": 2
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

- Canonical export uses `poses`, but import also accepts `robot-path`.
- Canonical export uses `watches`, but import also accepts `watch`.
- Canonical export uses `logs`, but import also accepts `log`.
- Import is tolerant of several field aliases for watches and logs, but these are compatibility paths, not the v2 canonical schema.
