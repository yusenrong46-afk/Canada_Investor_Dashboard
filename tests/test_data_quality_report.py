from pathlib import Path

import pandas as pd

from scripts.generate_data_quality_report import build_data_quality_report, write_data_quality_report


def test_data_quality_report_handles_missing_optional_columns(tmp_path: Path):
    data_path = tmp_path / "small_training.csv"
    pd.DataFrame(
        [
            {"price": 700000, "propertyType": "Condo", "postalCode": "V6B1X9"},
            {"price": 720000, "propertyType": "Condo", "postalCode": "V6B1X9"},
        ]
    ).to_csv(data_path, index=False)

    report = build_data_quality_report(data_path=data_path)

    assert "livingAreaSqft | column not found" in report
    assert "row count | 2" in report


def test_data_quality_report_writes_markdown(tmp_path: Path):
    data_path = tmp_path / "small_training.csv"
    output_path = tmp_path / "data_quality_report.md"
    pd.DataFrame(
        [
            {"price": 700000, "propertyType": "Condo", "postalCode": "V6B1X9", "livingAreaSqft": 700, "bedrooms": 1, "bathrooms": 1}
        ]
    ).to_csv(data_path, index=False)

    write_data_quality_report(output_path=output_path, data_path=data_path)

    report = output_path.read_text()
    assert report.startswith("# Data Quality Report")
    assert "duplicate rows" in report
