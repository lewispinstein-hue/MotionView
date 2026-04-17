import logging
import warnings

# Setup analytics first because it is used by other files

import os.path

try:
    from urllib3.exceptions import NotOpenSSLWarning
    warnings.filterwarnings("ignore", category=NotOpenSSLWarning)
except Exception:
    pass

try:
    from requests.exceptions import RequestsDependencyWarning
    warnings.filterwarnings("ignore", category=RequestsDependencyWarning)
except Exception:
    pass

import pros.common.sentry

import click
import ctypes
import sys

import pros.common.ui as ui
import pros.common.ui.log
from pros.cli.click_classes import *
from pros.cli.common import default_options, root_commands
from pros.common.utils import get_version, logger
from pros.ga.analytics import analytics

if sys.platform == 'win32':
    kernel32 = ctypes.windll.kernel32
    kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)

root_sources = [
    'build',
    'conductor',
    'conductor_utils',
    'terminal',
    'upload',
    'v5_utils',
    'misc_commands',  # misc_commands must be after upload so that "pros u" is an alias for upload, not upgrade
    'interactive',
    'user_script'
]

if getattr(sys, 'frozen', False):
    exe_file = sys.executable
else:
    exe_file = __file__

def should_fast_path_terminal(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    commands = [arg for arg in argv if arg and not arg.startswith('-')]
    return len(commands) >= 1 and commands[0] == 'terminal'

def load_root_sources():
    sources = ['terminal'] if should_fast_path_terminal() else list(root_sources)
    if os.path.exists(os.path.join(os.path.dirname(exe_file), os.pardir, os.pardir, '.git')) and 'test' not in sources:
        sources.append('test')

    for root_source in sources:
        if root_source == 'terminal':
            import pros.cli.terminal
        elif root_source == 'build':
            import pros.cli.build
        elif root_source == 'conductor':
            import pros.cli.conductor
        elif root_source == 'conductor_utils':
            import pros.cli.conductor_utils
        elif root_source == 'upload':
            import pros.cli.upload
        elif root_source == 'v5_utils':
            import pros.cli.v5_utils
        elif root_source == 'misc_commands':
            import pros.cli.misc_commands
        elif root_source == 'interactive':
            import pros.cli.interactive
        elif root_source == 'user_script':
            import pros.cli.user_script
        elif root_source == 'test':
            import pros.cli.test

load_root_sources()


def main():
    try:
        ctx_obj = {}
        click_handler = pros.common.ui.log.PROSLogHandler(ctx_obj=ctx_obj)
        ctx_obj['click_handler'] = click_handler
        formatter = pros.common.ui.log.PROSLogFormatter('%(levelname)s - %(name)s:%(funcName)s - %(message)s - pros-cli version:{version}'
            .format(version = get_version()), ctx_obj)
        click_handler.setFormatter(formatter)
        logging.basicConfig(level=logging.WARNING, handlers=[click_handler])
        cli.main(prog_name='pros', obj=ctx_obj, windows_expand_args=False)
    except KeyboardInterrupt:
        click.echo('Aborted!')
    except Exception as e:
        logger(__name__).exception(e)


def version(ctx: click.Context, param, value):
    if not value:
        return
    ctx.ensure_object(dict)
    if ctx.obj.get('machine_output', False):
        ui.echo(get_version())
    else:
        ui.echo('pros, version {}'.format(get_version()))
    ctx.exit(0)


def use_analytics(ctx: click.Context, param, value):
    if value == None:
        return
    touse = not analytics.useAnalytics
    if str(value).lower().startswith("t"):
        touse = True
    elif str(value).lower().startswith("f"):
        touse = False
    else:
        ui.echo('Invalid argument provided for \'--use-analytics\'. Try \'--use-analytics=False\' or \'--use-analytics=True\'')
        ctx.exit(0)
    ctx.ensure_object(dict)
    analytics.set_use(touse)
    ui.echo(f'Analytics usage set to: {analytics.useAnalytics}')
    ctx.exit(0)
    
def use_early_access(ctx: click.Context, param, value):
    if value is None:
        return
    import pros.conductor as c
    conductor = c.Conductor()
    value = str(value).lower()
    if value.startswith("t") or value in ["1", "yes", "y"]:
        conductor.use_early_access = True
    elif value.startswith("f") or value in ["0", "no", "n"]:
        conductor.use_early_access = False
    else:
        ui.echo('Invalid argument provided for \'--use-early-access\'. Try \'--use-early-access=False\' or \'--use-early-access=True\'')
        ctx.exit(0)
    conductor.save()
    ui.echo(f'Early access set to: {conductor.use_early_access}')
    ctx.exit(0)


@click.command('pros',
               cls=PROSCommandCollection,
               sources=root_commands)
@click.pass_context
@default_options
@click.option('--version', help='Displays version and exits.', is_flag=True, expose_value=False, is_eager=True,
              callback=version)
@click.option('--use-analytics', help='Set analytics usage (True/False).', type=str, expose_value=False,
              is_eager=True, default=None, callback=use_analytics)
@click.option('--use-early-access', type=str, expose_value=False, is_eager=True, default=None,
              help='Create projects with PROS 4 kernel by default', callback=use_early_access)
def cli(ctx):
    pros.common.sentry.register()
    ctx.call_on_close(after_command)

def after_command():
    analytics.process_requests()


if __name__ == '__main__':
    main()
