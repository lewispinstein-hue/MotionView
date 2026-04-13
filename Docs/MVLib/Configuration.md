# MVLib Configuration

This page covers the two parts of MVLib configuration:

- `LoggerConfig`, which controls the output behavior
- `LoggerTimings`, which controls timing for polling/flushing behavior

## `LoggerConfig`

`LoggerConfig` is the logger's output configuration struct.

<details>
  <summary><small>View Source Code</small></summary>

```cpp
struct LoggerConfig {
  std::atomic<bool> logToTerminal{true};
  std::atomic<bool> logToSD{true};
  std::atomic<bool> printWatches{true};
  std::atomic<bool> printTelemetry{true};
  std::atomic<bool> printWaypoints{true};
  std::atomic<bool> logSystemInfo{true};
};
```
</details>

All five settings default to `true`.

These values are mostly exposed through logger setter functions such as:

```cpp
logger.setLogToTerminal(true);
logger.setLogToSD(true);
logger.setPrintWatches(true);
logger.setPrintTelemetry(true);
logger.setPrintWaypoints(true);
logger.setLogSystemInfo(true);
```

That is how you should change them.

## Output Settings

### `logToTerminal`

Controls whether MVLib writes logs to the PROS terminal.

Use it when:

- you want live output while testing
- you want MotionView data to be visible through terminal logging

Turn it off when:

- you want less output noise
- you are narrowing a problem to SD-only logging
- terminal traffic is becoming a problem during testing

Notes:
- If this is off, you lose the easiest live view of what MVLib is doing.
- Leave this on unless you have a clear reason to reduce terminal output.

### `logToSD`

Controls whether MVLib writes logs to the SD card.

Use it when:

- you want logs saved for later review
- you want to compare runs after the robot stops

Turn it off when:

- you are not using an SD card
- you want to avoid SD writes entirely during testing

Notes:
- SD logging may become locked after `logger.start()` if MVLib detects a failure. That means toggling SD behavior after startup may not work the way you expect.
- Decide whether you want SD logging before `logger.start()`. If you are not using SD logs, disabling is the best option.

### `printWatches`

Controls whether registered watches are printed.

Use it when:

- you want values like battery, RPM, current draw, or auton state to appear in MotionView

Turn it off when:

- watch output is drowning out other signals
- you want to focus on path or waypoint behavior only

Notes:
- If this is off, your watches still exist, but they will not produce the output you added them for until you turn it back on.
- Leave it on in normal use. Turn it off temporarily when debugging something narrower.

### `printTelemetry`

Controls whether MVLib prints periodic telemetry.

This is the output MotionView uses for ongoing robot state such as pose and related telemetry.

Turn it off when:

- you only care about watches
- you want to isolate whether a problem is coming from telemetry output or another part of the logger

Notes:
- If this is off, MotionView loses the main telemetry stream. Watches will still update, but path and pose-driven features will not update.
- Leave this on unless you are intentionally disabling telemetry for a test.

### `printWaypoints`

Controls whether waypoint events are printed.

Use it when:

- you want MotionView to show waypoint creation, reached, timedout, and offset events

Turn it off when:

- you are not using waypoints
- waypoint spam is making other output harder to read

Notes:
- If this is off, waypoints can still exist in your code, but MotionView will not receive the waypoint event stream and your robot will not compute waypoint-based telemetry.
- Keep it on if you are using `logger.addWaypoint(...)`.

### `logSystemInfo`

Controls whether MVLib will log information related to its own operation.

Use it when:

- you want to know what MVLib is doing
- you're setting up / debugging MVLib

Turn it off when:

- you don't need (or don't care) to know what MVLib is doing
- you don't want to clutter the MotionView GUI with system prints

## Timing Settings

<details>
  <summary><small>View Source Code</small></summary>

```cpp
struct LoggerTimings {
  uint32_t sd_buffer_flush_interval = 1000;
  uint32_t sd_polling_rate = 80;
  uint32_t terminal_polling_rate = 120;
};
```
</details>

### `sd_buffer_flush_interval`

Default: `1_mvS`

This controls how often buffered SD output is flushed from RAM to the SD card.

Lower values:

- save data to the card more often
- reduce how much buffered data is waiting in memory
- but also lead to possible loss of information from crash or interruption

Higher values:

- reduce flush frequency
- may be gentler on performance

Warning:
- Extremely aggressive flushing can add unnecessary overhead. The default is a good starting point. Only change this if you know why you're doing it.

### `terminal_polling_rate`

Default: `120_mvMs`

This controls how often MVLib polls for new data and emits terminal-facing output.

Note:
- If MVLib is logging to both terminal and SD, the terminal polling rate wins.

Lower values:

- make telemetry feel more responsive
- increase output frequency

Higher values:

- reduce overhead
- reduce log traffic

Risk:

- This is a dangerous setting to push too low. An overly fast terminal polling rate can overwhelm the brain-to-controller connection, causing lag or even dropped communication.

- Leave this alone unless you have measured reason to change it.
- If you do tune it, change it cautiously and test on real hardware.

### `sd_polling_rate`

Default: `80_mvMs`

This controls how often MVLib writes new data into the SD buffer.

It does not directly control flush timing. Flush timing is handled by `sd_flush`.

Lower values:

- make SD-side updates happen more often
- increase background work

Higher values:

- reduce SD-side activity
- may reduce task pressure

Notes:
- Pushing this too low may starve other tasks or create avoidable overhead. Keep the default unless you are tuning SD behavior specifically.
