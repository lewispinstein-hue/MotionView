# MotionView API
This doc covers what types of data MotionView can consume, what behavior that will lead to, and examples. See also [MVLib](../Guides/MVLib/README.md) for a working implementation example.

### Notes for this doc
- Anything before the type tag is parsed and removed by MotionView. 
- The type is decided by the first occurrence of a tag in a log. As of MotionView v1.0.0, the following tags are supported:
```json
[POSE]   # This data is interpreted by MotionView as the current location of the robot. 
[WATCH]  # This data is interpreted by MotionView as watch log.
[LOG]    # This data is interpreted by MotionView as a log message
[WPOINT] # This data is interpreted by MotionView as a waypoint.
```


### [POSE] Data
Expected format:

```log
[POSE],uptime,x,y,theta,l_vel,r_vel
```

- `uptime`: The time since the robot booted in milliseconds
- `x`: The x position of the robot in any supported unit
- `y`: The y position of the robot in any supported unit
- `theta`: The angle of the robot in degrees
- `l_vel`: The velocity of the left drivetrain. Expected to be (±127), however the user can manually set the speed normalization range
- `r_vel`: Same as `l_vel`, but for the right drivetrain

Example:

```log
[12.43] [INFO]: [POSE],12342,0,0,90,10,-10
```

Parsed as:
```json
{
  "t": 12432,
  "x": 0,
  "y": 0,
  "theta": 90,
  "l_vel": 10,
  "r_vel": -10
}
```

This type of data is used by MotionView to draw the robot. 

### [WATCH] Data
Expected format:

```log
[WATCH],uptime,level,id,label,value
```

- `uptime`: The time since the robot booted in milliseconds
- `level`: The log level of the watch (DEBUG, INFO, WARN, ERROR, FATAL)
- `label`: The label/name of the watch
- `value`: The value of the watch

Example:

```log
[12.43] [INFO]: [WATCH],12342,INFO,7,"Tongue mech state",true
```

Parsed as:
```json
{
  "t": 12432,
  "level": "INFO",
  "id": 7,
  "label": "Tongue mech state",
  "value": "true"
}
```

MotionView will format the data, and then add the watch to the Watches list of the Viewing mode sidebar.

### [LOG] Data
Expected format:

```log
[LOG],uptime,level,message
```

- `uptime`: The time since the robot booted in milliseconds
- `level`: The log level of the log (DEBUG, INFO, WARN, ERROR, FATAL)
- `message`: The message of the log

The message of the log can contain commas, as anything after the 3rd comma is considered part of the message and parsed as so.

Example:

```log
[12.43] [INFO]: [LOG],12342,INFO,This is a log message
```

Parsed as:
```json
{
  "t": 12432,
  "level": "INFO",
  "message": "This is a log message"
}
```

MotionView will format the data, and then add the log to the Logs list of the Viewing mode sidebar.

### [WPOINT] Data
Waypoints are stateful. Unlike `[POSE]`, `[WATCH]`, or `[LOG]`, MotionView does not treat each waypoint line as an isolated record. Instead, all `[WPOINT]` lines with the same `id` are grouped into one waypoint object, and MotionView keeps track of that waypoint's current state, event history, field marker, and click-to-jump behavior.

Expected format:

```log
[WPOINT],uptime,eventType,id,wpointName,params...
```

- `uptime`: The time since the robot booted in milliseconds
- `eventType`: One of `CREATED`, `OFFSET`, `REACHED`, or `TIMEDOUT`
- `id`: The integer waypoint ID
- `wpointName`: The human-readable waypoint name. This must not contain commas.
- `params...`: Event-specific parameters described below

If the line does not contain the required comma structure, MotionView treats it as malformed, ignores it for parsing, and leaves it in the live console with the red error prefix.

#### `CREATED`

Expected format:

```log
[WPOINT],uptime,CREATED,id,wpointName,targetX,targetY,targetT|NA,timeoutMs|NA,linearTolerance,thetaTolerance|NA,retriggerable
```

- `targetX`: Target x position
- `targetY`: Target y position
- `targetT`: Target heading in degrees, or `NA`
- `timeoutMs`: Timeout in milliseconds, or `NA`
- `linearTolerance`: Linear tolerance
- `thetaTolerance`: Angular tolerance in degrees, or `NA`
- `retriggerable`: `0` or `1`

Example:

```log
[12.32] [INFO]: [WPOINT],12342,CREATED,4,Park Zone,60,0,180,NA,2,5,1
```

Parsed as:

```json
{
  "t": 12342,
  "type": "CREATED",
  "id": 4,
  "name": "Park Zone",
  "params": {
    "tarX": 60,
    "tarY": 0,
    "tarT": 180,
    "timeoutMs": null,
    "linearTol": 2,
    "thetaTol": 5,
    "retriggerable": true
  }
}
```

MotionView uses `CREATED` to create or replace the waypoint with that `id`. The waypoint is placed on the field immediately at its target location and remains there until cleared. If the same `id` appears later with a new `CREATED` event, MotionView treats that as a new session for that waypoint and drops the old waypoint state and history.

#### `OFFSET`

Expected format:

```log
[WPOINT],uptime,OFFSET,id,wpointName,offsetX,offsetY,offsetT|NA,remainingTime|NA
```

- `offsetX`: Current x error from the waypoint target
- `offsetY`: Current y error from the waypoint target
- `offsetT`: Current angular error, or `NA`
- `remainingTime`: Remaining timeout in milliseconds, or `NA`

Example:

```log
[15.80] [INFO]: [WPOINT],15800,OFFSET,4,Park Zone,1.25,-0.50,3.0,420
```

MotionView stores the event in the waypoint's event history and shows it in the sidebar. It does not move the field marker, because field markers always stay at the original target location from `CREATED`.

#### `REACHED`

Expected format:

```log
[WPOINT],uptime,REACHED,id,wpointName,offsetX,offsetY,offsetT|NA,remainingTime|NA
```

Example:

```log
[16.59] [INFO]: [WPOINT],16585,REACHED,4,Park Zone,0.10,0.00,1.0,150
```

MotionView stores the event and marks the waypoint as reached. For normal waypoints, `REACHED` is terminal and deactivates the waypoint. For retriggerable waypoints (`retriggerable = 1`), `REACHED` does not deactivate the waypoint, so it can continue receiving future `OFFSET` or `REACHED` events.

#### `TIMEDOUT`

Expected format:

```log
[WPOINT],uptime,TIMEDOUT,id,wpointName,offsetX,offsetY,offsetT|NA,remainingTime|NA
```

Example:

```log
[19.25] [INFO]: [WPOINT],19250,TIMEDOUT,4,Park Zone,4.40,1.20,NA,0
```

MotionView stores the event and always treats `TIMEDOUT` as terminal. This deactivates the waypoint even if it was retriggerable.

#### How MotionView handles waypoint state

- All events are grouped by `id`
- The field marker is drawn at the target position from the `CREATED` event
- Active waypoints are shown with the active state pill and active field marker styling
- Inactive waypoints stay visible on the field, but are greyed out
- Retriggerable waypoints use the `RETRIGGERABLE` state pill instead of `ACTIVE` or `INACTIVE`
- If a retriggerable waypoint times out, the `RETRIGGERABLE` state pill uses a dark grey background to reflect that terminal state
- The sidebar shows all waypoint events in chronological order with `CREATED` at the top
- The filter menu supports `All`, `Active`, and individual waypoint names
- Selecting `Active` filters both the sidebar list and field markers to only active waypoints

#### Clicking and jumping behavior

- Clicking a waypoint in the sidebar or on the field selects and highlights that waypoint
- MotionView jumps to the closest logged pose that occurred while the waypoint was active
- The active interval is `CREATED.time <= pose.time <= terminalEvent.time`
- For retriggerable waypoints that have not timed out, the active interval continues indefinitely
- If there are no poses during the active interval, MotionView highlights the waypoint but does not move the robot

#### Notes

- `NA` values are accepted where shown above and are stored as unset values
- Fields with unset values are omitted from MotionView's formatted waypoint details
- Unknown waypoint IDs on non-`CREATED` events are ignored
- Waypoint names must not contain commas
