# Setting up **MotionView**
MotionView `Settings` are located inside of the Gear icon, typically near the top left of your MotionView window.

<p align="center">
    <img src="assets/MotionView/pros_setup_settings.png" alt="Pros Config" width="800" />
</p>

MotionView was made to be easy to setup, with auto-detection when available. 
In the case that auto-detection fails, or you have questions, here is where to look

## PROS Project Directory
The **PROS Project Directory** is just the folder where your PROS Project is. 
> The only thing that this field requires is that the folder contain a `project.pros` and the other necessary PROS files. **It DOES NOT need to contain any relevant code**

If you have an existing PROS Project on your computer, enter its path into the `PROS Project Directory` field of settings.

If you do not have an existing PROS project, create one using the [`PROS Extension`](https://marketplace.visualstudio.com/items?itemName=sigbots.pros).

## PROS-CLI Path
The **PROS-CLI Path** is the path to your `pros` executable file. It's what allows live streaming to open the connection between the controller and the computer.

## Live Streaming
Once you have a connection between MotionView and your computer, the easiest way to bridge your robot and MotionView is to use [MVLib](../../MVLib/README.md). Using MVLib ensures full functionality and accurate logging. If you don't want to use MVLib, you may need help setting up a bridge. If you want to make your own logger, see [here](./MotionViewAPI.md).md.
