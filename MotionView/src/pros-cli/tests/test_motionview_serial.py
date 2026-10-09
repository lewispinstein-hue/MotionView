import struct
import unittest

import pros.serial as decoder


def cobs_encode(data: bytes) -> bytes:
    """Small test-only COBS encoder; production only needs the decoder."""
    encoded = bytearray([0])
    code_index = 0
    code = 1
    for byte in data:
        if byte == 0:
            encoded[code_index] = code
            code_index = len(encoded)
            encoded.append(0)
            code = 1
        else:
            encoded.append(byte)
            code += 1
            if code == 0xFF:
                encoded[code_index] = code
                code_index = len(encoded)
                encoded.append(0)
                code = 1
    encoded[code_index] = code
    return bytes(encoded)


def frame(message_type: int, payload: bytes, level: int = 0, subtype: int = 0) -> bytes:
    header = ((message_type & 0x07) << 5) | ((level & 0x07) << 2) | (subtype & 0x03)
    return cobs_encode(bytes([header]) + payload)


class MotionViewSerialDecoderTests(unittest.TestCase):
    def setUp(self) -> None:
        decoder._reset_decoder_state()

    def test_expands_a_normal_uint16_rollover(self) -> None:
        self.assertEqual(decoder._expand_timestamp(65_520), 65_520)
        self.assertEqual(decoder._expand_timestamp(20), 65_556)

    def test_start_resets_a_70_second_run_to_zero(self) -> None:
        self.assertEqual(decoder._expand_timestamp(65_520), 65_520)
        self.assertEqual(decoder._expand_timestamp(4_464), 70_000)

        decoded = decoder._parse_binary_frame(
            frame(decoder.MSG_TYPE_START, struct.pack("<IBI", 0, 2, 300_001))
        )

        self.assertEqual(decoded, "[START],0,2,300001\n")
        self.assertEqual(decoder._expand_timestamp(120), 120)

    def test_accepts_a_legacy_start_frame(self) -> None:
        decoded = decoder._parse_binary_frame(
            frame(decoder.MSG_TYPE_START, struct.pack("<I", 1_250))
        )

        self.assertEqual(decoded, "[START],1250\n")

    def test_start_clears_roster_before_the_new_run_repopulates_it(self) -> None:
        roster_payload = struct.pack("<H24s", 7, b"Previous Label\0")
        decoder._parse_binary_frame(frame(decoder.MSG_TYPE_ROSTER, roster_payload))
        self.assertEqual(decoder.DEFAULT_ROSTER[7], "Previous Label")

        decoder._parse_binary_frame(
            frame(decoder.MSG_TYPE_START, struct.pack("<IBI", 1_250, 0, 300_001))
        )
        self.assertFalse(decoder.DEFAULT_ROSTER)
        self.assertFalse(decoder.ELEVATED_ROSTER)

        fresh_roster_payload = struct.pack("<H24s", 7, b"Fresh Label\0")
        decoder._parse_binary_frame(frame(decoder.MSG_TYPE_ROSTER, fresh_roster_payload))
        self.assertEqual(decoder.DEFAULT_ROSTER[7], "Fresh Label")

    def test_system_log_has_the_mvlib_prefix(self) -> None:
        payload = struct.pack("<H", 1_250) + b"Logger started"

        decoded = decoder._parse_binary_frame(
            frame(
                decoder.MSG_TYPE_LOG,
                payload,
                level=2,
                subtype=decoder.LOG_SOURCE_SYSTEM,
            )
        )

        self.assertEqual(decoded, "[LOG],1250,INFO,[MVLIB] Logger started\n")

    def test_user_log_is_not_prefixed(self) -> None:
        payload = struct.pack("<H", 1_250) + b"Autonomous started"

        decoded = decoder._parse_binary_frame(
            frame(
                decoder.MSG_TYPE_LOG,
                payload,
                level=2,
                subtype=decoder.LOG_SOURCE_USER,
            )
        )

        self.assertEqual(decoded, "[LOG],1250,INFO,Autonomous started\n")

    def test_keeps_a_partial_cobs_frame_with_an_in_band_newline(self) -> None:
        # The timestamp's low byte survives COBS encoding as 0x0A.  Supplying
        # only that prefix must not cause the decoder to mistake it for a text
        # line delimiter and discard the rest of the binary pose packet.
        payload = struct.pack("<HffHbb", 10, 1.0, 2.0, 0, 0, 0)
        encoded = frame(decoder.MSG_TYPE_POSE, payload) + b"\0"
        newline_index = encoded.index(b"\x0A")

        self.assertEqual(decoder.decode_bytes_to_str(encoded[:newline_index + 1]), "")
        self.assertEqual(
            decoder.decode_bytes_to_str(encoded[newline_index + 1:]),
            "[POSE],10,1.00,2.00,0.00,0,0\n",
        )


if __name__ == "__main__":
    unittest.main()
