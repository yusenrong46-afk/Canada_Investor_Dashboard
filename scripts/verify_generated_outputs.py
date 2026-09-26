"""Rebuild drift-checked outputs in a candidate and compare them to the selected release.

This script does not write ``data/exports``, ``data/warehouse``, or ``reports``.
Model experiments and the metrics report are historical lab artifacts: experiments
are not recomputed here, and the metrics report is compared only when both
approved pickles are present.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.build_all import BuildStep, REPO_ROOT, SCRIPTS_DIR, run_build
from scripts.release_store import LINEAGE_LEGACY, open_candidate, read_pointer


PYTHON = sys.executable
MODELS_DIR = REPO_ROOT / "artifacts" / "model-service" / "models"
REQUIRED_METRICS_ARTIFACTS = (
    MODELS_DIR / "vancouver_base_price_bundle_v5.pkl",
    MODELS_DIR / "halifax_base_price_bundle_v1.pkl",
)
PROCESSED_DIR = REPO_ROOT / "data" / "processed"


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _inputs_present(inputs: tuple[Path, ...]) -> bool:
    return all(path.exists() for path in inputs)


def _normalize_report_content(text: str, path: Path) -> str:
    if path.suffix == ".json":
        try:
            payload = json.loads(text)
            if isinstance(payload, dict):
                payload = _strip_volatile(payload)
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


def _strip_volatile(payload: dict | list) -> dict | list:
    """Drop timestamps that a rebuild is allowed to change. Checksums stay."""
    if isinstance(payload, list):
        return [_strip_volatile(item) for item in payload]
    if isinstance(payload, dict):
        return {
            key: _strip_volatile(value)
            for key, value in payload.items()
            if key not in {"generatedAt"}
        }
    return payload


def _compare(candidate_path: Path, published_path: Path) -> str | None:
    if not published_path.is_file():
        return f"selected release is missing {_display_path(published_path)}"
    if not candidate_path.is_file():
        return f"candidate did not produce {_display_path(candidate_path)}"
    current = _normalize_report_content(candidate_path.read_text(encoding="utf-8"), candidate_path)
    published = _normalize_report_content(published_path.read_text(encoding="utf-8"), published_path)
    if current != published:
        return f"{candidate_path.name} drifted from the selected release"
    return None


def main() -> None:
    pointer = read_pointer()
    if pointer is None:
        raise SystemExit(
            "data/releases/current.json is missing. Refusing to compare a candidate against mixed legacy files."
        )
    release_dir = REPO_ROOT / "data" / "releases" / pointer["relativePath"]
    if not release_dir.is_dir():
        raise SystemExit(f"Selected release directory does not exist: {release_dir}")

    candidate = open_candidate(
        lineage_class=LINEAGE_LEGACY,
        raw_lineage_recovered=False,
        reference_date=os.environ.get("CVH_REFERENCE_DATE"),
        notes="Verification candidate. Not published. Compared with the selected release after normalization.",
    )
    exports = candidate.root / "exports"
    reports = candidate.root / "reports"
    warehouse = candidate.root / "warehouse" / "property_analytics.duckdb"
    steps = [
        BuildStep(
            name="analytics warehouse",
            script=SCRIPTS_DIR / "build_property_warehouse.py",
            inputs=(PROCESSED_DIR / "vancouver_base_model_training.csv",),
            outputs=(warehouse, reports / "analytics_warehouse_report.md"),
            required=True,
        ),
        BuildStep(
            name="data quality report",
            script=SCRIPTS_DIR / "generate_data_quality_report.py",
            inputs=(PROCESSED_DIR / "vancouver_base_model_training.csv",),
            outputs=(reports / "data_quality_report.md",),
            required=True,
        ),
        BuildStep(
            name="market evidence export",
            script=SCRIPTS_DIR / "export_market_evidence.py",
            inputs=(warehouse,),
            outputs=(exports / "market_evidence.json",),
            required=True,
            depends_on=("analytics warehouse",),
        ),
        BuildStep(
            name="market map export",
            script=SCRIPTS_DIR / "export_market_map.py",
            inputs=(warehouse,),
            outputs=(exports / "market_map.json",),
            required=True,
            depends_on=("analytics warehouse",),
        ),
    ]
    if _inputs_present(REQUIRED_METRICS_ARTIFACTS):
        steps.append(
            BuildStep(
                name="model metrics report",
                script=SCRIPTS_DIR / "generate_model_report.py",
                inputs=REQUIRED_METRICS_ARTIFACTS,
                outputs=(reports / "model_metrics_report.md",),
                required=True,
            )
        )

    print(f"Verification candidate: {candidate.root}")
    if run_build(steps, strict=True, candidate=candidate) != 0:
        raise SystemExit("verification candidate build failed")

    pairs = [
        (reports / "analytics_warehouse_report.md", release_dir / "reports" / "analytics_warehouse_report.md"),
        (reports / "data_quality_report.md", release_dir / "reports" / "data_quality_report.md"),
        (exports / "market_evidence.json", release_dir / "exports" / "market_evidence.json"),
        (exports / "market_map.json", release_dir / "exports" / "market_map.json"),
    ]
    if _inputs_present(REQUIRED_METRICS_ARTIFACTS):
        pairs.append(
            (reports / "model_metrics_report.md", release_dir / "reports" / "model_metrics_report.md")
        )

    failures = [message for message in (_compare(left, right) for left, right in pairs) if message]
    if failures:
        raise SystemExit("generated output drift detected: " + "; ".join(failures))
    print(f"Candidate outputs match selected release {pointer['releaseId']}.")


if __name__ == "__main__":
    main()
