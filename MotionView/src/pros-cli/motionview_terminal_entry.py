import logging
import sys
import warnings

# Importing urllib3 to obtain its warning class can emit the warning first.
# These filters must be installed before any PROS dependency imports it.
warnings.filterwarnings("ignore", message=r"urllib3 v2 only supports OpenSSL")
warnings.filterwarnings("ignore", message=r"Unable to find acceptable character detection dependency")

import click

import pros.common.sentry
import pros.common.ui.log
from pros.cli.terminal import terminal_cli
from pros.common.utils import get_version, logger
from pros.serial import resume_timestamp_from_environment
from pros.serial.terminal.errors import friendly_terminal_error


def resume_decoder_from_environment():
    try:
        resume_timestamp_from_environment()
    except (ValueError, TypeError, KeyError):
        logger(__name__).warning("Ignoring invalid timestamp resume anchor")

def configure_logging():
    ctx_obj = {}
    click_handler = pros.common.ui.log.PROSLogHandler(ctx_obj=ctx_obj)
    ctx_obj["click_handler"] = click_handler
    formatter = pros.common.ui.log.PROSLogFormatter(
        "%(levelname)s - %(name)s:%(funcName)s - %(message)s - pros-cli version:{version}".format(
            version=get_version()
        ),
        ctx_obj,
    )
    click_handler.setFormatter(formatter)
    logging.basicConfig(level=logging.WARNING, handlers=[click_handler])
    return ctx_obj

def main():
    try:
        ctx_obj = configure_logging()
        resume_decoder_from_environment()
        # Use Click's plain error path; RichClick prints multi-line boxes to the
        # telemetry console even when its command exits before connecting.
        click.Command.main(
            terminal_cli,
            prog_name="pros", args=sys.argv[1:], obj=ctx_obj,
            windows_expand_args=False, standalone_mode=False,
        )
    except KeyboardInterrupt:
        click.echo("Aborted!")
    except click.ClickException as error:
        click.echo(error.format_message(), err=True)
        raise SystemExit(error.exit_code) from None
    except Exception as e:
        click.echo(friendly_terminal_error(e), err=True)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
