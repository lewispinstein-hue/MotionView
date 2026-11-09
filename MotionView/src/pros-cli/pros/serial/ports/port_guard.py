"""Protect a Controller upload from another serial client."""

import os
import shutil
import subprocess


def controller_port_in_use(port: str) -> bool:
    """Return whether another process holds the Controller's serial device."""
    if os.name == 'nt':
        # Windows serial devices reject a second open themselves.
        return False

    lsof = shutil.which('lsof')
    if not lsof and os.path.isfile('/usr/sbin/lsof'):
        lsof = '/usr/sbin/lsof'
    if not lsof:
        raise RuntimeError('Cannot check whether the V5 Controller is being used by an upload.')

    # /dev/cu.* and /dev/tty.* can be aliases for the same macOS serial port.
    paths = {os.path.realpath(port)}
    if port.startswith('/dev/cu.'):
        paths.add(os.path.realpath('/dev/tty.' + port[len('/dev/cu.'):]))
    elif port.startswith('/dev/tty.'):
        paths.add(os.path.realpath('/dev/cu.' + port[len('/dev/tty.'):]))

    try:
        result = subprocess.run(
            [lsof, '-t', '--', *sorted(paths)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, timeout=2,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError('Cannot check whether the V5 Controller is being used by an upload.') from error

    if result.returncode not in (0, 1):
        raise RuntimeError('Cannot check whether the V5 Controller is being used by an upload.')
    # lsof may return 1 when an alias does not exist, even after reporting a
    # process on the other path. The reported PIDs are the useful result.
    return any(
        pid.strip().isdigit() and int(pid) != os.getpid()
        for pid in result.stdout.splitlines()
    )
