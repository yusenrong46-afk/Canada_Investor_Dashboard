from pathlib import Path

from scripts.generate_model_report import build_model_report, write_model_report


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
