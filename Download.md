# How to Download MotionView & MVLib

## Go to the Releases Page
1. Go to the official [Releases Page](https://github.com/lewispinstein-hue/MotionView/releases).
2. Find the latest release, or a particular version you want.
3. Download the MotionView file for your OS.
4. Download MVLib

## Installing MotionView
1. Based on your OS, follow these guides:
  - [Installing on macOS](https://lewispinstein-hue.github.io/MotionView/docs/MotionView/InstallingMacOS)
  - [Installing on Windows](https://lewispinstein-hue.github.io/MotionView/docs/MotionView/InstallingWindows)

## Installing MVLib

### Standard PROS projects

Use `libmvlib@<version>.zip` for a standard PROS project on kernel 4.2.1 or newer. Drag the ZIP into the project root, then open a PROS terminal there and run:

```bash
pros c fetch libmvlib@<version>.zip
pros c apply libmvlib@<version>
pros make all
```

### EZ-Template projects

Use `libmvlib-ez-template@<version>.zip` for EZ-Template. After fetching and applying it, run the MVLib cache script for your platform. The script compiles MVLib with the PROS toolchain in that project, creates `firmware/libmvlib.a`, and removes the temporary source copy so future builds are fast.

The complete macOS/Linux and Windows commands, success checks, and update instructions are in the [MVLib setup guide](./docs/MVLib/Setup.md?id=install-mvlib-with-ez-template).
