# How to setup the Planning Simulator

MotionView's built-in simulator allows you to realistically play back your autonomous route and see how your robot moves. In order for this simulator to work, you must provide it with some information.

**Note:** The simulator is still experimental and will continue to be improved for accuracy 
## Robot-specific settings

<p align="left">
    <img src="assets/MotionView/PlanningDocs/RobotSpecsSimulation.png" alt="Robot simulation settings" width="700" />
</p>

### What to enter: 

**Library Preset**: Choose your robot's odometry library. 
**Drivetrain Power**: The combined power of your robot's drivetrain. For example, if you have two 11w motors per drivetrain side, enter 44. 

**Theoretical Speed**: The theoretical max speed of your robot. Equation: `(wheel_diameter * π / 60) * motor_rpm(driving_gear/driven_gear)`.
For example, if you have 600 RPM (blue cartridge) motors attached to 36T gears with 60T gears attached to your wheels and 3.25" wheels, you would enter: `(600π / 60) * (60/36) = 61.3`. 

**Approximate Robot Weight**: The weight of your robot.

**Effective Track Width**: The width of your robot's chassis, from front wheel to front wheel. 

<p align="left">
    <img src="assets/MotionView/PlanningDocs/TrackWidthDiagram.png" alt="Robot simulation settings" width="350" />
</p>

---

<p align="left">
    <img src="assets/MotionView/PlanningDocs/RobotPIDSimulation.png" alt="Robot simulation settings" width="350" />
</p>

## What to enter

Depending on your selected simulation model, there may be more PID profiles to enter. For this example, there are only two (Linear and Angular).

Copy the exact PID values from your robot's code into these boxes. Make sure to correctly enter the values for each PID profile. 

For LemLib, the two lower boxes **Horizontal Drift** and **Slew** also need to be filled out.
