"""Bridge regressions that do not need a V5 device or a running HTTP server."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import venv


BRIDGE_PATH = Path(__file__).resolve().parents[1] / "src/bridge.py"
spec = importlib.util.spec_from_file_location("motionview_test_bridge", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FakeProcess:
    def __init__(self, reader, returncode=0):
        self.stdout = reader
        self.returncode = None
        self.exit_code = returncode
        self.waited = False

    async def wait(self):
        self.waited = True
        self.returncode = self.exit_code
        return self.returncode


class FakeWebSocket:
    def __init__(self):
        self.lines = []
        self.received = asyncio.Event()

    async def send_text(self, line):
        self.lines.append(line)
        self.received.set()


class PipeReaderTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.socket = FakeWebSocket()
        self.clients_patch = patch.object(bridge, "clients", {self.socket})
        self.lock_patch = patch.object(bridge, "_clients_lock", asyncio.Lock())
        self.clients_patch.start()
        self.lock_patch.start()
        self.runner = bridge.ProsTerminalRunner()
        self.runner._ensure_broadcast_worker()

    async def asyncTearDown(self):
        if self.runner.reader_task:
            self.runner.reader_task.cancel()
            try:
                await self.runner.reader_task
            except asyncio.CancelledError:
                pass
        await self.runner._stop_broadcast_worker()
        self.lock_patch.stop()
        self.clients_patch.stop()

    async def read_to_exit(self, reader, returncode=0):
        process = FakeProcess(reader, returncode)
        self.runner.proc = process
        await asyncio.wait_for(self.runner._read_pipe_output(), timeout=2)
        await asyncio.wait_for(self.runner._broadcast_queue.join(), timeout=2)
        self.assertTrue(process.waited)
        self.assertIsNone(self.runner.proc)
        return self.socket.lines

    async def test_oversized_complete_line_reports_error_and_next_pose_survives(self):
        reader = asyncio.StreamReader()
        reader.feed_data(b"x" * 70_000 + b"\n[POSE],10,1,2,0,0,0\n")
        reader.feed_eof()
        self.assertEqual(await self.read_to_exit(reader), [
            "Decoder Error: LimitOverrunError: Separator is found, but chunk is longer than limit",
            "[POSE],10,1,2,0,0,0",
            "[INTERNAL] terminal closed",
        ])

    async def test_fragmented_oversized_line_discards_tail_and_reports_only_once(self):
        reader = asyncio.StreamReader()
        process = FakeProcess(reader)
        self.runner.proc = process
        self.runner.reader_task = asyncio.create_task(self.runner._read_pipe_output())
        reader.feed_data(b"x" * 70_000)
        # The diagnostic must reach the websocket before the bad line ends.
        await asyncio.wait_for(self.socket.received.wait(), timeout=2)
        self.assertEqual(self.socket.lines, [
            "Decoder Error: LimitOverrunError: Separator is not found, and chunk exceed the limit",
        ])
        reader.feed_data(b"y" * 70_000)
        # This looks like a pose, but is still part of the discarded line.
        reader.feed_data(b"[POSE],10,999,999,0,0,0\n[POSE],20,1,2,0,0,0\n")
        reader.feed_eof()
        task = self.runner.reader_task
        await asyncio.wait_for(task, timeout=2)
        await asyncio.wait_for(self.runner._broadcast_queue.join(), timeout=2)
        self.assertEqual(self.socket.lines[1:], [
            "[POSE],20,1,2,0,0,0",
            "[INTERNAL] terminal closed",
        ])
        self.assertTrue(process.waited)
        self.assertIsNone(self.runner.proc)

    async def test_each_oversized_line_gets_one_diagnostic(self):
        reader = asyncio.StreamReader(limit=32)
        reader.feed_data(b"x" * 33 + b"\nok\n" + b"y" * 100 + b"\nnext\n")
        reader.feed_eof()
        lines = await self.read_to_exit(reader)
        diagnostics = [line for line in lines if line.startswith("Decoder Error:")]
        self.assertEqual(len(diagnostics), 2)
        self.assertEqual([line for line in lines if not line.startswith("Decoder Error:")], [
            "ok", "next", "[INTERNAL] terminal closed",
        ])

    async def test_eof_during_discard_still_reaps_process_and_notifies_exit(self):
        reader = asyncio.StreamReader(limit=32)
        reader.feed_data(b"x" * 100)
        reader.feed_eof()
        lines = await self.read_to_exit(reader, returncode=1)
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("Decoder Error:"))
        self.assertEqual(lines[1], "[UI] terminal exited (code 1)")

    async def test_boundary_length_blank_lines_and_final_unterminated_record(self):
        reader = asyncio.StreamReader(limit=32)
        reader.feed_data(b"x" * 32 + b"\n\r\n  \n[LOG],10,INFO,\xcf\x80")
        reader.feed_eof()
        self.assertEqual(await self.read_to_exit(reader), [
            "x" * 32, "[LOG],10,INFO,π", "[INTERNAL] terminal closed",
        ])

    async def test_reader_can_be_cancelled_while_discarding(self):
        reader = asyncio.StreamReader(limit=32)
        self.runner.proc = FakeProcess(reader)
        self.runner.reader_task = asyncio.create_task(self.runner._read_pipe_output())
        reader.feed_data(b"x" * 100)
        await asyncio.wait_for(self.socket.received.wait(), timeout=2)
        task = self.runner.reader_task
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task


class ProsCommandTests(unittest.TestCase):
    def test_launch_resume_uses_elapsed_time_and_removes_inherited_anchor(self):
        resume = bridge.TimestampResume(timestampMs=70_040, elapsedMs=135_000)
        with patch.object(bridge.time, "monotonic", return_value=1_000.0), \
                patch.dict(os.environ, {"MOTIONVIEW_TIMESTAMP_ANCHOR": "stale"}):
            env = bridge._pros_launch_env(resume)
            self.assertEqual(json.loads(env["MOTIONVIEW_TIMESTAMP_ANCHOR"]), {
                "timestamp": 70_040, "monotonic": 865.0,
            })
            self.assertNotIn("MOTIONVIEW_TIMESTAMP_ANCHOR", bridge._pros_launch_env())

    def test_start_request_rejects_invalid_timestamp_context(self):
        for context in [
            {"timestampMs": -1, "elapsedMs": 0},
            {"timestampMs": 1.5, "elapsedMs": 0},
            {"timestampMs": 1, "elapsedMs": -1},
            {"timestampMs": 1, "elapsedMs": float("inf")},
        ]:
            with self.subTest(context=context), self.assertRaises(ValueError):
                bridge.StartRequest.model_validate({"resume": context})

    def test_fallback_keeps_venv_symlink_and_environment_only_import(self):
        with tempfile.TemporaryDirectory(prefix="motionview-python-test-") as temporary:
            root = Path(temporary).resolve()
            environment = root / "environment"
            venv.EnvBuilder(with_pip=False, symlinks=os.name != "nt").create(environment)
            python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            env = os.environ.copy()
            env.pop("PYTHONPATH", None)
            env.pop("PYTHONHOME", None)
            site_packages = subprocess.check_output([
                str(python), "-c", "import sysconfig; print(sysconfig.get_path('purelib'))",
            ], env=env, text=True).strip()
            (Path(site_packages) / "motionview_environment_only.py").write_text("value = 140\n")
            source = root / "MotionView/src"
            entry = source / "pros-cli/motionview_terminal_entry.py"
            entry.parent.mkdir(parents=True)
            entry.write_text(
                "import json, sys, motionview_environment_only\n"
                "print(json.dumps([sys.prefix, motionview_environment_only.value]))\n"
            )
            with patch.object(bridge, "__file__", str(source / "bridge.py")), \
                    patch.object(bridge.sys, "executable", str(python)), \
                    patch.object(bridge.sys, "frozen", False, create=True):
                command = bridge.resolve_pros_command()
            self.assertEqual(command, [str(python), str(entry)])
            output = subprocess.check_output(command, env=env, text=True)
            self.assertEqual(json.loads(output), [str(environment), 140])
            if python.is_symlink():
                self.assertNotEqual(command[0], str(python.resolve()))
                base_import = subprocess.run([
                    str(python.resolve()), "-c", "import motionview_environment_only",
                ], env=env, capture_output=True)
                self.assertNotEqual(base_import.returncode, 0)

    def test_explicit_project_environment_still_takes_precedence(self):
        with tempfile.TemporaryDirectory(prefix="motionview-python-test-") as temporary:
            project = Path(temporary).resolve()
            entry = project / "src/pros-cli/motionview_terminal_entry.py"
            entry.parent.mkdir(parents=True)
            entry.touch()
            python = project / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            python.parent.mkdir(parents=True)
            python.touch()
            with patch.object(bridge, "__file__", str(project / "src/bridge.py")), \
                    patch.object(bridge.sys, "frozen", False, create=True):
                self.assertEqual(bridge.resolve_pros_command(), [str(python), str(entry)])

    def test_packaged_bridge_uses_bundled_executable(self):
        with patch.object(bridge.sys, "frozen", True, create=True), \
                patch.object(bridge, "resolve_pros_exe", return_value="/bundle/motionview-pros"):
            self.assertEqual(bridge.resolve_pros_command(), ["/bundle/motionview-pros"])


if __name__ == "__main__":
    unittest.main()
