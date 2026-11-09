import contextlib
import importlib
import io
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import click

from pros.serial.devices.vex.v5_device import V5Device
from pros.serial.ports.port_guard import controller_port_in_use
from pros.serial.ports.v5_wireless_port import V5WirelessPort
from pros.serial.terminal.errors import friendly_terminal_error
from pros.serial.devices.vex.comm_error import VEXCommError


class WirelessTerminalTests(unittest.TestCase):
    def test_fifo_drains_cached_frames_before_polling_again(self):
        device = V5Device.__new__(V5Device)
        device._serial_cache = b''
        device.channel_map = {'download': 1}
        replies = iter([b'\x00\x11\x00\x22\x00\x33', b'\x00\x00\x44\x00'])
        calls = []

        def receive(*args, **kwargs):
            calls.append(args)
            return next(replies)

        device._txrx_ext_packet = receive
        self.assertEqual(device.user_fifo_read(), b'\x11\x00')
        self.assertEqual(device.user_fifo_read(), b'\x22\x00')
        self.assertEqual(len(calls), 1)
        self.assertEqual(device.user_fifo_read(), b'\x33\x00')
        self.assertEqual(device.user_fifo_read(), b'\x44\x00')
        self.assertEqual(len(calls), 2)

    def test_port_returns_remaining_bytes_without_an_extra_radio_request(self):
        port = V5WirelessPort.__new__(V5WirelessPort)
        port.buffer = bytearray()
        calls = []
        port.device = SimpleNamespace(user_fifo_read=lambda: calls.append(1) or b'\x11\x00')
        self.assertEqual(port.read(1), b'\x11')
        self.assertEqual(port.read(), b'\x00')
        self.assertEqual(len(calls), 1)

    @unittest.skipIf(os.name == 'nt', 'Windows serial port exclusivity supplies this check')
    def test_controller_start_refuses_an_occupied_port(self):
        with patch('pros.serial.ports.port_guard.shutil.which', return_value='/usr/sbin/lsof'), \
             patch('pros.serial.ports.port_guard.subprocess.run', return_value=SimpleNamespace(returncode=1, stdout='999999\n')):
            self.assertTrue(controller_port_in_use('/dev/test-controller'))
        with patch('pros.serial.ports.port_guard.shutil.which', return_value='/usr/sbin/lsof'), \
             patch('pros.serial.ports.port_guard.subprocess.run', return_value=SimpleNamespace(returncode=1, stdout='')):
            self.assertFalse(controller_port_in_use('/dev/test-controller'))

    @unittest.skipIf(os.name == 'nt', 'Windows serial port exclusivity supplies this check')
    def test_controller_start_stops_if_the_port_check_cannot_run(self):
        with patch('pros.serial.ports.port_guard.shutil.which', return_value=None), \
             patch('pros.serial.ports.port_guard.os.path.isfile', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'Cannot check'):
                controller_port_in_use('/dev/test-controller')

    def test_errors_do_not_expose_protocol_dump(self):
        message = friendly_terminal_error(VEXCommError(
            "Device NACK'd with reason: Attempted to download/upload uninitialized",
            'TX:C9 36 B8 RX:AA 55',
        ))
        self.assertIn('Finish the program upload', message)
        self.assertNotIn('TX:', message)

    def test_cli_refuses_upload_before_opening_controller(self):
        with tempfile.TemporaryDirectory() as config_dir, \
             patch.object(click, 'get_app_dir', return_value=config_dir):
            entry = importlib.import_module('motionview_terminal_entry')
            terminal_module = importlib.import_module('pros.cli.terminal')
            from pros.ga.analytics import analytics

            output = io.StringIO()
            with patch.object(analytics, 'send', return_value=None), \
                 patch.object(terminal_module, 'resolve_v5_port', return_value=('/dev/test-controller', True)), \
                 patch.object(terminal_module, 'controller_port_in_use', return_value=True), \
                 patch.object(terminal_module, 'V5WirelessPort') as wireless, \
                 patch.object(sys, 'argv', ['pros', 'terminal', '--no-banner', 'v5']), \
                 contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                with self.assertRaises(SystemExit) as failure:
                    entry.main()

            self.assertNotEqual(failure.exception.code, 0)
            self.assertIn('Finish the program upload', output.getvalue())
            self.assertNotIn('╭', output.getvalue())
            wireless.assert_not_called()

    def test_ready_signal_precedes_receiver_start(self):
        from pros.serial.terminal.terminal import Terminal
        order = []
        terminal = Terminal.__new__(Terminal)
        terminal.console = SimpleNamespace(setup=lambda: order.append('setup'))
        terminal.alive = threading.Event()
        terminal.alive.set()
        terminal._start_rx = lambda: order.append('receiver')
        terminal.allow_input = False

        terminal.start(on_ready=lambda: order.append('ready'))

        self.assertEqual(order, ['setup', 'ready', 'receiver'])

    def test_entry_filters_urllib3_warning_before_importing_dependencies(self):
        entry_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as config_dir:
            result = subprocess.run(
                [sys.executable, '-c', (
                    'import click\n'
                    'from unittest.mock import patch\n'
                    f'with patch.object(click, "get_app_dir", return_value={config_dir!r}):\n'
                    '    import motionview_terminal_entry\n'
                )],
                env={**os.environ, 'PYTHONPATH': str(entry_root), 'PYTHONWARNINGS': 'default'},
                capture_output=True, text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('NotOpenSSLWarning', result.stderr)


if __name__ == '__main__':
    unittest.main()
