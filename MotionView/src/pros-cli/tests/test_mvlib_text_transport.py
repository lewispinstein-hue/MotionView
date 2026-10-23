"""Compile actual MVLib text producers on the host and decode their packets."""
import csv
import io
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import pros.serial as decoder


class MVLibTextTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        compiler = shutil.which("clang++") or shutil.which("g++")
        if not compiler:
            raise unittest.SkipTest("MVLib transport fixture needs a host C++23 compiler")
        root = Path(__file__).resolve().parents[4]
        with tempfile.TemporaryDirectory(prefix="motionview-text-test-") as temporary:
            executable = Path(temporary) / "terminal-text-fixture"
            subprocess.run([
                compiler, "-std=c++23", "-I", str(root / "MVLib/include"),
                str(root / "MVLib/tests/host/terminalTextFixture.cpp"),
                "-o", str(executable),
            ], check=True, capture_output=True)
            cls.packets = subprocess.run([str(executable)], check=True, capture_output=True).stdout

    def setUp(self) -> None:
        decoder.STREAM_BUFFER.clear()
        decoder._reset_decoder_state()

    def test_live_text_remains_one_record_with_quotes_and_unicode_intact(self) -> None:
        text = decoder.decode_bytes_to_str(self.packets)
        lines = text.split("\n")
        self.assertEqual(len(lines), 6)  # Five records plus the final LF.
        expected = 'first second third  fourth,\t"π"'
        watches = list(csv.reader(io.StringIO(text)))
        self.assertEqual(watches[0], ["[WATCH]", "10", "INFO", "7", 'State,  "π"', expected])
        self.assertEqual(watches[1], ["[WATCH]", "10", "WARN", "7", 'State,  "π"', ""])
        self.assertEqual(lines[2], "[LOG],10,INFO," + expected)
        self.assertEqual(watches[3], ["[WATCH]", "10", "INFO", "8", "A" * 22 + " ", "x" * 510 + " "])
        self.assertEqual(lines[4], "[LOG],10,INFO,[MVLIB] " + "x" * 510 + " ")
        self.assertNotIn("\r", text)

    def test_sanitized_text_packets_survive_byte_at_a_time_delivery(self) -> None:
        expected = decoder.decode_bytes_to_str(self.packets)
        decoder.STREAM_BUFFER.clear()
        decoder._reset_decoder_state()
        actual = "".join(decoder.decode_bytes_to_str(bytes([byte])) for byte in self.packets)
        self.assertEqual(actual, expected)
        self.assertEqual(decoder.STREAM_BUFFER, b"")


if __name__ == "__main__":
    unittest.main()
