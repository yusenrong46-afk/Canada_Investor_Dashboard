import json
from pathlib import Path

import pandas as pd
import pytest

from scripts.build_property_warehouse import build_property_warehouse
from scripts.export_market_evidence import export_market_evidence
from tests.test_property_warehouse import _small_halifax_training_frame, _small_vancouver_training_frame


def _build_warehouse(tmp_path: Path) -> Path:
    vancouver_path = tmp_path / "vancouver_training.csv"
    halifax_path = tmp_path / "halifax_training.csv"
    warehouse_path = tmp_path / "property_analytics.duckdb"

    # Five copies per market clear the MIN_SEGMENT_ROWS=5 honesty threshold.
    vancouver = pd.concat([_small_vancouver_training_frame()] * 5, ignore_index=True)
    halifax = pd.concat([_small_halifax_training_frame()] * 5, ignore_index=True)
    vancouver.to_csv(vancouver_path, index=False)
    halifax.to_csv(halifax_path, index=False)

    build_property_warehouse(
        vancouver_training_path=vancouver_path,
        halifax_training_path=halifax_path,
        halifax_permits_path=tmp_path / "missing_permits.csv",
        warehouse_path=warehouse_path,
        report_path=tmp_path / "report.md",
    )
    return warehouse_path


def test_export_market_evidence_matches_contract(tmp_path: Path):
    pytest.importorskip("duckdb")

    warehouse_path = _build_warehouse(tmp_path)
    export_path = tmp_path / "market_evidence.json"

    payload = export_market_evidence(warehouse_path=warehouse_path, export_path=export_path)

    saved = json.loads(export_path.read_text())
    assert saved == payload

    assert {market["marketId"] for market in saved["markets"]} == {"vancouver", "halifax_maritimes"}
    assert saved["provenance"]["builtFrom"].startswith("fact_market_feature_summary")
    assert any(dataset["id"] == "processed_halifax_training" for dataset in saved["provenance"]["sourceDatasets"])

    assert len(saved["rows"]) == 4  # 2 markets x 2 (fsa, property type) segments
    for row in saved["rows"]:
        assert row["trainingRows"] >= 5
        assert isinstance(row["trainingRows"], int)
        assert row["postalFsa"]
        assert row["medianValue"] is None or row["medianValue"] > 0

    halifax_rows = [row for row in saved["rows"] if row["marketId"] == "halifax_maritimes"]
    assert {row["postalFsa"] for row in halifax_rows} == {"B3H", "B3J"}


def test_export_market_evidence_requires_warehouse(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="build_property_warehouse"):
        export_market_evidence(
            warehouse_path=tmp_path / "missing.duckdb",
            export_path=tmp_path / "market_evidence.json",
        )
