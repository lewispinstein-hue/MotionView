import logging
import sys
import warnings

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

import click

import pros.common.sentry
import pros.common.ui.log
from pros.cli.terminal import terminal_cli
from pros.common.utils import get_version, logger

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
        terminal_cli.main(prog_name="pros", args=sys.argv[1:], obj=ctx_obj, windows_expand_args=False)
    except KeyboardInterrupt:
        click.echo("Aborted!")
    except Exception as e:
        logger(__name__).exception(e)


if __name__ == "__main__":
    main()
