# MVLib SD Logging

SD logging saves logs, watches, waypoints, and pose data for later review. Use it for matches, untethered practice, or a backup of a live session. Open the saved file in MotionView to review the data together. [Configuration](./Configuration.md#choose-live-sd-or-both)

## API reference

### Startup settings

| Method | When to use it |
| --- | --- |
| `void setLogToSD(bool enabled)` | SD logging is on by default. Pass `false` before `start()` for a live-only run. |
| `void setBuildDate(const char* buildDate)` | Pass `__DATE__` before `start()` when MVLib might generate a filename. MVLib uses the build date if the Brain's clock is unreliable. If you skip this call, it uses the library's build date. |

### `setLoggingLocation(...)`

```cpp
bool setLoggingLocation(const char* location,
                        MissingFolderPolicy folderPolicy = MissingFolderPolicy::useRoot,
                        ExistingFilePolicy filePolicy = ExistingFilePolicy::automatic);
```

Call this before `start()` to choose a folder or an explicit filename. A folder produces a new filename for each run. The default location is the SD card root.

The call resolves the destination using the card present at setup. It returns `true` if it accepts the destination, including a fallback. The file opens later during `start()`. Use the startup message to confirm the file opened and find its actual path. Keep the same card in place through startup.

- Start the path with `/` and leave off the Brain's `/usd` prefix.
- Use an existing folder, such as `/logs`. Folder segments cannot contain dots. A path without a file extension, such as `/logs/match`, is treated as a folder.
- Use a filename with a name and extension, such as `/logs/match.log`.
- The resolved folder path can be up to 23 bytes. The resolved explicit file path can be up to 127 bytes. Both limits include the leading slash.

### Folder and file policies

MVLib resolves the folder first. It checks the file policy only when you specify a filename that already exists in the resolved folder.

| Policy | Effect |
| --- | --- |
| `MissingFolderPolicy::useRoot` | If the folder is missing, use the card root and resolve the filename there. This is the default. |
| `MissingFolderPolicy::disable` | If the folder is missing, disable SD logging and return `false`. |
| `ExistingFilePolicy::automatic` | If the file exists, keep it and generate a new filename in the resolved folder. This is the default. |
| `ExistingFilePolicy::overwrite` | If the file exists, replace its contents when logging starts. |
| `ExistingFilePolicy::disable` | If the file exists, disable SD logging and return `false`. |

The policy types are in `mvlib`. The aliases on `mvlib::Logger` also work. `MVLIB_USE_SIMPLES` lets you write the names without qualification.

### Respond to a failed setup

A `false` return can mean different things. Check the path and which policy you selected before deciding whether to retry.

- For a malformed path, fix the path and retry before `start()`. MVLib can still use a previously accepted destination or its default if you continue without correcting the call.
- If a `disable` policy is triggered, SD recording is disabled for this program run. For example, if `/telemetry` is missing and you chose `MissingFolderPolicy::disable`, create the folder and restart the program. Calling `setLogToSD(true)` in the same run will not recover the recording.
- If the destination was accepted but the file cannot open at startup, or a write fails later, fix the card or destination and restart the program. Live output can continue if enabled. Keep the logger at `INFO` with system messages enabled during setup to see the file path and any errors.

## Examples

### Save each run to its own file

Create `/telemetry` on the card and add the following to logger setup. A missing folder falls back to the root.

```cpp
logger.setBuildDate(__DATE__);
if (!logger.setLoggingLocation("/telemetry")) {
  logger.warn("Could not select the /telemetry SD log destination");
}
logger.start();
```

Pass `mvlib::MissingFolderPolicy::disable` as the second argument if the run must be recorded in that folder.

### Reuse a filename for the latest run

Use `overwrite` if you always want to open the same file after practice and only need the latest run.

```cpp
const bool accepted = logger.setLoggingLocation("/telemetry/match.log",
  mvlib::MissingFolderPolicy::disable,
  mvlib::ExistingFilePolicy::overwrite);
if (!accepted) {
  logger.warn("Could not select /telemetry/match.log");
}
```

### Keep the old file when a fixed name is taken

Use `automatic` if you prefer `match.log` for a first run and want to keep it when recording again. This example also allows recording in the root if the folder is missing.

```cpp
logger.setBuildDate(__DATE__);
logger.setLoggingLocation("/telemetry/match.log",
  mvlib::MissingFolderPolicy::useRoot,
  mvlib::ExistingFilePolicy::automatic);
```

If `/telemetry` exists, MVLib uses `/telemetry/match.log` when it is free and generates a name in `/telemetry` if that file already exists. If the folder is missing, MVLib tries `/match.log` and makes the same decision there. An existing `/match.log` in the root matters only when that is the resolved destination. Set the build date in this example because either collision can result in an automatically named file.

### Open the recording

Find the filename in the startup messages, copy the `.log` file from the card, and choose **Open File** in MotionView's Viewing mode. Find the event you want in the timeline, then inspect the watches and pose at that point.

## Troubleshooting

**I see live data but no SD file.** Check that the Brain detects the card, SD logging is enabled, and the program called `start()`. Check whether a folder or file policy disabled recording. Restart the robot program after changing the card or destination.

**The file is in the root or its name looks different.** Check the startup message for the resolved filename. A missing folder can trigger root fallback, and an existing file can trigger automatic naming. If an automatic filename uses a build date, check the Brain clock and the value passed to `setBuildDate(...)`.

**The file ends early.** SD write or flush errors can stop the recording. Keep terminal output and system messages enabled to see the error. A power cut can also lose recent buffered data. Shorten `sdBufferFlushInterval` if you need data saved more frequently. [Logger timings](./Configuration.md#timings)

**The file exists but some data is missing.** Check the logger's minimum severity and category switches. Those settings also affect the SD file. If only the first messages are missing, check whether they ran before `start()`. [Configuration](./Configuration.md#output) · [Log recording](./Logs.md#when-a-message-reaches-the-recording)
