from typing import *

from .generic_device import GenericDevice


class StreamDevice(GenericDevice):
    def subscribe(self, topic: bytes):
        raise NotImplementedError

    def unsubscribe(self, topic: bytes):
        raise NotImplementedError

    @property
    def promiscuous(self):
        raise NotImplementedError

    @promiscuous.setter
    def promiscuous(self, value: bool):
        raise NotImplementedError

    def read(self) -> Tuple[bytes, bytes]:
        raise NotImplementedError

    def write(self, data: Union[bytes, str]):
        raise NotImplementedError


class RawStreamDevice(StreamDevice):

    def subscribe(self, topic: bytes):
        pass

    def unsubscribe(self, topic: bytes):
        pass

    @property
    def promiscuous(self):
        return False

    @promiscuous.setter
    def promiscuous(self, value: bool):
        pass

    def read(self) -> Tuple[bytes, bytes]:
        # Block for the first byte so the terminal reader does not hot-spin
        # polling read_all() when the serial stream is idle.
        first = self.port.read(1)
        if not first:
            return b'', b''
        return b'', first + self.port.read()

    def write(self, data: Union[bytes, str]):
        self.port.write(data)
