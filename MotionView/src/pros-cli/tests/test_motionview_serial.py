import random
import struct
import unittest
from unittest.mock import patch

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
        decoder.STREAM_BUFFER.clear()
        decoder._reset_decoder_state()

    def decode_chunks(self, chunks) -> str:
        decoder.STREAM_BUFFER.clear()
        decoder._reset_decoder_state()
        # Every independently decoded stream gets the same authoritative time
        # and roster, including labels for both normal and elevated samples.
        prelude = [
            frame(decoder.MSG_TYPE_START, struct.pack("<IBI", 0, 2, 300_001)),
            frame(decoder.MSG_TYPE_ROSTER, struct.pack("<H24s", 7, b"State")),
            frame(decoder.MSG_TYPE_ROSTER, struct.pack("<H24s", 7, b"Alert"), subtype=1),
        ]
        decoder.decode_bytes_to_str(b"".join(packet + b"\0" for packet in prelude))
        return "".join(decoder.decode_bytes_to_str(chunk) for chunk in chunks)

    def assert_fragmentation_equivalent(self, encoded: bytes) -> None:
        expected = self.decode_chunks([encoded])
        self.assertEqual(decoder.STREAM_BUFFER, b"")
        for split in range(1, len(encoded)):
            with self.subTest(split=split, encoded=encoded.hex()):
                self.assertEqual(self.decode_chunks([encoded[:split], encoded[split:]]), expected)
                self.assertEqual(decoder.STREAM_BUFFER, b"")
        self.assertEqual(self.decode_chunks([bytes([byte]) for byte in encoded]), expected)

    def test_preserves_a_printable_binary_prefix_ending_in_newline(self) -> None:
        y = struct.unpack("<f", b"\x01\x00\x80\x3f")[0]
        encoded = frame(decoder.MSG_TYPE_POSE, struct.pack("<HffHbb", 266, 12.345, y, 0, 0, 0), level=7) + b"\0"
        self.assertEqual(encoded[:3], b"\t<\n")
        self.assertEqual(decoder.decode_bytes_to_str(encoded[:3]), "")
        self.assertEqual(decoder.decode_bytes_to_str(encoded[3:]), "[POSE],266,12.35,1.00,0.00,0,0\n")
        self.assert_fragmentation_equivalent(encoded)

    def test_all_packet_types_are_independent_of_read_boundaries(self) -> None:
        packets = [
            frame(decoder.MSG_TYPE_POSE, struct.pack("<HffHbb", 10, 12.345, 1.0, 10, -10, 10), level=7),
            frame(decoder.MSG_TYPE_POSE, struct.pack("<HffHff", 266, 1.0, 2.0, 10, float("nan"), float("-inf")), subtype=1),
            frame(decoder.MSG_TYPE_WPOINT, struct.pack("<HHffHffI", 10, 7, 1.0, 2.0, 0, 1.0, float("nan"), 1000), subtype=1),
            frame(decoder.MSG_TYPE_WPOINT, struct.pack("<HHffHffIB", 10, 7, 1.0, 2.0, 0, 1.0, 2.0, 1000, 1), subtype=1),
            frame(decoder.MSG_TYPE_WPOINT, struct.pack("<HH", 10, 7), subtype=2),
            frame(decoder.MSG_TYPE_WPOINT, struct.pack("<HH", 10, 7), subtype=3),
            frame(decoder.MSG_TYPE_WATCH, struct.pack("<HHf", 10, 7, 12.345)),
            frame(decoder.MSG_TYPE_WATCH, struct.pack("<HHf", 10, 7, -12.345), subtype=1),
            frame(decoder.MSG_TYPE_WATCH, struct.pack("<HH", 266, 7) + 'first, "second"\tπ\nthird'.encode(), subtype=2),
            frame(decoder.MSG_TYPE_WATCH, struct.pack("<HH", 10, 7) + b"true", subtype=3),
            frame(decoder.MSG_TYPE_WATCH, struct.pack("<HH", 10, 7) + b"A" * 300 + b"\n" + b"B" * 210, subtype=2),
            frame(decoder.MSG_TYPE_ROSTER, struct.pack("<H24s", 7, b"Default, label")),
            frame(decoder.MSG_TYPE_ROSTER, struct.pack("<H24s", 7, b"Elevated label"), subtype=1),
            frame(decoder.MSG_TYPE_LOG, struct.pack("<H", 10) + b"User message", level=2),
            frame(decoder.MSG_TYPE_LOG, struct.pack("<H", 10) + b"System message", level=2, subtype=1),
            frame(decoder.MSG_TYPE_START, struct.pack("<I", 70_000)),
            frame(decoder.MSG_TYPE_START, struct.pack("<IBI", 70_000, 2, 300_001)),
        ]
        for packet in packets:
            with self.subTest(packet=packet.hex()):
                self.assert_fragmentation_equivalent(packet + b"\0")

    def test_mixed_text_and_binary_stream_is_independent_of_chunking(self) -> None:
        stream = (
            b"[UI] connected\n----------------\n"
            + frame(decoder.MSG_TYPE_POSE, struct.pack("<HffHbb", 266, 12.345, struct.unpack("<f", b"\x01\x00\x80\x3f")[0], 0, 0, 0), level=7) + b"\0"
            + b"[LOG],270,INFO,plain text log\n"
            + frame(decoder.MSG_TYPE_WATCH, struct.pack("<HHf", 280, 7, 42.0), level=2) + b"\0"
        )
        self.assert_fragmentation_equivalent(stream)
        expected = self.decode_chunks([stream])
        self.assertIn("[POSE],266,12.35,1.00", expected)
        self.assertIn("[WATCH],280,INFO,7,State,42.00", expected)
        randomizer = random.Random(140)
        for _ in range(100):
            chunks = []
            offset = 0
            while offset < len(stream):
                size = randomizer.randint(1, 17)
                chunks.append(stream[offset:offset + size])
                offset += size
            self.assertEqual(self.decode_chunks(chunks), expected)

    def test_text_never_resets_roster_or_timestamp_state(self) -> None:
        decoder.DEFAULT_ROSTER[7] = "State"
        decoder._seed_timestamp(70_000)
        for line in [
            b"----------------\n",
            b"Powered by PROS for VEX V5\n",
            b"\x1b[32mVersion: 4.2.2 Platform: V5\x1b[0m\n",
        ]:
            # A NUL also lets ambiguous raw-text prefixes be emitted. Text
            # itself, even a real banner, is not an authoritative reset.
            decoder.decode_bytes_to_str(line + b"\0")
            self.assertEqual(decoder.DEFAULT_ROSTER, {7: "State"})
        self.assertEqual(decoder._expand_timestamp(4_484), 70_020)

    def test_rejects_truncated_cobs_instead_of_accepting_partial_payload(self) -> None:
        packet = frame(decoder.MSG_TYPE_POSE, struct.pack("<HffHbb", 10, 1.0, 2.0, 0, 0, 0))
        self.assertEqual(packet[-1], 1)
        malformed = packet[:-1] + b"\x02"
        self.assertIsNone(decoder._parse_binary_frame(malformed))
        output = decoder.decode_bytes_to_str(malformed + b"\0" + packet + b"\0")
        self.assertEqual(output.count("[POSE],"), 1)
        self.assertIn("[POSE],10,1.00,2.00,0.00,0,0\n", output)

    def test_large_pose_coordinates_round_trip_without_rescaling(self) -> None:
        for x in [398_790.0, -398_790.0, 39.875]:
            packet = frame(decoder.MSG_TYPE_POSE, struct.pack("<HffHbb", 10, x, 2.0, 0, 0, 0), level=7) + b"\0"
            self.assertEqual(self.decode_chunks([packet]), f"[POSE],10,{x:.2f},2.00,0.00,0,0\n")
            self.assert_fragmentation_equivalent(packet)

    def test_expands_a_normal_uint16_rollover(self) -> None:
        self.assertEqual(decoder._expand_timestamp(65_520), 65_520)
        self.assertEqual(decoder._expand_timestamp(20), 65_556)

    def test_resume_continues_short_gaps_and_multiple_wraps(self) -> None:
        for last, gap_ms in [(70_040, 20), (65_520, 36), (50_000, 35_000), (70_040, 135_000)]:
            with self.subTest(last=last, gap_ms=gap_ms):
                decoder._reset_decoder_state()
                decoder.resume_timestamp(last, 1_000.0)
                with patch.object(decoder.time, "monotonic", return_value=1_000 + gap_ms / 1000):
                    self.assertEqual(decoder._expand_timestamp((last + gap_ms) & 0xFFFF), last + gap_ms)
                    self.assertEqual(decoder._expand_timestamp((last + gap_ms + 20) & 0xFFFF), last + gap_ms + 20)

    def test_start_overrides_resume_before_the_first_data_packet(self) -> None:
        decoder.resume_timestamp(700_040, 0.0)
        with patch.object(decoder.time, "monotonic", return_value=1_000.0):
            decoded = decoder._parse_binary_frame(frame(decoder.MSG_TYPE_START, struct.pack("<IBI", 0, 2, 300_001)))
            self.assertEqual(decoded, "[START],0,2,300001\n")
            self.assertFalse(decoder.TIMESTAMP_RESUME_PENDING)
            self.assertEqual(decoder._expand_timestamp(20), 20)

    def test_invalid_resume_anchor_does_not_change_decoder_state(self) -> None:
        for timestamp, observed in [(-1, 0), (True, 0), (1.5, 0), (9_007_199_254_740_992, 0), (1, float("nan")), (1, float("inf"))]:
            with self.subTest(timestamp=timestamp, observed=observed):
                with self.assertRaises(ValueError):
                    decoder.resume_timestamp(timestamp, observed)
                self.assertIsNone(decoder.LAST_TIMESTAMP_RAW)

    def test_start_resets_a_70_second_run_to_zero(self) -> None:
        self.assertEqual(decoder._expand_timestamp(65_520), 65_520)
        self.assertEqual(decoder._expand_timestamp(4_464), 70_000)

        decoded = decoder._parse_binary_frame(
            frame(decoder.MSG_TYPE_START, struct.pack("<IBI", 0, 2, 300_001))
        )

        self.assertEqual(decoded, "[START],0,2,300001\n")
        self.assertEqual(decoder._expand_timestamp(120), 120)

    def test_expands_a_wrap_missed_during_a_long_packet_gap(self) -> None:
        with patch.object(decoder.time, "monotonic", side_effect=[0.0, 35.0]):
            self.assertEqual(decoder._expand_timestamp(50_000), 50_000)
            # 85,000ms wraps to 19,464. Its backwards jump is less than half
            # a uint16 range, so the legacy decoder would miss this rollover.
            self.assertEqual(decoder._expand_timestamp(19_464), 85_000)

    def test_expands_multiple_wraps_during_a_long_packet_gap(self) -> None:
        with patch.object(decoder.time, "monotonic", side_effect=[0.0, 135.0]):
            self.assertEqual(decoder._expand_timestamp(50_000), 50_000)
            self.assertEqual(decoder._expand_timestamp(53_928), 185_000)

    def test_start_seeds_the_wall_clock_for_the_next_pose(self) -> None:
        with patch.object(decoder.time, "monotonic", side_effect=[0.0, 40.0, 40.02]):
            self.assertEqual(decoder._expand_timestamp(50_000), 50_000)
            self.assertEqual(decoder._seed_timestamp(100_000), 100_000)
            self.assertEqual(decoder._expand_timestamp(34_484), 100_020)

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

    def test_decodes_non_finite_pose_velocities_for_the_live_console(self) -> None:
        payload = struct.pack("<HffHff", 10, 1.0, 2.0, 0, float("nan"), float("-inf"))
        self.assertEqual(
            decoder._parse_binary_frame(
                frame(decoder.MSG_TYPE_POSE, payload, subtype=decoder.POSE_RAW_VELOCITIES)
            ),
            "[POSE],10,1.00,2.00,0.00,NaN,-Infinity\n",
        )


if __name__ == "__main__":
    unittest.main()
