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


def frame(message_type: int, payload: bytes) -> bytes:
    return cobs_encode(bytes([(message_type & 0x07) << 5]) + payload)


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
            frame(decoder.MSG_TYPE_START, struct.pack("<I", 0))
        )

        self.assertEqual(decoded, "[START],0\n")
        self.assertEqual(decoder._expand_timestamp(120), 120)

    def test_start_clears_roster_before_the_new_run_repopulates_it(self) -> None:
        roster_payload = struct.pack("<H24s", 7, b"Previous Label\0")
        decoder._parse_binary_frame(frame(decoder.MSG_TYPE_ROSTER, roster_payload))
        self.assertEqual(decoder.DEFAULT_ROSTER[7], "Previous Label")

        decoder._parse_binary_frame(
            frame(decoder.MSG_TYPE_START, struct.pack("<I", 1_250))
        )
        self.assertFalse(decoder.DEFAULT_ROSTER)
        self.assertFalse(decoder.ELEVATED_ROSTER)

        fresh_roster_payload = struct.pack("<H24s", 7, b"Fresh Label\0")
        decoder._parse_binary_frame(frame(decoder.MSG_TYPE_ROSTER, fresh_roster_payload))
        self.assertEqual(decoder.DEFAULT_ROSTER[7], "Fresh Label")


if __name__ == "__main__":
    unittest.main()
