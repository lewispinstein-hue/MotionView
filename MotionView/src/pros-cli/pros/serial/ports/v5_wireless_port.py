from typing import *

from pros.common.utils import logger
from pros.serial.devices.vex.v5_device import V5Device
from pros.serial.ports import BasePort, DirectPort


class V5WirelessPort(BasePort):
    def __init__(self, port):
        self.buffer: bytearray = bytearray()

        self.port_instance = DirectPort(port)
        self.device = V5Device(self.port_instance)
        self.download_channel = self.device.DownloadChannel(self.device)
        self.download_channel.__enter__()

    def destroy(self):
        try:
            self.download_channel.__exit__()
        except Exception as e:
            logger(__name__).warning(f"Failed to restore V5 pit channel during disconnect cleanup: {e}")
        finally:
            try:
                self.port_instance.destroy()
            except Exception as e:
                logger(__name__).warning(f"Failed to close V5 wireless port cleanly: {e}")

    def config(self, command: str, argument: Any):
        return self.port_instance.config(command, argument)

    # TODO: buffer input? technically this is done by the user_fifo_write cmd blocking until whole input is written?
    def write(self, data: bytes):
        self.device.user_fifo_write(data)

    def read(self, n_bytes: int = 0) -> bytes:
        if n_bytes <= 0:
            self.buffer.extend(self.device.user_fifo_read())
            ret = bytes(self.buffer)
            self.buffer = bytearray()
            return ret

        if n_bytes > len(self.buffer):
            self.buffer.extend(self.device.user_fifo_read())
        ret = self.buffer[:n_bytes]
        self.buffer = self.buffer[n_bytes:]
        return ret

    @property
    def name(self) -> str:
        return self.port_instance.name
