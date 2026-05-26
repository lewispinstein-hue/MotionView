# How to Download MotionView & MVLib

## Go to the Releases Page
1. Go to the official [Releases Page](https://github.com/lewispinstein-hue/MotionView/releases).
2. Find the latest release, or a particular version you want.
3. Download the MotionView file for your OS.
4. Download MVLib

## Installing MotionView
1. Based on your OS, follow these guides:
  - [Installing on macOS](docs/MotionView/InstallingMacOS.md)
  - [Installing on Windows](docs/MotionView/InstallingWindows.md)

## Installing MVLib
1. Drag and drop the download `libmvlib@<version>.zip ` into the root of your PROS project.
2. Open an instance of the PROS terminal and run 

```bash
pros c fetch libmvlib@<version>.zip
pros c apply libmvlib@<version>
```

3. You now have MVLib installed in your project! For setup, see [here](docs/MVLib/Setup.md).
