import pickle
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "artifacts" / "model-service"))

from base_model.core import MODEL_VERSION, VancouverModelBundle  # noqa: E402
from common.artifact_loader import build_manifest_entry, upsert_manifest_entry  # noqa: E402
from common.conformal import ConformalCalibration  # noqa: E402

import scripts.generate_model_report as report_module  # noqa: E402
from scripts.generate_model_report import build_model_report, write_model_report  # noqa: E402


def _write_report_fixture(tmp_path: Path, filename: str, bundle: object) -> Path:
    artifact = tmp_path / filename
    with artifact.open("wb") as file:
        pickle.dump(bundle, file)
    upsert_manifest_entry(
        artifact,
        build_manifest_entry(
            artifact,
            model_version=MODEL_VERSION,
            trained_at="2026-01-01T00:00:00Z",
        ),
    )
    return artifact


def _v5_bundle(**overrides: object) -> VancouverModelBundle:
    bundle = object.__new__(VancouverModelBundle)
    bundle.__dict__.update(
        {
            "model_version": MODEL_VERSION,
            "evaluation_summary": {},
            "conformal_calibrations": {},
        }
    )
    bundle.__dict__.update(overrides)
    return bundle


def test_metrics_report_handles_missing_artifact(tmp_path: Path, monkeypatch):
    missing = tmp_path / "missing_model.pkl"
    monkeypatch.setattr(report_module, "VANCOUVER_ARTIFACT", missing)
    monkeypatch.setattr(report_module, "HALIFAX_ARTIFACT", missing)

    output_path = tmp_path / "model_metrics_report.md"
    write_model_report(output_path=output_path)

    report = output_path.read_text()
    assert "Model artifact not found" in report
    assert "Metrics unavailable" in report


def test_metrics_report_writes_markdown(tmp_path: Path, monkeypatch):
    missing = tmp_path / "missing.pkl"
    monkeypatch.setattr(report_module, "VANCOUVER_ARTIFACT", missing)
    monkeypatch.setattr(report_module, "HALIFAX_ARTIFACT", missing)

    report = build_model_report()

    assert report.startswith("# Model Metrics Report")
    assert "| Segment | Model | Temporal MAE | Temporal MAPE | Temporal R2 | N | Random MAE | Random MAPE |" in report


def test_metrics_report_marks_conformal_and_spatial_unavailable_without_v5_bundle(tmp_path: Path, monkeypatch):
    legacy_bundle = _v5_bundle(
        evaluation_summary={
            "perType": {
                "Condo": {
                    "selectedModel": "xgboost",
                    "holdout": {"mae": 100_000.0, "rmse": 150_000.0, "mape": 0.12, "r2": 0.8, "rows": 200},
                },
            },
            "overallWeightedMetrics": {"holdoutMae": 100_000.0, "holdoutMape": 0.12, "holdoutR2": 0.8},
            "selectedModels": {"Condo": "xgboost"},
            "validationStrategy": {},
        },
    )
    artifact = _write_report_fixture(tmp_path, "legacy_bundle.pkl", legacy_bundle)
    missing = tmp_path / "missing_halifax.pkl"
    monkeypatch.setattr(report_module, "VANCOUVER_ARTIFACT", artifact)
    monkeypatch.setattr(report_module, "HALIFAX_ARTIFACT", missing)

    report = build_model_report()

    assert "### Conformal coverage" in report
    assert "Conformal coverage not available for this artifact." in report
    assert "### Spatial generalization" in report
    assert "Spatial generalization metrics not available for this artifact." in report


def test_metrics_report_renders_conformal_and_spatial_tables_from_v5_bundle(tmp_path: Path, monkeypatch):
    bundle = _v5_bundle(
        evaluation_summary={
            "perType": {
                "Condo": {
                    "selectedModel": "xgboost",
                    "holdout": {"mae": 100_000.0, "rmse": 150_000.0, "mape": 0.12, "r2": 0.8, "rows": 200},
                    "randomCvMae": 100_000.0,
                    "spatialCvMae": 120_000.0,
                    "spatialGeneralizationGapPct": 20.0,
                },
            },
            "overallWeightedMetrics": {"holdoutMae": 100_000.0, "holdoutMape": 0.12, "holdoutR2": 0.8},
            "selectedModels": {"Condo": "xgboost"},
            "validationStrategy": {},
        },
        conformal_calibrations={
            "Condo": ConformalCalibration(
                alpha=0.2,
                target_coverage=0.8,
                ratio=0.18,
                empirical_coverage=0.81,
                calibration_rows=100,
                coverage_rows=100,
            ),
        },
    )
    artifact = _write_report_fixture(tmp_path, "v5_bundle.pkl", bundle)
    missing = tmp_path / "missing_halifax.pkl"
    monkeypatch.setattr(report_module, "VANCOUVER_ARTIFACT", artifact)
    monkeypatch.setattr(report_module, "HALIFAX_ARTIFACT", missing)

    report = build_model_report()

    assert "| Segment | Target | Empirical | Calibration N | Coverage N | Waiver |" in report
    assert "| Condo | 80.00% | 81.00% | 100 | 100 | none |" in report
    assert "| Segment | Random CV MAE | Spatial CV MAE | Gap |" in report
    assert "| Condo | $100,000 | $120,000 | 20.0% |" in report


def test_metrics_report_says_coverage_not_measured_when_holdout_too_small(tmp_path: Path, monkeypatch):
    bundle = _v5_bundle(
        evaluation_summary={
            "perType": {
                "Duplex": {
                    "selectedModel": "random-forest",
                    "holdout": {"mae": 200_000.0, "rmse": 250_000.0, "mape": 0.2, "r2": 0.5, "rows": 20},
                    "randomCvMae": 200_000.0,
                    "spatialCvMae": None,
                    "spatialGeneralizationGapPct": None,
                },
            },
            "overallWeightedMetrics": {"holdoutMae": 200_000.0, "holdoutMape": 0.2, "holdoutR2": 0.5},
            "selectedModels": {"Duplex": "random-forest"},
            "validationStrategy": {},
        },
        conformal_calibrations={
            "Duplex": ConformalCalibration(
                alpha=0.2,
                target_coverage=0.8,
                ratio=0.3,
                empirical_coverage=None,
                calibration_rows=20,
                coverage_rows=0,
            ),
        },
    )
    artifact = _write_report_fixture(tmp_path, "small_bundle.pkl", bundle)
    missing = tmp_path / "missing_halifax.pkl"
    monkeypatch.setattr(report_module, "VANCOUVER_ARTIFACT", artifact)
    monkeypatch.setattr(report_module, "HALIFAX_ARTIFACT", missing)

    report = build_model_report()

    assert "| Duplex | 80.00% | not available | 20 | 0 | none |" in report
    assert "| Duplex | $200,000 | not run | not available |" in report
