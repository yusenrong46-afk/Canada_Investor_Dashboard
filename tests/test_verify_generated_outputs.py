from pathlib import Path

from scripts.verify_generated_outputs import find_absolute_paths


def test_committed_generated_outputs_have_no_absolute_home_paths() -> None:
    assert find_absolute_paths() == []


def test_absolute_path_scan_flags_home_and_drive_paths(tmp_path: Path) -> None:
    exports = tmp_path / "data" / "exports"
    reports = tmp_path / "reports" / "nested"
    exports.mkdir(parents=True)
    reports.mkdir(parents=True)
    (exports / "clean.json").write_text('{"sourcePath": "data/raw/halifax/sales.csv"}', encoding="utf-8")
    (exports / "mac.json").write_text('{"sourcePath": "/Users/dev/data.csv"}', encoding="utf-8")
    (reports / "linux.md").write_text("Source: `/home/dev/repo/data.csv`\n", encoding="utf-8")
    (reports / "windows.json").write_text('{"path": "C:\\\\Users\\\\dev\\\\data.csv"}', encoding="utf-8")

    offenders = find_absolute_paths(tmp_path)

    assert len(offenders) == 3
    assert not any("clean.json" in offender for offender in offenders)
