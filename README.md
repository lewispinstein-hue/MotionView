# MotionView - Live PROS Visualizer
<p align="center">
    <img src="assets/Logo.png" alt="Icon" width="315" />
</p>



## Prerequisites
MotionView requires nothing out of the box, but some features require external dependencies. 
1. **Livestreaming:** This feature requires you to have both a PROS Project locally on your computer, and to have the `PROS Extension` installed through `VSCode` or `Cursor`.

## Livestream Setup
1. In order to livestream, you must be connected to your robot via the controller or brain, and be using a `Pose logger`. For a minimal, easy to setup logger, visit [MVLib](</Example Project - MVLib/README.md>), a complete Logger Library.
2. Inside of Settings, the `PROS Project Directory` must be filled out. If you do not have your robot's code on your computer – thats fine! All you need is to install the PROS VSCode Extension and `Create a new PROS Project`. From there, the app should be able to auto-detect your project.
3. `PROS-CLI` Location: MotionView should be able automatically detect the location of the PROS Cli. If MotionView is unable to do that, a manual guide and method to set the `PROS-CLI` location manually is in the works.
4. Assuming your robot is logging correctly, MotionView detected your PROS Cli, and was given your PROS Project Directory, livestreaming should work!


## Keybinds

**Legend:** `Cmd` on macOS, `Cmd` means `Ctrl` on Windows/Linux.

| Context | Keybind | Action |
|---|---|---|
| Global | `Cmd + 1` | Switch to Viewing mode |
| Global | `Cmd + 2` | Switch to Planning mode |
| Global | `Cmd + Shift + K` | Clear everything (field + plan) |
| Global | `F` | Fit/reset field position |
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
