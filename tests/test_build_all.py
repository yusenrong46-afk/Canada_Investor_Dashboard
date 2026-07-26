from pathlib import Path

from scripts.build_all import BuildStep, run_build


def _write_python_script(path: Path, contents: str) -> None:
    path.write_text(contents.strip() + "\n", encoding="utf-8")
    path.chmod(0o755)


def _output_path_script(path: Path) -> str:
    return path.as_posix().replace("'", "\\'")


def test_build_all_permissive_skips_optional_step_without_required_outputs(tmp_path: Path) -> None:
    missing_input = tmp_path / "missing-input.csv"
    output = tmp_path / "skipped-output.json"
    step = BuildStep(
        name="optional-step",
        script=tmp_path / "noop.py",
        inputs=(missing_input,),
        outputs=(output,),
        required=False,
    )
    _write_python_script(step.script, "print('noop')")

    assert run_build([step], strict=False) == 0
    assert not output.exists()


def test_build_all_strict_fails_required_missing_input(tmp_path: Path) -> None:
    missing_input = tmp_path / "missing-input.csv"
    output = tmp_path / "required-output.json"
    step = BuildStep(
        name="required-input-step",
        script=tmp_path / "noop.py",
        inputs=(missing_input,),
        outputs=(output,),
        required=True,
    )
    _write_python_script(step.script, "print('noop')")

    assert run_build([step], strict=True) == 1
    assert not output.exists()


def test_build_all_strict_fails_missing_script(tmp_path: Path) -> None:
    output = tmp_path / "missing-output.json"
    step = BuildStep(
        name="missing-script",
        script=tmp_path / "does-not-exist.py",
        outputs=(output,),
        required=True,
    )
    assert run_build([step], strict=True) == 1


def test_build_all_strict_fails_on_script_exit(tmp_path: Path) -> None:
    failing_script = tmp_path / "fail.py"
    _write_python_script(failing_script, "import sys\nsys.exit(3)")

    step = BuildStep(
        name="failing-step",
        script=failing_script,
        required=True,
    )
    assert run_build([step], strict=True) == 1


def test_build_all_strict_fails_required_output_invalid_json(tmp_path: Path) -> None:
    output = tmp_path / "invalid-result.json"
    output_script = _output_path_script(output)
    script = tmp_path / "write-invalid.py"
    _write_python_script(
        script,
        f"from pathlib import Path\nPath(r'{output_script}').write_text('{{invalid json')",
    )
    step = BuildStep(
        name="invalid-json-step",
        script=script,
        outputs=(output,),
        required=True,
    )

    assert run_build([step], strict=True) == 1
    assert output.exists()


def test_build_all_strict_succeeds_when_required_outputs_are_valid(tmp_path: Path) -> None:
    output = tmp_path / "result.json"
    output_script = _output_path_script(output)
    script = tmp_path / "write-json.py"
    _write_python_script(
        script,
        f"from pathlib import Path\nPath(r'{output_script}').write_text('{{\"status\":\"ok\"}}')",
    )
    step = BuildStep(
        name="required-output-step",
        script=script,
        outputs=(output,),
        required=True,
    )

    assert run_build([step], strict=True) == 0
    assert output.exists()
