"""Regenerate exports/reports and fail if they drift from what's committed."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable
MODELS_DIR = REPO_ROOT / "artifacts" / "model-service" / "models"
REQUIRED_METRICS_ARTIFACTS = (
    MODELS_DIR / "vancouver_base_price_bundle_v5.pkl",
    MODELS_DIR / "halifax_base_price_bundle_v1.pkl",
)


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _run(command: list[str]) -> None:
    print(f"+ {' '.join(command)}")
    subprocess.run(command, cwd=REPO_ROOT, check=True)


def _inputs_present(inputs: tuple[Path, ...]) -> bool:
    return all(path.exists() for path in inputs)


def _normalize_report_content(text: str, path: Path) -> str:
    if path.suffix == ".json":
        try:
            payload = json.loads(text)
            if isinstance(payload, dict):
                payload = _strip_generated_at(payload)
            return json.dumps(payload, indent=2, ensure_ascii=False).strip() + "\n"
        except Exception:
            text = re.sub(r'(?m)^\s*"generatedAt"\s*:\s*"[^"]*",?\s*\n', "", text)
            return "\n".join(line.rstrip() for line in text.splitlines()).strip() + "\n"

    lines = []
    for line in text.splitlines():
        if path.suffix == ".md" and line.startswith("Generated:"):
            continue
        # Optional private raw data; present locally, absent in public CI.
        if path.name == "analytics_warehouse_report.md" and "staged HRM permit rows" in line:
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip() + "\n"


def _strip_generated_at(payload: dict | list) -> dict | list:
    if isinstance(payload, list):
        return [_strip_generated_at(item) for item in payload]

    if isinstance(payload, dict):
        return {
            key: _strip_generated_at(value)
            for key, value in payload.items()
            if key != "generatedAt"
        }

    return payload


def _head_content(path: Path) -> str | None:
    git_path = str(path.relative_to(REPO_ROOT))
    result = subprocess.run(
        ["git", "show", f"HEAD:{git_path}"],
        cwd=REPO_ROOT,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def _git_diff(paths: list[Path]) -> None:
    changed = []
    for path in paths:
        current = path.read_text(encoding="utf-8")
        head = _head_content(path)
        if head is None:
            changed.append(str(path))
            continue

        if _normalize_report_content(current, path) != _normalize_report_content(head, path):
            changed.append(str(path))

    if changed:
        raise RuntimeError(f"generated output drift detected for: {', '.join(changed)}")


def main() -> None:
    # Drift-check outputs rebuildable from committed public inputs.
    # Skip bit-matching for platform-noisy or private-artifact-dependent files;
    # regenerate steps below still prove those scripts run when inputs exist.
    generated_files = [
        REPO_ROOT / "reports" / "analytics_warehouse_report.md",
        REPO_ROOT / "reports" / "data_quality_report.md",
        REPO_ROOT / "data" / "exports" / "market_evidence.json",
        REPO_ROOT / "data" / "exports" / "market_map.json",
    ]
    metrics_report = REPO_ROOT / "reports" / "model_metrics_report.md"
    has_metrics_artifacts = _inputs_present(REQUIRED_METRICS_ARTIFACTS)
    if has_metrics_artifacts:
        generated_files.append(metrics_report)

    optional_generated_files = [
        REPO_ROOT / "data" / "exports" / "market_trend.json",
        REPO_ROOT / "data" / "exports" / "halifax_uplift.json",
    ]

    commands: list[tuple[list[str], tuple[Path, ...], str]] = [
        (
            [PYTHON, "scripts/build_property_warehouse.py"],
            (REPO_ROOT / "data" / "processed" / "vancouver_base_model_training.csv",),
            "analytics warehouse",
        ),
        (
            [PYTHON, "scripts/generate_data_quality_report.py"],
            (REPO_ROOT / "data" / "processed" / "vancouver_base_model_training.csv",),
            "data quality report",
        ),
        (
            [PYTHON, "scripts/generate_model_report.py"],
            REQUIRED_METRICS_ARTIFACTS,
            "model metrics report",
        ),
        (
            [PYTHON, "scripts/build_market_trend.py"],
            (REPO_ROOT / "data" / "raw" / "market" / "18100205.csv",),
            "market trend (NHPI)",
        ),
        (
            [PYTHON, "scripts/export_market_evidence.py"],
            (REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb",),
            "market evidence export",
        ),
        (
            [PYTHON, "scripts/export_market_map.py"],
            (REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb",),
            "market map export",
        ),
        (
            [PYTHON, "scripts/build_halifax_uplift.py"],
            (
                REPO_ROOT / "data" / "raw" / "halifax" / "hrm_building_permits_geolocated.csv",
                REPO_ROOT / "data" / "processed" / "halifax_base_model_training.csv",
            ),
            "halifax renovation uplift",
        ),
        (
            [PYTHON, "scripts/run_model_experiments.py"],
            (REPO_ROOT / "data" / "warehouse" / "property_analytics.duckdb",),
            "model experiment lab",
        ),
    ]

    for command, inputs, label in commands:
        if not _inputs_present(inputs):
            missing = ", ".join(_display_path(path) for path in inputs if not path.exists())
            print(f"~ skip {label}: missing inputs: {missing}")
            continue
        _run(command)

    drift_targets = list(generated_files)
    for path in optional_generated_files:
        if path.exists():
            drift_targets.append(path)

    _git_diff(drift_targets)


if __name__ == "__main__":
    main()
