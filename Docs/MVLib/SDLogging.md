# MVLib SD Logging

This guide covers MVLib's SD logging path API, fallback policies, and path rules.

## `setLoggingLocation(...)`

```cpp
bool setLoggingLocation(const char *location,
                        Logger::MissingFolderPolicy folderPolicy = Logger::MissingFolderPolicy::disable,
                        Logger::ExistingFilePolicy filePolicy = Logger::ExistingFilePolicy::automatic);
```

Use this to route SD log output to either:

- a folder, where MVLib generates a timestamped filename later
- a specific file path, where MVLib targets that exact file unless policy resolution changes it

Call it before `logger.start()`.

## Path Rules

- pass a POSIX-style path relative to `/usd`
- start the path with `/`
- the target folder must already exist on the SD card
- if you pass a file path, the file portion must include an extension such as `.log`
- folder segments must not contain `.`

Examples:

- valid folder: `/logs`
- valid file: `/logs/match.log`
- invalid path: `/usd/logs/`
- invalid folder segments: `/logs.match/run`
- invalid file path: `/logs/match`

## Resolution Order

MVLib resolves the destination in this order:

1. Determine whether `location` is a folder or an explicit file path.
2. Resolve the folder using `MissingFolderPolicy`.
3. If an explicit filename remains selected, apply `ExistingFilePolicy` only if that exact file already exists in the resolved folder.
4. If no explicit filename remains selected, `initSDLogger()` generates a timestamped filename in the resolved folder.

## `MissingFolderPolicy`

```cpp
enum class Logger::MissingFolderPolicy : uint8_t {
  disable = 0,
  useRoot
};
```

### `disable`

If the requested folder does not exist:

- SD logging is disabled
- `setLoggingLocation(...)` returns `false`
- file policy is never evaluated

### `useRoot`

If the requested folder does not exist:

- MVLib falls back to the SD root directory, `/usd/`
- file resolution continues there

Example:

```cpp
logger.setLoggingLocation("/telem/route.log",
                          Logger::MissingFolderPolicy::useRoot,
                          Logger::ExistingFilePolicy::automatic);
```

If `/telem` does not exist, the resolved folder becomes `/`, and file resolution continues with `/route.log`.

## `ExistingFilePolicy`

```cpp
enum class Logger::ExistingFilePolicy : uint8_t {
  disable = 0,
  overwrite,
  automatic
};
```

This policy is only consulted after folder resolution finishes, and only when an explicit file path is still selected and that file already exists.

### `disable`

If the explicit target file already exists:

- SD logging is disabled
- `setLoggingLocation(...)` returns `false`

### `overwrite`

If the explicit target file already exists:

- MVLib keeps that exact resolved file path
- `initSDLogger()` later opens it with `"w"` and overwrites it

### `automatic`

If the explicit target file already exists:

- MVLib preserves the resolved folder
- the explicit file path is cleared
- `initSDLogger()` later generates a timestamped filename in that folder

If the explicit target file does not exist, no fallback is needed and MVLib uses the requested filename directly.

## Examples

### Folder with generated file

```cpp
logger.setLoggingLocation("/telemetry",
                          Logger::MissingFolderPolicy::disable,
                          Logger::ExistingFilePolicy::automatic);
```

Result:

- resolved folder: `/telemetry`
- explicit filename: none
- generated file: `/telemetry/MVLIB_....log`

### Explicit file

```cpp
logger.setLoggingLocation("/telemetry/match.log",
                          Logger::MissingFolderPolicy::disable,
                          Logger::ExistingFilePolicy::overwrite);
```

Result:

- resolved folder: `/telemetry`
- explicit filename: `/telemetry/match.log`
- if the file exists, it is overwritten later
- if the file does not exist, `fopen(..., "w")` creates it later

### Missing folder with root fallback

```cpp
logger.setLoggingLocation("/telem/route.log",
                          Logger::MissingFolderPolicy::useRoot,
                          Logger::ExistingFilePolicy::automatic);
```

If `/telem` does not exist:

- resolved folder becomes `/`
- candidate file becomes `/route.log`
- if `/route.log` does not exist, that exact file is used
- if `/route.log` does exist, `automatic` clears the explicit file and a timestamped root-level filename is generated later

## Common Mistakes

- Passing `/usd/...` instead of a path relative to `/usd`
- Forgetting the leading `/`
- Passing a file path without an extension
- Using `.` in a folder segment
- Calling `setLoggingLocation(...)` after `logger.start()`
