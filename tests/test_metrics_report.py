import pickle
import sys
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "artifacts" / "model-service"))

from common.conformal import ConformalCalibration  # noqa: E402

from scripts.generate_model_report import build_model_report, write_model_report  # noqa: E402


def test_metrics_report_handles_missing_artifact(tmp_path: Path):
    output_path = tmp_path / "model_metrics_report.md"
    missing_artifact = tmp_path / "missing_model.pkl"
    missing_summary = tmp_path / "missing_summary.json"

    write_model_report(output_path=output_path, artifact_path=missing_artifact, summary_path=missing_summary)

    report = output_path.read_text()
    assert "Metrics not available yet" in report
    assert "Model artifact not found" in report


def test_metrics_report_writes_markdown(tmp_path: Path):
    report = build_model_report(artifact_path=tmp_path / "missing.pkl", summary_path=tmp_path / "missing.json")

    assert report.startswith("# Model Metrics Report")
    assert "| Segment | Model | MAE | RMSE | MAPE | R2 | N |" in report


def test_metrics_report_marks_conformal_and_spatial_unavailable_without_v5_bundle(tmp_path: Path):
    # An old bundle has metrics but no conformal_calibrations and no spatial CV fields.
    legacy_bundle = SimpleNamespace(
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
    artifact = tmp_path / "legacy_bundle.pkl"
    with artifact.open("wb") as file:
        pickle.dump(legacy_bundle, file)

    report = build_model_report(artifact_path=artifact, summary_path=tmp_path / "missing.json")

    assert "## Conformal Coverage" in report
    assert "Conformal coverage is not available: the saved bundle predates v5" in report
    assert "## Spatial Generalization" in report
    assert "Spatial generalization metrics are not available: the saved bundle predates v5" in report


def test_metrics_report_renders_conformal_and_spatial_tables_from_v5_bundle(tmp_path: Path):
    bundle = SimpleNamespace(
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
    artifact = tmp_path / "v5_bundle.pkl"
    with artifact.open("wb") as file:
        pickle.dump(bundle, file)

    report = build_model_report(artifact_path=artifact, summary_path=tmp_path / "missing.json")

    assert "| Segment | Target coverage | Empirical coverage | Calibration rows | Coverage rows | Interval ratio |" in report
    assert "| Condo | 80.00% | 81.00% | 100 | 100 | 0.1800 |" in report
    assert "| Segment | Random CV MAE | Spatial CV MAE | Gap |" in report
    assert "| Condo | $100,000 | $120,000 | 20.0% |" in report


def test_metrics_report_says_coverage_not_measured_when_holdout_too_small(tmp_path: Path):
    bundle = SimpleNamespace(
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
    artifact = tmp_path / "small_bundle.pkl"
    with artifact.open("wb") as file:
        pickle.dump(bundle, file)

    report = build_model_report(artifact_path=artifact, summary_path=tmp_path / "missing.json")

    assert "not measured (too few rows)" in report
    assert "| Duplex | $200,000 | not run | not available |" in report
