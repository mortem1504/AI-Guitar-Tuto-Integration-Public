"""The lab reads the browser's parameters from its TypeScript source."""

import pytest

from src.audio.web_params import PARAMS_TS, load_params, read_defaults, read_overrides


def test_reads_every_default():
    defaults = read_defaults()
    assert defaults["frameSize"] == 1024
    assert defaults["method"] in ("mpm", "yin")
    assert isinstance(defaults["octaveCheck"], bool)
    assert 0 < defaults["minHz"] < defaults["maxHz"]


def test_overrides_layer_over_defaults(tmp_path):
    lab = tmp_path / "params.lab.ts"
    lab.write_text(
        'export const LAB_RUN: string | null = "run-1";\n'
        "export const LAB_OVERRIDES: Partial<DetectorParams> = {\n"
        "  // a comment, with: a colon\n"
        "  octaveCheck: true,\n"
        "  maxHz: 1000,\n"
        "};\n"
    )
    assert read_overrides(lab) == ({"octaveCheck": True, "maxHz": 1000}, "run-1")
    params = load_params(PARAMS_TS, lab)
    assert params["octaveCheck"] is True and params["maxHz"] == 1000


def test_unknown_override_is_an_error(tmp_path):
    lab = tmp_path / "params.lab.ts"
    lab.write_text("export const LAB_RUN: string | null = null;\nexport const LAB_OVERRIDES: Partial<DetectorParams> = {\n  nope: 1,\n};\n")
    with pytest.raises(ValueError):
        load_params(PARAMS_TS, lab)
