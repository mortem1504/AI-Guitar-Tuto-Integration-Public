"""
The browser's detector parameters, read straight from the web app's source.

The lab never keeps its own copy of the numbers it is measuring: it reads
`web/src/audio/params.ts` (the hand-written DEFAULTS) and
`web/src/audio/params.lab.ts` (the overrides this lab last exported), and
merges them exactly as the browser does. A change to either file changes
what `evaluate.py` measures, with nothing to keep in sync.
"""

import re
from pathlib import Path

LAB_ROOT = Path(__file__).resolve().parents[2]
WEB_AUDIO = LAB_ROOT.parent / "web" / "src" / "audio"
PARAMS_TS = WEB_AUDIO / "params.ts"
PARAMS_LAB_TS = WEB_AUDIO / "params.lab.ts"

_ENTRY = re.compile(r"^\s*(\w+)\s*:\s*(.+?)\s*,\s*$")


def _block(source, opening):
    """The text between `opening ... {` and its closing `};`."""
    start = source.index(opening)
    start = source.index("{", start) + 1
    end = source.index("};", start)
    return source[start:end]


def _value(text):
    text = text.strip()
    if text in ("true", "false"):
        return text == "true"
    if text.startswith('"') and text.endswith('"'):
        return text[1:-1]
    try:
        number = float(text)
    except ValueError as error:
        raise ValueError(f"Cannot read parameter value: {text!r}") from error
    return int(number) if number.is_integer() and "." not in text else number


def _entries(block):
    values = {}
    for line in block.splitlines():
        line = line.split("//", 1)[0]
        match = _ENTRY.match(line)
        if match:
            values[match.group(1)] = _value(match.group(2))
    return values


def read_defaults(path=PARAMS_TS):
    return _entries(_block(Path(path).read_text(encoding="utf-8"), "const DEFAULTS"))


def read_overrides(path=PARAMS_LAB_TS):
    path = Path(path)
    if not path.exists():
        return {}, None
    source = path.read_text(encoding="utf-8")
    overrides = _entries(_block(source, "export const LAB_OVERRIDES"))
    run = re.search(r'export const LAB_RUN[^=]*=\s*(null|"([^"]*)")', source)
    return overrides, (run.group(2) if run and run.group(2) else None)


def load_params(params_ts=PARAMS_TS, params_lab_ts=PARAMS_LAB_TS):
    """The parameters the browser runs with: defaults, then the lab's overrides."""
    params = read_defaults(params_ts)
    overrides, _ = read_overrides(params_lab_ts)
    unknown = set(overrides) - set(params)
    if unknown:
        raise ValueError(f"params.lab.ts overrides unknown parameters: {sorted(unknown)}")
    params.update(overrides)
    return params
