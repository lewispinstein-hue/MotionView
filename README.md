# MotionView - Live PROS Visualizer
<p align="center">
    <img src="assets/Logo.png" alt="Icon" width="315" />
</p>


## Quick Start
1. Open MotionView.
2. Use `Cmd + O` to open a file.
3. Download (from this GitHub) & Select the [`Example Route`](MotionView_Example.json) to see a full demo route with poses and watches.
4. Press `Space` to play/pause and hover the field to inspect pose + watch details.

**Main features:**
- Load recorded runs and see the robot path instantly.
- Scrub the timeline and inspect pose, speed, and watch values.
- Switch to Planning mode to draft, compare, and edit a path.
- Livestream runs with one click
- Upload your own Robot Image 

## Why MotionView?
- **Built for PROS teams**: fast to learn, practical for testing.
- **Pose + watch aware**: path, pose, and other important values all in one view.
- **Live or Later**: stream from the robot or open a saved file.
- **Decision-friendly**: compare runs, spot issues, and iterate faster.

## Viewing Mode
Use this mode to **replay and analyze** a run.

Features:
- Field view with the robot path and pose playback.
- Overlay the Planned Path and compare with events to see what went wrong
- Live streaming support and quick file import.

## Planning Mode
Use this mode to **plan and refine** a path before testing, or after.

Features:
- Place and edit waypoints on the field.
- Play back the planned path for timing and shape checks.
- Export or overlay plans against real runs for comparison.
- Fix mistakes with `Cmd + Z` and `Shift + Cmd + Z`

## Prerequisites
MotionView requires nothing out of the box to load files, but some features require external dependencies. 
1. **Live streaming:** This feature requires you to have both a PROS Project locally on your computer, and to have the [`PROS Extension`](https://marketplace.visualstudio.com/items?itemName=sigbots.pros) installed through `VS Code` or `Cursor`.

## Livestream Setup
1. In order to livestream, you must be connected to your robot via the controller or brain, and be using a `Pose logger`. For a minimal logger build for MotionView visit [**MVLib**](</Example Project - MVLib/README.md>), a Logger library.
2. Inside of Settings, the `PROS Project Directory` must be filled out. If you do not have your robot's code on your computer – thats fine! All you need is to install the PROS VSCode Extension and `Create a new PROS Project`. From there, the app should be able to auto-detect your project.
3. `PROS-CLI` Location: MotionView should be able automatically detect the location of the PROS Cli. If MotionView is unable to do that, go to the MotionView [Setup Guide](SETUP_GUIDE.md)
4. Assuming your robot is logging correctly, MotionView detected your PROS-CLI, and was given your PROS Project Directory, live streaming should work!

## Keybinds

**Legend:** `Cmd` on macOS, `Cmd` means `Ctrl` on Windows/Linux.

| Context | Keybind | Action |
|---|---|---|
| Global | `Cmd + 1` | Switch to Viewing mode |
| Global | `Cmd + 2` | Switch to Planning mode |
| Global | `Cmd + Shift + K` | Clear everything (field + plan) |
| Global | `F` | Fit/reset field position |
| Global | `Cmd + T` | Toggle Floating info panel |
| Viewing | `Space` | Play/Pause playback (or toggle Auto‑follow Head when live‑connected) |
| Viewing | `Cmd + O` | Open JSON file |
| Viewing | `Cmd + K` | Clear Viewer |
| Viewing | `S` | Start/stop live streaming (if connected) |
| Viewing | `T` / `P` | Toggle Planned Overlay |
| Viewing | `C` | Connect/disconnect |
| Viewing | `←` / `→` | Step to previous/next pose |
| Planning | `Space / S` | Play/Pause plan playback |
| Planning | `Delete` / `Backspace` | Delete selected waypoint(s) |
| Planning | `←` / `→` / `↑` / `↓` | Nudge selected waypoint(s) |
| Planning | `Shift + ←/→/↑/↓` | Nudge selected waypoint(s) by 5× step |
| Planning | `Cmd + Z` | Undo |
| Planning | `Cmd + Shift + Z` | Redo |
| Planning | `Cmd + K` | Clear planned path |
