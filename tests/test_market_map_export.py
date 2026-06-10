import json
from pathlib import Path

import pandas as pd
import pytest

from scripts.build_property_warehouse import build_property_warehouse
from scripts.export_market_map import export_market_map
from tests.test_property_warehouse import _small_halifax_training_frame, _small_vancouver_training_frame


def test_export_market_map_writes_cells_with_boundaries(tmp_path: Path):
    pytest.importorskip("duckdb")
    pytest.importorskip("h3")

    vancouver = pd.concat([_small_vancouver_training_frame()] * 5, ignore_index=True)
    halifax = pd.concat([_small_halifax_training_frame()] * 5, ignore_index=True)
    vancouver_path = tmp_path / "vancouver.csv"
    halifax_path = tmp_path / "halifax.csv"
    vancouver.to_csv(vancouver_path, index=False)
    halifax.to_csv(halifax_path, index=False)

    warehouse_path = tmp_path / "warehouse.duckdb"
    build_property_warehouse(
        vancouver_training_path=vancouver_path,
        halifax_training_path=halifax_path,
        halifax_permits_path=tmp_path / "missing.csv",
        warehouse_path=warehouse_path,
        report_path=tmp_path / "report.md",
    )

    export_path = tmp_path / "market_map.json"
    payload = export_market_map(warehouse_path=warehouse_path, export_path=export_path)

    saved = json.loads(export_path.read_text())
    assert saved["markets"].keys() == payload["markets"].keys()
    assert set(saved["markets"]) == {"vancouver", "halifax_maritimes"}

    for market in saved["markets"].values():
        assert market["cells"], "every exported market should have at least one cell"
        assert len(market["center"]) == 2
        low, high = market["pricePerSqftDomain"]
        assert low <= high
        for cell in market["cells"]:
            assert cell["rows"] >= 5
            assert len(cell["boundary"]) == 6
            assert all(len(point) == 2 for point in cell["boundary"])
            assert cell["medianPricePerSqft"] > 0


def test_export_market_map_requires_warehouse(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="build_property_warehouse"):
        export_market_map(warehouse_path=tmp_path / "missing.duckdb", export_path=tmp_path / "map.json")
