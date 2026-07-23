from pathlib import Path

import pandas as pd
import pytest

from scripts.build_property_warehouse import (
    WarehouseBuildSummary,
    build_property_warehouse,
    enforce_quality_gates,
    write_warehouse_report,
)


def _small_vancouver_training_frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "price": 729000,
                "logPrice": 13.4994,
                "pricePerSqft": 1029.66,
                "propertyType": "Condo",
                "postalCode": "V6B1X9",
                "postalFsa": "V6B",
                "submarketCluster": "cluster-01",
                "livingAreaSqft": 708,
                "bedrooms": 1,
                "bathrooms": 1,
                "latitude": 49.2776,
                "longitude": -123.123,
                "lat_x_lon": -6067.2,
                "lat_sq": 2428.28,
                "lon_sq": 15159.26,
                "propertyTax": 2327,
            },
            {
                "price": 1275000,
                "logPrice": 14.0585,
                "pricePerSqft": 965.91,
                "propertyType": "Townhouse",
                "postalCode": "V5T3K4",
                "postalFsa": "V5T",
                "submarketCluster": "cluster-03",
                "livingAreaSqft": 1320,
                "bedrooms": 3,
                "bathrooms": 2,
                "latitude": 49.262,
                "longitude": -123.101,
                "lat_x_lon": -6051.0,
                "lat_sq": 2426.7,
                "lon_sq": 15153.8,
                "propertyTax": 4012,
            },
        ]
    )


def _small_halifax_training_frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "price": 612000,
                "logPrice": 13.3245,
                "pricePerSqft": 340.0,
                "propertyType": "Detached",
                "postalCode": "B3H1A1",
                "postalFsa": "B3H",
                "submarketCluster": "cluster-02",
                "livingAreaSqft": 1800,
                "bedrooms": 3,
                "bathrooms": 2,
                "latitude": 44.65,
                "longitude": -63.6,
                "lat_x_lon": -2835.54,
                "lat_sq": 1993.62,
                "lon_sq": 4044.96,
                "propertyTax": None,
                "ageYears": 35,
                "h3Cell": "882b0e96d9fffff",
                "assessedValue": 540000,
                "salePrice": 600000,
                "saleDate": "2024-06-10",
                "timeAdjustmentFactor": 1.02,
            },
            {
                "price": 455000,
                "logPrice": 13.028,
                "pricePerSqft": 325.0,
                "propertyType": "Townhouse",
                "postalCode": "B3J2B2",
                "postalFsa": "B3J",
                "submarketCluster": "cluster-05",
                "livingAreaSqft": 1400,
                "bedrooms": 3,
                "bathrooms": 2,
                "latitude": 44.66,
                "longitude": -63.61,
                "lat_x_lon": -2835.79,
                "lat_sq": 1994.51,
                "lon_sq": 4046.23,
                "propertyTax": None,
                "ageYears": 20,
                "h3Cell": "882b0e96d1fffff",
                "assessedValue": 410000,
                "salePrice": 450000,
                "saleDate": "2024-06-12",
                "timeAdjustmentFactor": 1.01,
            },
        ]
    )


def test_property_warehouse_builds_vancouver_only_when_halifax_missing(tmp_path: Path):
    pytest.importorskip("duckdb")

    data_path = tmp_path / "vancouver_training.csv"
    warehouse_path = tmp_path / "property_analytics.duckdb"
    report_path = tmp_path / "analytics_warehouse_report.md"
    _small_vancouver_training_frame().to_csv(data_path, index=False)

    summary = build_property_warehouse(
        vancouver_training_path=data_path,
        halifax_training_path=tmp_path / "missing_halifax.csv",
        halifax_permits_path=tmp_path / "missing_permits.csv",
        warehouse_path=warehouse_path,
        report_path=report_path,
    )

    assert warehouse_path.exists()
    assert summary.training_mart_rows == 2
    assert summary.model_ready_rows == 2
    assert summary.market_summary_rows == 2
    assert summary.market_rows == {"vancouver": 2}
    assert "property training mart rows | 2" in report_path.read_text()


def test_property_warehouse_builds_multi_market_mart(tmp_path: Path):
    pytest.importorskip("duckdb")
    duckdb = pytest.importorskip("duckdb")

    vancouver_path = tmp_path / "vancouver_training.csv"
    halifax_path = tmp_path / "halifax_training.csv"
    warehouse_path = tmp_path / "property_analytics.duckdb"
    report_path = tmp_path / "analytics_warehouse_report.md"
    _small_vancouver_training_frame().to_csv(vancouver_path, index=False)
    _small_halifax_training_frame().to_csv(halifax_path, index=False)

    summary = build_property_warehouse(
        vancouver_training_path=vancouver_path,
        halifax_training_path=halifax_path,
        halifax_permits_path=tmp_path / "missing_permits.csv",
        warehouse_path=warehouse_path,
        report_path=report_path,
    )

    assert summary.training_mart_rows == 4
    assert summary.model_ready_rows == 4
    assert summary.market_rows == {"halifax_maritimes": 2, "vancouver": 2}

    connection = duckdb.connect(str(warehouse_path))
    try:
        targets = dict(
            connection.execute(
                "SELECT market_id, target_name FROM fact_property_training_mart GROUP BY market_id, target_name"
            ).fetchall()
        )
        assert targets == {
            "vancouver": "listing_price",
            "halifax_maritimes": "sale_price_time_adjusted",
        }
        halifax_summary_rows = connection.execute(
            "SELECT COUNT(*) FROM fact_market_feature_summary WHERE market_id = 'halifax_maritimes'"
        ).fetchone()[0]
        assert halifax_summary_rows == 2
        halifax_checks = connection.execute(
            "SELECT COUNT(*) FROM fact_data_quality_checks WHERE market_id = 'halifax_maritimes' AND status = 'pass'"
        ).fetchone()[0]
        assert halifax_checks >= 4
    finally:
        connection.close()

    report = report_path.read_text()
    assert "halifax_maritimes mart rows | 2" in report
    assert "time_adjustment_within_guardrail" in report


def test_warehouse_report_describes_database_value(tmp_path: Path):
    report_path = tmp_path / "analytics_warehouse_report.md"
    summary = WarehouseBuildSummary(
        warehouse_path=tmp_path / "property_analytics.duckdb",
        report_path=report_path,
        source_rows=2,
        training_mart_rows=2,
        model_ready_rows=2,
        market_summary_rows=2,
        data_quality_checks=[
            {
                "check_name": "source_rows_present",
                "market_id": "vancouver",
                "severity": "critical",
                "observed_value": 2.0,
                "threshold": "> 0 rows",
                "status": "pass",
                "notes": "Rows loaded.",
            }
        ],
        market_rows={"vancouver": 2},
    )

    write_warehouse_report(summary)

    report = report_path.read_text()
    assert report.startswith("# Analytics Warehouse Report")
    assert "database-backed training mart" in report
    assert "share one model-ready contract" in report


def test_enforce_quality_gates_fails_under_strict_for_warning_checks() -> None:
    checks = [
        {
            "check_name": "postal_fsa_completeness",
            "market_id": "halifax_maritimes",
            "severity": "warning",
            "observed_value": 0.80,
            "threshold": ">= 0.95",
            "status": "fail",
        }
    ]

    assert enforce_quality_gates(checks, strict=False) == []
    failures = enforce_quality_gates(checks, strict=True)
    assert len(failures) == 1
    assert "postal_fsa_completeness" in failures[0]
