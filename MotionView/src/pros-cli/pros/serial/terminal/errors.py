"""Short diagnostics for the MotionView terminal's user-facing output."""

from pros.serial.devices.vex.comm_error import VEXCommError
from pros.serial.ports import PortConnectionException
from pros.serial.ports.exceptions import ConnectionRefusedException, PortNotFoundException


def friendly_terminal_error(error: Exception) -> str:
    if isinstance(error, VEXCommError):
        detail = str(error.message)
        if "download/upload uninitialized" in detail.lower():
            return "The V5 is busy with another transfer. Finish the program upload before starting live streaming."
        if "controller" in detail.lower() and ("connected" in detail.lower() or "channel" in detail.lower()):
            return "The V5 Controller is not connected to the Brain. Check the radio link and try again."
        return "The V5 stopped responding. Check the USB cable and radio connection, then try again."
    if isinstance(error, ConnectionRefusedException):
        return "The V5 port is already in use. Finish the upload or close other programs using the device."
    if isinstance(error, PortNotFoundException):
        return "Could not open the V5 connection. Reconnect the device and try again."
    if isinstance(error, (PortConnectionException, OSError, TypeError, AssertionError)):
        return "The V5 connection was lost. Check the USB cable and radio link, then try again."
    return "The V5 terminal stopped unexpectedly. Reconnect the device and try again."
