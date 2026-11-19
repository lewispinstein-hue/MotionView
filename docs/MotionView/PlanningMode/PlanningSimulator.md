# How to use the Simulator

The Planning Simulator previews how your robot might drive a route using its waypoint poses, selected motions, speed settings, and robot configuration. Press **Play** to watch the route, or use the timeline to inspect part of a movement. Select a waypoint to see messages explaining where its movement finishes.

Start by matching [the simulator settings](docs/MotionView/PlanningMode/PlanningSimulatorSetup.md) to your robot. The preview and ETA are estimates. Friction, braking, motor response, and the library's stopping settings include built-in assumptions, so even matching every available input cannot reproduce every robot exactly.

## Before troubleshooting

Check the simulation model, PID values, drivetrain power, theoretical speed, weight, and track width. Also check the waypoint's direction, motion order, speed range, and lead. Each movement starts from the predicted finish of the previous one, so an early missed target can affect the rest of the route.

The **simulation model** controls the predicted behavior. The **template preset** controls exported code. Keep both matched to your robot's library. A Custom preset using the LemLib base model follows the LemLib entries below, and the same applies to other base models. In these entries, **Custom** means the base model named Custom. VEXcode C++ and Python share one simulation model.

The simulator follows the selected motions. It does not run edited code or custom event methods. If those change how your robot moves, comparing that run with the preview needs extra care.

### `Minimum speed chaining`

**Models:** LemLib, when minimum speed is greater than `0`.

**Why it happens:** A nonzero minimum speed allows a movement to finish while the robot is still moving, ready for the next command. This is expected motion chaining. A remaining offset can be acceptable if the next movement corrects it.

**What to try:** Keep it when chaining is intentional. Set minimum speed to `0` when you want the motion to settle near the target before continuing. Check the following movement as well, since it inherits the robot's actual predicted position and speed.

## Motion Stalls

A warning can come from the library's normal stopping behavior, an unsuitable movement, incorrect settings, or a limitation of the simulator. The message by itself does not prove that your robot will stall. Use the explanation below to decide what to check.

### `Completed with offset` — `Controller met its settling rule`

**Models:** LemLib, JAR-Template, and VEXcode.

**Why it happens:** The controller decided the motion was close enough to finish, but the robot still had a noticeable position or heading error. Libraries allow some error instead of waiting forever for a perfect result. For Straight movements, the controller may also stop correcting sideways error near the destination.

**What to try:** Reduce approach speed or line up the robot earlier. Add a Turn when the final heading matters, or use a Boomerang if your library supports it. Check the entered PID values. If the robot finishes accurately while the simulator shows an offset, its assumed stopping rules or robot response may be inaccurate.

### `Completed with offset` — `Controller exited after crossing the target plane`

**Models:** JAR-Template, for Straight and Boomerang.

**Why it happens:** JAR can finish when the robot passes a line through the destination, even if it passes to one side of the waypoint. For a Boomerang, the destination heading helps determine that line. This reflects JAR's movement behavior and can happen before the robot reaches the exact point.

**What to try:** Adjust the approach, destination heading, or lead so the robot crosses closer to the waypoint. Lower the speed if it is passing too quickly to correct its position. Compare with a robot recording before changing tuning. If the real approach differs substantially, the simulator needs a better description of that robot's response.

### `Completed with offset` — `Distance drive ended away from the waypoint`

**Models:** The LemLib simulation model when combined with a VEXcode distance-drive template. The VEXcode model reports a missed destination under `Missed target`.

**Why it happens:** A distance drive moves a specified distance along the robot's heading. If the previous motion left it off position, or its alignment turn was imperfect, driving that distance can finish somewhere beside the waypoint. This is a limitation of using distance commands to follow a route drawn with positions.

**What to try:** Match the simulator to the VEXcode template, then check where the previous motion ended. Give the robot a clear approach and reduce speed if alignment is inaccurate. An odometry-based motion can correct toward a field position when your library supports it.

### `Completed with offset` — `Robot coasted after the motion ended`

**Models:** LemLib, JAR-Template, and VEXcode, at the end of the route.

**Why it happens:** The final command finished close enough to its target, but the robot still had momentum. Its predicted position or heading moved farther away while coming to rest. Some movement after a command is physically possible, but the amount depends on braking and friction that the simulator can only approximate.

**What to try:** Lower the final movement's speed and use minimum speed `0` where supported. Compare the robot's stopping behavior with the preview. A large difference after the command ends is a physics-model or missing-data issue, especially when your robot uses a different brake mode.

### `Stalled`

**Models:** All models. JAR-Template uses this check when the relevant simulation timeout is disabled. With a timeout enabled, it waits for the library's exit rule or time limit.

**Why it happens:** The predicted robot barely moves or turns for about a second while the controller is still trying to finish. Its drive power may be too small to overcome friction. Zero or unsuitable PID gains, a very low maximum speed, or incorrect robot specifications can cause this.

A Boomerang can also stop making progress because of its approach and lead. In some layouts, lead `1` puts the point the robot is trying to follow at its own position. This is a limitation of that approach. LemLib and Custom also use Horizontal Drift to limit Boomerang drive power, so entering `0` can prevent progress.

**What to try:** Check the inputs against the robot, increase an overly low speed limit, and reduce lead or change the approach. For LemLib, copy the robot's actual Horizontal Drift setting. If these values already match and the robot completes the movement, treat the warning as a simulator or missing-data problem. Reaching the target may require steering or friction behavior the model does not reproduce.

### `Missed target` — Time limit reached

**Models:** JAR-Template, and LemLib when using its built-in template without a motion code override.

**Why it happens:** The motion reached its time limit before the controller finished. This can happen because the limit is too short, the movement is slow, or the robot keeps correcting around the target. A timeout reports that time ran out, rather than identifying which of those caused it.

**What to try:** Check whether the real robot also times out. For JAR, match the Drive, Turn, and Swing timeouts in **Settings → Planning → Simulation** to your code. Drive covers Straight and Boomerang. Setting a JAR timeout to `0` disables it.

The current LemLib preview uses fixed limits of 4 seconds for Straight and Boomerang and 2 seconds for Turn and Swing. Its waypoint timeout fields are currently a UI preview and do not change those limits. Editing a motion's code also prevents the simulator from assuming its timeout. If your code uses a different limit, the warning may reflect this simulator limitation.

### `Missed target` — Movement finished away from the destination

**Models:** VEXcode. EZ-Template and Custom can also report this when a movement finishes outside the simulator's position check. Other models can encounter it when paired with VEXcode distance-drive templates.

**Why it happens:** The movement finished, but the resulting position was too far from the waypoint. With VEXcode, driving the correct distance does not guarantee the correct field position. An earlier offset or an imperfect alignment turn can carry through the whole drive. For the other models, an early finish or movement between the arrival check and the stop can leave an offset.

**What to try:** Check the first movement that misses, since later misses may come from that starting error. Match the template and simulation model, improve alignment, and lower approach speed if needed. If your robot reaches the point with the same setup, compare a recording to identify the simulator's stopping or steering mismatch.

### `Preview incomplete`

**Models:** All models.

**Why it happens:** The simulator could not finish its calculation reliably. A robot that keeps circling or correcting can reach the simulator's internal time limit. A calculation failure can also stop the preview. Later movements may be missing, and the displayed ETA does not describe a complete run.

**What to try:** Find the first affected movement and check its motion type, direction, speed, PID values, and lead. Try a simpler approach or split a difficult movement. If the robot completes the same movement, save the Planning JSON and a Viewing recording for a simulator bug report. Increasing a robot timeout cannot fix a preview calculation that fails.

## Predicted end offset

**Models:** LemLib, EZ-Template, JAR-Template, and Custom, on Boomerang segments that finish successfully or with an offset.

**Why it appears:** This label beside the lead handle shows the distance between the predicted end position of the segment and its destination waypoint. It appears for an offset larger than 0.25 inches, displayed in your app units. It measures position, so it can appear even when the final heading is correct.

**What to try:** A small offset may be acceptable for your next action. For a larger one, review the approach, lead, speed, and any stopping message on that segment. If the real robot stops closer than predicted, the difference points to the simulator's assumptions or missing robot data. Use a Viewing recording to compare the actual finish with the prediction.
