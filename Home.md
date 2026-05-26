# MotionView Docs

<p align="left">
    <img src="https://img.shields.io/github/stars/lewispinstein-hue/MotionView?style=flat-square" alt="Stars">
    <img src="https://img.shields.io/github/downloads/lewispinstein-hue/MotionView/total?style=flat-square" alt="Downloads">
    <span style="font-size:25px;font-weight:850">|</span>
    <img src="https://img.shields.io/badge/MotionView-v1.2.0-green?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/MVLib-v2.0.1-green?style=flat-square" alt="Version">
</p>

<p align="center">
    <img src="assets/Logo.png" alt="MotionView Logo" width="180" />
</p>

MotionView's creation was inspired by other visualizers such as [Grafana](https://github.com/UZ9/pros-grafana-cli) and [Graphy](https://github.com/jazonshou/Graphy). Our goal was to create a high-performance versatile VRC dashboard that is packed full of features, easy to use, and easy to understand.

<hr><br>

**MotionView is a high-speed telemetry dashboard and live visualizer for VEX PROS teams.** It turns a raw stream of terminal numbers into a highly visual, actionable representation of your robot's behavior. Stop guessing why your robot is failing, and start seeing it.

<p align="center">
    <img src="assets/MotionView/viewing_with_overlay.png" alt="MotionView Dashboard" width="800" />
</p>

## Core Features
- **Live Streaming:** See your robot's exact path, heading, and speed drawn on a virtual 2D field.
- **Compare and Contrast:** Overlay multiple datasets (such as actual and target velocities) on the graph at once.
- **Customizable UI:** Pin critical variables as custom floating UI widgets, and drag floating widgets around the screen.
- **Path Planning:** Draft, edit, and simulate routes interactively, then overlay your planned path onto a real recorded run.
- **Smart Telemetry:** Create periodic set-and-forget watches and stream general-purpose logs over a high-speed binary protocol without eating up your V5 CPU.
- **Events are synced:** Click on an event to see exactly where and what the robot was doing at that time.

## Quick Start
1. **Download:** Grab the latest release for your OS from the [Releases Page](https://github.com/lewispinstein-hue/MotionView/releases).
2. **Demo:** In older versions (v1.2.0 and earlier, newer versions have a built-in demo), download the [`Example Route`](MotionView_Example.json), press `Cmd + O` in MotionView to open it, and press `Space` to watch a recorded run (Note this is a VEX Pushback run, as the current season is still to early for an actual Override demo).
3. **Connect your Robot:** Install [MVLib](MVLib/README.md) into your PROS project to start streaming your own live data.

---

## Version Compatibility

> **How to check your versions:**
> * **MotionView:** Click the `?` icon in the app, and look for the version number in the bottom left.
> * **MVLib:** Run `pros c info-project` in your terminal and look for `libmvlib`.

Because MotionView and MVLib communicate using a highly optimized binary protocol, you must ensure your desktop app and your PROS library are compatible. 

| MotionView App | Requires MVLib | Notes |
| :--- | :--- | :--- |
| **v1.3.x** | **v3.0.x** <br> **v2.0.x** | Latest release |
| **v1.2.x** | **v2.0.x** | Introduced high-speed binary telemetry. |
| **v1.1.x** | **v1.1.x** | Non-binary data protocol |
| **v1.0.x** | **v1.0.x** | Legacy data protocol (missing some features) |