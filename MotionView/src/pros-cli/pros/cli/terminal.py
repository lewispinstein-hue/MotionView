import os
import signal
import time

import click
import sys

import pros.serial.devices as devices
from pros.serial.ports import DirectPort
from pros.common.utils import logger
from .common import default_options, resolve_v5_port, resolve_cortex_port, pros_root
from pros.serial.ports.v5_wireless_port import V5WirelessPort
from pros.serial.ports.port_guard import controller_port_in_use

@pros_root
def terminal_cli():
    pass


@terminal_cli.command()
@default_options
@click.argument('port', default='default')
@click.option('--backend', type=click.Choice(['share', 'solo']), default='solo',
              help='Backend port of the terminal. See above for details')
@click.option('--raw', is_flag=True, default=False,
              help='Don\'t process the data.')
@click.option('--hex', is_flag=True, default=False, help="Display data as hexadecimal values. Unaffected by --raw")
@click.option('--ports', nargs=2, type=int, default=(None, None),
              help='Specify 2 ports for the "share" backend. The default option deterministically selects ports '
                   'based on the serial port name')
@click.option('--banner/--no-banner', 'request_banner', default=True)
@click.option('--output', nargs = 1, type=str, is_eager = True, help='Redirect terminal output to a file', default=None)

def terminal(port: str, backend: str, **kwargs):
    """
    Open a terminal to a serial port

    There are two possible backends for the terminal: "share" or "solo". In "share" mode, a server/bridge is created
    so that multiple PROS processes (such as another terminal or flash command) may communicate with the device. In the
    simpler solo mode, only one PROS process may communicate with the device. The default mode is "share", but "solo"
    may be preferred when "share" doesn't perform adequately.

    Note: share backend is not yet implemented.
    """       
    from pros.ga.analytics import analytics
    from pros.serial.devices.vex.v5_user_device import V5UserDevice
    from pros.serial.terminal import Terminal
    analytics.send("terminal")
    is_v5_user_joystick = False
    if port == 'default':
        import pros.conductor as c
        project_path = c.Project.find_project(os.getcwd())
        if project_path is None:
            v5_port, is_v5_user_joystick = resolve_v5_port(None, 'user', quiet=True)
            cortex_port = resolve_cortex_port(None, quiet=True)
            if ((v5_port is None) ^ (cortex_port is None)) or (v5_port is not None and v5_port == cortex_port):
                port = v5_port or cortex_port
            else:
                raise click.ClickException('Select a PROS project in MotionView before starting live streaming.')
        else:
            project = c.Project(project_path)
            port = project.target

    target = port
    if port == 'v5':
        port = None
        port, is_v5_user_joystick = resolve_v5_port(port, 'user', quiet=True)
    elif port == 'cortex':
        port = None
        port = resolve_cortex_port(port, quiet=True)
        kwargs['raw'] = True
    if not port:
        if target == 'cortex':
            raise click.ClickException('No Cortex device was found. Check its power and USB connection, then try again.')
        raise click.ClickException('No V5 Brain or Controller was found. Check its power and USB connection, then try again.')

    if backend == 'share':
        raise NotImplementedError('Share backend is not yet implemented')
        # ser = SerialSharePort(port)
    elif is_v5_user_joystick:
        try:
            port_in_use = controller_port_in_use(port)
        except RuntimeError as error:
            raise click.ClickException(f'{error} Finish the upload before starting live streaming.') from error
        if port_in_use:
            raise click.ClickException(
                'The V5 Controller port is already in use. Finish the program upload '
                'and close its terminal before starting live streaming.'
            )
        logger(__name__).debug("it's a v5 joystick")
        ser = V5WirelessPort(port)
    else:
        logger(__name__).debug("not a v5 joystick")
        ser = DirectPort(port)
    # MVLib disables PROS user-serial COBS/topic framing on the robot so the
    # terminal must read the raw byte stream in both decoded and --raw modes.
    # In decoded mode Terminal.reader still routes the raw bytes through the
    # MotionView decoder; --raw only changes the final display formatting.
    device = devices.RawStreamDevice(ser)
    term = Terminal(
        device,
        output_raw=kwargs.get('raw', False),
        request_banner=kwargs.pop('request_banner', True),
        allow_input=os.environ.get("MOTIONVIEW_HEADLESS") != "1",
    )

    class TerminalOutput(object):
        def __init__(self, file):
            self.terminal = sys.stdout
            self.log = open(file, 'a')
        def write(self, data):
            self.terminal.write(data)
            self.log.write(data) 
        def flush(self):
            pass
        def end(self):
            self.log.close()

    output = None
    if kwargs.get('output', None):
        output_file = kwargs['output']
        output = TerminalOutput(f'{output_file}')
        term.console.output = output
        sys.stdout = output
        logger(__name__).info(f'Redirecting Terminal Output to File: {output_file}')
    else:
        sys.stdout = sys.__stdout__

    signal.signal(signal.SIGINT, term.stop)
    def report_ready():
        sys.stdout.write("Established terminal connection\n")
        sys.__stdout__.flush()

    term.start(on_ready=report_ready)
    while not term.alive.is_set():
        time.sleep(0.005)
    sys.stdout = sys.__stdout__
    if output:
        output.end()
    term.join()
    logger(__name__).info('CLI Main Thread Dying')
