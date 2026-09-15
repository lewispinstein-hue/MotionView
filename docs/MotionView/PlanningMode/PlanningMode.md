# MotionView Planning Mode

MotionView's Planning Mode lets you visually create autonomous routines using waypoints and custom events, then export the resulting routine directly into your code.

<p align="left">
    <img src="assets/MotionView/PlanningDocs/PlanningMode.png" alt="Icon" />
</p>

## Creating a Path
Click anywhere on the field to create a waypoint. You can edit this waypoint by using **theta handles** to change the angle of the waypoint, arrow keys to nudge, and use the **Selected Waypoint** area of the sidebar to assign specific values.
<p align="left">
    <img src="assets/MotionView/PlanningDocs/ThetaHandle.png" alt="Theta Handle" width="300" />
</p>

## Using the Timeline
In order to use the timeline, you need to first create an object.
An object represents a device or subsystem on your robot, such as a claw, intake, piston, or conveyor. Each object can contain multiple methods that can be placed on the timeline.

Click the **`+`** icon next to the **Custom Events** text in the right sidebar. In the popup, name your object and click **Create**.

<p align="left">
    <img src="assets/MotionView/PlanningDocs/AddObjectModal.png" alt="Theta Handle" width="500" />
</p>

To add an object, click to the **Add Method** button on the bottom left of your new object. 

<p align="left">
    <img src="assets/MotionView/PlanningDocs/AddMethodModal.png" alt="Theta Handle" width="500" />
</p>

- **Name**: Give your object a name. 
- **Code**: This is the actual code that should represent the method. Example: Object name is `Claw Piston`, Method name is `Extend`, so the code should be `claw_piston.set_value(true)`. The code may differ based on your coding environment (e.g. Python, C++, etc.).

After you have created your objects and methods, click and hold on a method to pick it up. Drag it to the timeline, and a green line will appear where the method will be placed when you release. 

Create as many objects and methods as you need to create your autonomous routine. Simulate your auton by clicking the **Play** button in the top bar, or by clicking the space bar.

## Putting it all together
Now that you can create events and order them on the timeline, here is how to actually use them in your code:
Click the **Copy Code** button in the sidebar, and paste the output into your code.

**Copy Code** is useful for quickly inserting a routine into your source file. Export Code is designed for iteration: configure a file template once, then regenerate the complete autonomous routine whenever your plan changes. Use the **Export Code** button to export your auton to a file in whatever location you want without ever pasting. Add headers and footers to make the code instantly executable.

**Example:**
<p align="left">
    <img src="assets/MotionView/PlanningDocs/ExportCodeModal.png" alt="Theta Handle" width="600" />
</p>

Now, just click the **Export** button to instantly update your auton code!

## What if I don't have odometry?
If you are using an environment such as VEXCode that does not easily provide odometry, you can use Planning Mode to the same effect! Instead of using a waypoint template that exports with `x, y, theta` values, use the built-in `${distance}` and `${theta}` variables. Example:

```cpp
// Template code:
Drivetrain.driveFor(forward, ${distance}, inches);
Drivetrain.turnToHeading(${theta}, degrees);
```

<br>

Download a complete Planning Mode example route [here](https://github.com/lewispinstein-hue/MotionView/blob/main/MotionView_Example.json)


## Troubleshooting
Common troubleshooting steps:
- Sidebar is hidden. Push `Cmd/Ctrl + Shift + B` to toggle the sidebar.
- Your MotionView version is too old. Upgrade to `v1.3.0+` to use the updated Planning Mode.
