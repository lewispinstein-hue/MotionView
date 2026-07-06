# MotionView Planning Mode

Just like block coding, you can create autonomous routines for your robot to follow using MotionView's Planning mode.

<p align="left">
    <img src="assets/MotionView/PlanningMode.png" alt="Icon" />
</p>

## Opening Planning Mode
After installing MotionView, you can open Planning Mode using the keyboard shortcut `Cmd/Ctrl+2` or clicking `Planning` in the mode selector at the top of the screen.

## Planning Mode Elements

### Field
The field is the main editing area for the planning mode. It contains the waypoints that make up the planned path. 

- Right-click and drag to select multiple waypoints
- Click on the field to place a waypoint, and use the `Theta Handle` to adjust its direction
- Drag outside the field to pan
- Use the Waypoints menu in the sidebar to manage waypoints

### Custom Events
Objects and Methods are the *blocks* of code that you can insert into the timeline.

- To create an object, click on the `+` icon in the sidebar next to the `Custom Events` tab and name your object.
- Click the `Add Method` text on your object to add a method to it. Methods let you create reusable blocks of code that you can drag and drop throughout your route.
- To edit a method inline, first drag and drop it onto the timeline and then double-click it. Inline editing allows you to reuse the same method for different cases. A common use case is to create one general `Delay` Object and Method and then edit it inline for different delays.

Tips:

- Edit a method by double-clicking it
- Change the color of an object to make it easier to see in the timeline


### Timeline
The timeline is the secondary area for editing the planned path. It contains the nodes for the planned path.

- Drag a node from the sidebar to the timeline to add it to the path
- Double-click on a node to edit it inline
- Click on a node to select it
- Drag a node back to the sidebar to delete it

### Exporting
Click the `Copy Code` button in the side bar to copy your entire autonomous routine to the clipboard.

## Full Video Guide

WIP: making video and attaching through github