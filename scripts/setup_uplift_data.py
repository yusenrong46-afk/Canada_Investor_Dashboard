from __future__ import annotations

import argparse
import sys
import urllib.request
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_SERVICE_DIR = REPO_ROOT / "artifacts" / "model-service"
sys.path.insert(0, str(MODEL_SERVICE_DIR))

from uplift_service import (  # noqa: E402
    DEFAULT_BUILDINGS_PATH,
    DEFAULT_PERMITS_PATH,
    DEFAULT_SALES_PATH,
    MIN_REPEAT_SALE_ROWS,
    UPLIFT_TRAINING_MODE,
    build_repeat_sale_rows,
    load_buildings,
    load_permits,
    load_sales,
    load_uplift_bundle,
)


SEATTLE_PERMITS_URL = "https://data.seattle.gov/api/views/76t5-zqzr/rows.csv?accessType=DOWNLOAD"
KING_COUNTY_SALES_URL = "http://aqua.kingcounty.gov/extranet/assessor/Real%20Property%20Sales.zip"
KING_COUNTY_BUILDINGS_URL = "http://aqua.kingcounty.gov/extranet/assessor/Residential%20Building.zip"
KING_COUNTY_DOWNLOAD_PAGE = "https://info.kingcounty.gov/assessor/datadownload/default.aspx"
KING_COUNTY_RPSALE_METADATA = "https://www5.kingcounty.gov/sdc/?Layer=rpsale_extr"
KING_COUNTY_RESBLDG_METADATA = "https://www5.kingcounty.gov/sdc/?Layer=resbldg_extr"


def _path(value: str) -> Path:
    return Path(value).expanduser().resolve()


def _download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}")
    print(f"Saving to {destination}")
    urllib.request.urlretrieve(url, destination)


def _extract_csv(zip_path: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        csv_names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if not csv_names:
            raise RuntimeError(f"No CSV file was found inside {zip_path}")

        csv_name = csv_names[0]
        print(f"Extracting {csv_name} to {destination}")
        with archive.open(csv_name) as source, destination.open("wb") as target:
            target.write(source.read())


def download_king_county() -> None:
    download_dir = _path(str(REPO_ROOT / "data/raw/seattle/_downloads"))
    sales_zip = download_dir / "real_property_sales.zip"
    buildings_zip = download_dir / "residential_building.zip"

    _download_file(KING_COUNTY_SALES_URL, sales_zip)
    _extract_csv(sales_zip, _path(DEFAULT_SALES_PATH))

    _download_file(KING_COUNTY_BUILDINGS_URL, buildings_zip)
    _extract_csv(buildings_zip, _path(DEFAULT_BUILDINGS_PATH))


def _print_manual_steps() -> None:
    print("\nKing County manual download needed:")
    print(f"1. Open {KING_COUNTY_DOWNLOAD_PAGE}")
    print("2. Accept the King County assessor data-use disclaimer.")
    print("3. Download the Assessment Mainframe File Extracts, or run this script with --download-king-county.")
    print(f"4. Save the real sales table as {_path(DEFAULT_SALES_PATH)}")
    print(f"5. Save the real residential building table as {_path(DEFAULT_BUILDINGS_PATH)}")
    print(f"Sales metadata: {KING_COUNTY_RPSALE_METADATA}")
    print(f"Building metadata: {KING_COUNTY_RESBLDG_METADATA}")


def _check_files() -> bool:
    paths = {
        "Seattle permits": _path(DEFAULT_PERMITS_PATH),
        "King County sales": _path(DEFAULT_SALES_PATH),
        "King County residential buildings": _path(DEFAULT_BUILDINGS_PATH),
    }
    ready = True
    print("\nRaw data files:")
    for label, path in paths.items():
        exists = path.exists() and path.is_file()
        ready = ready and exists
        status = "found" if exists else "missing"
        print(f"- {label}: {status} ({path})")
    return ready


def validate_data() -> bool:
    if not _check_files():
        _print_manual_steps()
        return False

    permits = load_permits(DEFAULT_PERMITS_PATH)
    sales = load_sales(DEFAULT_SALES_PATH)
    buildings = load_buildings(DEFAULT_BUILDINGS_PATH)
    repeat_sale_rows = build_repeat_sale_rows(permits, sales, buildings)

    print("\nUplift data counts:")
    print(f"- Permit rows after real-renovation filters: {len(permits):,}")
    print(f"- King County sale rows after quality filters: {len(sales):,}")
    print(f"- King County residential building rows: {len(buildings):,}")
    print(f"- Observed repeat-sale uplift rows: {len(repeat_sale_rows):,}")

    if len(repeat_sale_rows) < MIN_REPEAT_SALE_ROWS:
        print(f"\nNeed at least {MIN_REPEAT_SALE_ROWS} observed repeat-sale rows before training.")
        return False

    print("\nData is ready for training.")
    return True


def train_uplift_model() -> bool:
    bundle = load_uplift_bundle(force_retrain=True)
    print(f"\nTraining mode: {UPLIFT_TRAINING_MODE}")
    print(f"Status: {'ready' if bundle.ready else 'data-missing'}")
    print(bundle.message)
    print(f"Row counts: {bundle.row_counts}")
    return bundle.ready


def main() -> int:
    parser = argparse.ArgumentParser(description="Set up and validate local real-data-only Seattle uplift CSVs.")
    parser.add_argument("--download-seattle", action="store_true", help="Download the public Seattle building permits CSV.")
    parser.add_argument("--download-king-county", action="store_true", help="Download and extract the King County sales/building CSVs.")
    parser.add_argument("--validate", action="store_true", help="Validate all local real CSVs and print row counts.")
    parser.add_argument("--train", action="store_true", help="Retrain the observed uplift model after validation.")
    args = parser.parse_args()

    if args.download_seattle:
        _download_file(SEATTLE_PERMITS_URL, _path(DEFAULT_PERMITS_PATH))

    if args.download_king_county:
        download_king_county()

    if (args.download_seattle or args.download_king_county) and not args.validate and not args.train:
        if not _check_files():
            _print_manual_steps()
        return 0

    should_validate = args.validate or args.train or not args.download_seattle
    valid = validate_data() if should_validate else _check_files()

    if args.train:
        if not valid:
            return 1
        return 0 if train_uplift_model() else 1

    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
