"""Fresh local decoder process used by the frontend continuation regression."""
import importlib.util
import json
import os
from pathlib import Path
import struct
import sys
from unittest.mock import patch

root = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(root / "src/pros-cli"), str(root / "src/pros-cli/tests")]
import pros.serial as decoder
from test_motionview_serial import frame

spec = importlib.util.spec_from_file_location("resume_test_bridge", root / "src/bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

request = json.load(sys.stdin)
body = bridge.StartRequest.model_validate(request.get("body") or {})
# Use the real bridge -> environment -> fresh decoder path. Freeze the host
# clock so process startup time does not make the expected fixture ambiguous.
with patch.object(bridge.time, "monotonic", return_value=1_000.0):
    env = bridge._pros_launch_env(body.resume)
    with patch.dict(os.environ, env, clear=True):
        decoder.resume_timestamp_from_environment()

    packets = []
    for event in request["events"]:
        kind, timestamp = event[:2]
        raw = timestamp & 0xFFFF
        if kind == "start":
            packets.append(frame(decoder.MSG_TYPE_START, struct.pack("<IBI", timestamp, 2, 300_001)))
        elif kind == "pose":
            packets.append(frame(decoder.MSG_TYPE_POSE, struct.pack("<HffHbb", raw, 2.0, 3.0, 0, 1, 1)))
        elif kind == "watch":
            packets.append(frame(decoder.MSG_TYPE_WATCH, struct.pack("<HHf", raw, 7, 42.0), level=2))
        elif kind == "log":
            packets.append(frame(decoder.MSG_TYPE_LOG, struct.pack("<H", raw) + b"Resumed", level=2))
        elif kind == "created":
            packets.append(frame(decoder.MSG_TYPE_WPOINT, struct.pack("<HHffHffI", raw, 4, 20.0, 30.0, 0, 1.0, float("nan"), 1000), subtype=1))
        elif kind == "reached":
            packets.append(frame(decoder.MSG_TYPE_WPOINT, struct.pack("<HH", raw, 4), subtype=2))
    # Roster arrives after data to exercise deferred timestamp rendering too.
    packets.extend([
        frame(decoder.MSG_TYPE_ROSTER, struct.pack("<H24s", 7, b"Battery")),
        frame(decoder.MSG_TYPE_ROSTER, struct.pack("<H24s", 4, b"Target")),
    ])
    output = decoder.decode_bytes_to_str(b"".join(packet + b"\0" for packet in packets))
print(json.dumps(output.splitlines()))
