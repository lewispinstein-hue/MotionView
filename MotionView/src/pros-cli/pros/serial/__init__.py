import csv
import io
import math
import re
import struct
from collections import defaultdict
from typing import DefaultDict, Dict, List, Optional, Tuple, Union

# --- MOTIONVIEW PROTOCOL STATE ---
DEFAULT_ROSTER: Dict[int, str] = {}
ELEVATED_ROSTER: Dict[int, str] = {}
PENDING_ROSTER_EVENTS: DefaultDict[int, List[Tuple[object, ...]]] = defaultdict(list)
MAX_PENDING_ROSTER_EVENTS_PER_ID = 100
LAST_TIMESTAMP_RAW: Optional[int] = None
TIMESTAMP_WRAP_OFFSET = 0
STREAM_BUFFER = bytearray()

LEVELS = {
    0: "NONE",
    1: "DEBUG",
    2: "INFO",
    3: "WARN",
    4: "ERROR",
    5: "FATAL",
    7: "OVERRIDE",
}

MSG_TYPE_POSE = 0x01
MSG_TYPE_WPOINT = 0x02
MSG_TYPE_WATCH = 0x03
MSG_TYPE_ROSTER = 0x04
MSG_TYPE_LOG = 0x05

WPOINT_CREATED = 0x01
WPOINT_REACHED = 0x02
WPOINT_TIMEDOUT = 0x03

WATCH_NUMERIC = 0x00
WATCH_NUMERIC_TRIPPED = 0x01
WATCH_TEXT = 0x02
WATCH_TEXT_TRIPPED = 0x03

ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def _reset_decoder_state() -> None:
    global LAST_TIMESTAMP_RAW, TIMESTAMP_WRAP_OFFSET

    DEFAULT_ROSTER.clear()
    ELEVATED_ROSTER.clear()
    PENDING_ROSTER_EVENTS.clear()
    LAST_TIMESTAMP_RAW = None
    TIMESTAMP_WRAP_OFFSET = 0


def _strip_ansi(text: str) -> str:
    return ANSI_ESCAPE_RE.sub("", text)


def _looks_like_banner_line(text: str) -> bool:
    stripped = _strip_ansi(text).strip()
    if not stripped:
        return False

    if "Powered by PROS for VEX V5" in stripped:
        return True
    if "Copyright (c) Purdue University ACM SIGBots" in stripped:
        return True
    if stripped.startswith("Version:") and "Platform:" in stripped:
        return True

    art_chars = sum(1 for ch in stripped if ch in r"\/|_`.-+=*:")
    return len(stripped) >= 8 and art_chars >= max(6, len(stripped) // 2)


def cobs_decode(data: bytes) -> bytes:
    """De-stuffs COBS encoded data. Expects data without the trailing 0x00."""
    out = bytearray()
    pos = 0
    while pos < len(data):
        code = data[pos]
        if code == 0:
            break
        if code != 1 and pos + code > len(data) + 1:
            break

        next_pos = pos + code
        out.extend(data[pos + 1:min(next_pos, len(data))])
        pos = next_pos

        if code < 0xFF and pos < len(data):
            out.append(0)

    return bytes(out)


def bytes_to_str(arr):
    if isinstance(arr, str):
        arr = bytes(arr, "utf-8")
    if hasattr(arr, "__iter__"):
        return "".join("{:02X} ".format(x) for x in arr).strip()
    return "0x{:02X}".format(arr)


def _csv_line(*fields: object) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(fields)
    return buffer.getvalue()


def _decode_level(level_bits: int) -> str:
    return LEVELS.get(level_bits, "INFO")


def _decode_theta(theta_raw: int) -> float:
    return theta_raw * (360.0 / 65536.0)


def _expand_timestamp(raw_timestamp: int) -> int:
    global LAST_TIMESTAMP_RAW, TIMESTAMP_WRAP_OFFSET

    if LAST_TIMESTAMP_RAW is None:
        LAST_TIMESTAMP_RAW = raw_timestamp
        return raw_timestamp

    # PROS millis is cast down to uint16_t on the wire. Reconstruct a monotonic
    # timestamp by detecting wrap when the stream jumps sharply backwards.
    if raw_timestamp < LAST_TIMESTAMP_RAW and (LAST_TIMESTAMP_RAW - raw_timestamp) > 0x8000:
        TIMESTAMP_WRAP_OFFSET += 0x10000

    LAST_TIMESTAMP_RAW = raw_timestamp
    return TIMESTAMP_WRAP_OFFSET + raw_timestamp


def _decode_text(payload: bytes) -> str:
    return payload.decode("utf-8", errors="replace")


def _decode_watch_text(payload: bytes) -> str:
    value = _decode_text(payload)
    if value == "t":
        return "true"
    if value == "f":
        return "false"
    return value


def _decode_roster_name(payload: bytes) -> str:
    return payload.split(b"\0", 1)[0].decode("utf-8", errors="replace")


def _resolve_roster_label(item_id: int, prefer_elevated: bool) -> Optional[str]:
    if prefer_elevated and item_id in ELEVATED_ROSTER:
        return ELEVATED_ROSTER[item_id]
    return DEFAULT_ROSTER.get(item_id)


def _render_pending_event(event: Tuple[object, ...], label: str) -> str:
    kind = event[0]

    if kind == "watch_numeric":
        _, ts, level_name, watch_id, value, _tripped = event
        return _csv_line("[WATCH]", ts, level_name, watch_id, label, f"{value:.2f}")

    if kind == "watch_text":
        _, ts, level_name, watch_id, value, _tripped = event
        return _csv_line("[WATCH]", ts, level_name, watch_id, label, value)

    if kind == "wpoint_created":
        _, ts, wp_id, tar_x, tar_y, tar_theta_raw, lin_tol, theta_tol, timeout, retriggerable = event
        has_theta = not math.isnan(theta_tol)
        tar_theta = f"{_decode_theta(tar_theta_raw):.2f}" if has_theta else "NA"
        theta_tol_str = f"{theta_tol:.2f}" if has_theta else "NA"
        timeout_str = timeout if timeout != 0 else "NA"
        return _csv_line(
            "[WPOINT]",
            ts,
            "CREATED",
            wp_id,
            label,
            f"{tar_x:.2f}",
            f"{tar_y:.2f}",
            tar_theta,
            timeout_str,
            f"{lin_tol:.2f}",
            theta_tol_str,
            1 if retriggerable else 0,
        )

    if kind == "wpoint_status":
        _, ts, state_name, wp_id = event
        return _csv_line("[WPOINT]", ts, state_name, wp_id, label)

    return ""


def _queue_pending_event(item_id: int, event: Tuple[object, ...]) -> None:
    pending = PENDING_ROSTER_EVENTS[item_id]
    # Keep a bounded backlog per roster id so early events survive until the
    # matching roster arrives without allowing unbounded memory growth.
    if len(pending) >= MAX_PENDING_ROSTER_EVENTS_PER_ID:
        pending.pop(0)
    pending.append(event)


def _emit_rostered_event(item_id: int, prefer_elevated: bool, event: Tuple[object, ...]) -> str:
    label = _resolve_roster_label(item_id, prefer_elevated)
    if label is None:
        _queue_pending_event(item_id, event)
        return ""
    return _render_pending_event(event, label)


def _flush_pending_events(item_id: int) -> str:
    pending = PENDING_ROSTER_EVENTS.get(item_id)
    if not pending:
        return ""

    rendered: List[str] = []
    remaining: List[Tuple[object, ...]] = []

    for event in pending:
        kind = event[0]
        prefer_elevated = kind in ("watch_numeric", "watch_text") and bool(event[-1])
        label = _resolve_roster_label(item_id, prefer_elevated)
        if label is None:
            remaining.append(event)
            continue
        rendered.append(_render_pending_event(event, label))

    if remaining:
        PENDING_ROSTER_EVENTS[item_id] = remaining
    else:
        PENDING_ROSTER_EVENTS.pop(item_id, None)

    return "".join(rendered)


def _handle_pose(payload: bytes) -> str:
    ts, x, y, theta_raw, left_vel, right_vel = struct.unpack("<HffHbb", payload)
    ts = _expand_timestamp(ts)
    return _csv_line(
        "[POSE]",
        ts,
        f"{x:.2f}",
        f"{y:.2f}",
        f"{_decode_theta(theta_raw):.2f}",
        left_vel,
        right_vel,
    )


def _handle_waypoint(payload: bytes, subtype: int) -> str:
    if subtype == WPOINT_CREATED:
        legacy_size = struct.calcsize("<HHffHffI")
        ts, wp_id, tar_x, tar_y, tar_theta_raw, lin_tol, theta_tol, timeout = struct.unpack(
            "<HHffHffI", payload[:legacy_size]
        )
        retriggerable = len(payload) > legacy_size and payload[legacy_size] != 0
        ts = _expand_timestamp(ts)
        event = (
            "wpoint_created", ts, wp_id, tar_x, tar_y, tar_theta_raw,
            lin_tol, theta_tol, timeout, retriggerable,
        )
        return _emit_rostered_event(wp_id, False, event)

    if subtype in (WPOINT_REACHED, WPOINT_TIMEDOUT):
        ts, wp_id = struct.unpack("<HH", payload)
        ts = _expand_timestamp(ts)
        state_name = "REACHED" if subtype == WPOINT_REACHED else "TIMEDOUT"
        event = ("wpoint_status", ts, state_name, wp_id)
        return _emit_rostered_event(wp_id, False, event)

    return ""


def _handle_watch(payload: bytes, level_bits: int, subtype: int) -> str:
    level_name = _decode_level(level_bits)

    if subtype in (WATCH_NUMERIC, WATCH_NUMERIC_TRIPPED):
        ts, watch_id, value = struct.unpack("<HHf", payload)
        ts = _expand_timestamp(ts)
        tripped = subtype == WATCH_NUMERIC_TRIPPED
        event = ("watch_numeric", ts, level_name, watch_id, value, tripped)
        return _emit_rostered_event(watch_id, tripped, event)

    if subtype in (WATCH_TEXT, WATCH_TEXT_TRIPPED):
        ts, watch_id = struct.unpack("<HH", payload[:4])
        ts = _expand_timestamp(ts)
        value = _decode_watch_text(payload[4:])
        tripped = subtype == WATCH_TEXT_TRIPPED
        event = ("watch_text", ts, level_name, watch_id, value, tripped)
        return _emit_rostered_event(watch_id, tripped, event)

    return ""


def _handle_roster(payload: bytes, subtype: int) -> str:
    item_id, name_bytes = struct.unpack("<H24s", payload)
    name = _decode_roster_name(name_bytes)

    if subtype == 0x01:
        ELEVATED_ROSTER[item_id] = name
    else:
        DEFAULT_ROSTER[item_id] = name

    return _flush_pending_events(item_id)


def _handle_log(payload: bytes, level_bits: int) -> str:
    ts = _expand_timestamp(struct.unpack("<H", payload[:2])[0])
    msg = _decode_text(payload[2:])
    return f"[LOG],{ts},{_decode_level(level_bits)},{msg}\n"


def _expected_payload_len(msg_type: int, subtype: int) -> Optional[int]:
    if msg_type == MSG_TYPE_POSE:
        return struct.calcsize("<HffHbb")

    if msg_type == MSG_TYPE_WPOINT:
        if subtype == WPOINT_CREATED:
            return struct.calcsize("<HHffHffI")
        if subtype in (WPOINT_REACHED, WPOINT_TIMEDOUT):
            return struct.calcsize("<HH")
        return None

    if msg_type == MSG_TYPE_WATCH:
        if subtype in (WATCH_NUMERIC, WATCH_NUMERIC_TRIPPED):
            return struct.calcsize("<HHf")
        if subtype in (WATCH_TEXT, WATCH_TEXT_TRIPPED):
            return struct.calcsize("<HH")
        return None

    if msg_type == MSG_TYPE_ROSTER:
        return struct.calcsize("<H24s")

    if msg_type == MSG_TYPE_LOG:
        return struct.calcsize("<H")

    return None



def _parse_binary_frame(frame: bytes) -> Optional[str]:
    if not frame:
        return ""

    raw = cobs_decode(frame)
    if len(raw) < 1:
        return None

    header = raw[0]
    payload = raw[1:]

    msg_type = (header >> 5) & 0x07
    level_bits = (header >> 2) & 0x07
    subtype = header & 0x03

    expected_len = _expected_payload_len(msg_type, subtype)
    if expected_len is None:
        return None

    if msg_type in (MSG_TYPE_WATCH, MSG_TYPE_LOG):
        if len(payload) < expected_len:
            return None
    elif msg_type == MSG_TYPE_WPOINT and subtype == WPOINT_CREATED:
        if len(payload) not in (expected_len, expected_len + 1):
            return None
    elif len(payload) != expected_len:
        return None

    if msg_type == MSG_TYPE_POSE:
        return _handle_pose(payload)

    if msg_type == MSG_TYPE_WPOINT:
        return _handle_waypoint(payload, subtype)

    if msg_type == MSG_TYPE_WATCH:
        return _handle_watch(payload, level_bits, subtype)

    if msg_type == MSG_TYPE_ROSTER:
        return _handle_roster(payload, subtype)

    if msg_type == MSG_TYPE_LOG:
        return _handle_log(payload, level_bits)

    return None



def _decode_plain_text_or_hex(frame: bytes, encoding: str = "utf-8") -> str:
    candidates = [frame]
    try:
        decoded_cobs = cobs_decode(frame)
        if decoded_cobs and decoded_cobs != frame:
            candidates.append(decoded_cobs)
    except Exception:
        pass

    for candidate in candidates:
        try:
            return _decode_text_chunk(candidate, encoding=encoding, errors="strict")
        except Exception:
            continue

    return bytes_to_str(frame) + "\n"


def _decode_binary_frame(frame: bytes) -> str:
    try:
        parsed = _parse_binary_frame(frame)
        if parsed is not None:
            return parsed
    except Exception:
        pass
    return _decode_plain_text_or_hex(frame)


def _decode_text_chunk(chunk: bytes, encoding: str, errors: str) -> str:
    try:
        decoded = chunk.decode(encoding=encoding, errors=errors)
    except Exception:
        return bytes_to_str(chunk) + "\n"

    if _looks_like_banner_line(decoded):
        _reset_decoder_state()

    return decoded


def decode_bytes_to_str(data: Union[bytes, bytearray], encoding: str = "utf-8", errors: str = "strict") -> str:
    """
    Stream-aware decoder that can handle mixed ASCII terminal text and MVLib
    COBS-framed binary packets in the same read chunk.
    """
    global STREAM_BUFFER

    try:
        STREAM_BUFFER.extend(bytes(data))
    except Exception:
        return bytes_to_str(data) + "\n"

    outputs: List[str] = []

    while STREAM_BUFFER:
        nul_idx = STREAM_BUFFER.find(0)
        nl_idx = STREAM_BUFFER.find(10)

        if nul_idx == -1 and nl_idx == -1:
            break

        if nul_idx != -1:
            frame = bytes(STREAM_BUFFER[:nul_idx])
            parsed_frame = None
            try:
                parsed_frame = _parse_binary_frame(frame)
            except Exception:
                parsed_frame = None

            if parsed_frame is not None:
                del STREAM_BUFFER[:nul_idx + 1]
                outputs.append(parsed_frame)
                continue

        if nl_idx != -1 and (nul_idx == -1 or nl_idx < nul_idx):
            chunk = bytes(STREAM_BUFFER[:nl_idx + 1])
            del STREAM_BUFFER[:nl_idx + 1]
            outputs.append(_decode_text_chunk(chunk, encoding, errors))
            continue

        if nul_idx != -1:
            frame = bytes(STREAM_BUFFER[:nul_idx])
            del STREAM_BUFFER[:nul_idx + 1]
            outputs.append(bytes_to_str(frame) + "\n")
            continue

        break

    return "".join(outputs)
