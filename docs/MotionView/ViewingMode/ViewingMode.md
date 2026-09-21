# Viewing Mode
This doc will cover what features are available in the Viewing mode of MotionView and how to use them.

### Table of Contents

| Section | Description |
| - | - |
| [Live Streaming](#live-streaming) | Connecting and using the Live Streaming feature |
| [Timeline](#timeline) | Using the Timeline |
| [Logs](#logs) | Viewing and filtering logs |
| [Watches](#watches) | Viewing and filtering watches |
| [Waypoints](#waypoints) | Viewing and filtering waypoints |

---

## Live Streaming
1. Make sure your robot is connected and MVLib is installed and configured on it. See [Setup Live Streaming](https://lewispinstein-hue.github.io/MotionView/docs/MotionView/SetupLivestreaming) and [Installing MVLib](https://lewispinstein-hue.github.io/MotionView/docs/MVLib/Setup) for more info.
2. Click `Connect` in the Live Window of MotionView to initialize the connection and start the background process.
3. Once ready, click `Start` to connect to your robot and begin receiving live data.

### Refresh interval
You will notice a drop-down menu with timings in ms on it. This controls how frequently MotionView's UI is updated to the newly received data. Lower values allow for a more responsive UI at the cost of performance. 
**Note**: You can always click `Cmd+R` to manually refresh the UI.


## Timeline
At the bottom of the screen, there is an adjustable timeline. It shows the speed of the robot over time, and you can hover your mouse over it to scroll through your entire run easily.


## Logs
In the right sidebar, there is a Logs tab. Here you can view the logs for the robot and filter them by level. 


## Watches
In the right sidebar, there is a Watches tab. Here you can view the watches for the robot and filter them by level and name.

### Pinning
By clicking the pin icon on a watch, you spawn a small floating UI widget that can be dragged around the screen to make it easy to view the value of that variable at any time.

### Graphing
By clicking the graph icon on a watch, you open the graph window (also openable with the `G` key). Here you can view the history of the value of the watch as a graph, and compare its graph to that of other watches. 
Only works with numeric watches.


## Waypoints
In the right sidebar, there is a Waypoints tab. Here you can view the waypoints for the robot and filter them by name. 
There are several types of events:
- `CREATED` - the waypoint was created. You can see the target position, tolerances, and other parameters.
- `TIMEDOUT` - the waypoint has timed out. This means that the robot failed to reach the waypoint before the timeout.
- `REACHED` - the waypoint has been reached. This means that the robot has reached the waypoint and is no longer tracking it.

At any point, you can click on a waypoint (or filter for it explicitly) to open its offset values. Here, you can see its x, y, and theta offsets, as well as its straightline offset. 
