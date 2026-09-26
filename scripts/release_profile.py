"""Explicit publication profiles.

Requirements come from the profile, not from whichever files a build happened
to leave behind. No profile in this milestone claims that the whole product's
market data or models are validated.
"""

from __future__ import annotations

from dataclasses import dataclass


LINEAGE_RAW = "raw_source_backed"
LINEAGE_LEGACY = "legacy_processed_snapshot"
LINEAGE_FIXTURE = "offline_fixture"

# Files the API and model service read from the selected release.
CONSUMER_EXPORTS = (
    "exports/market_evidence.json",
    "exports/market_map.json",
    "exports/market_trend.json",
    "exports/halifax_uplift.json",
    "exports/model_experiments.json",
)


@dataclass(frozen=True)
class ArtifactRequirement:
    relative_path: str
    produced_by_step: str


@dataclass(frozen=True)
class ReleaseProfile:
    profile_id: str
    lineage_class: str
    role: str
    validation_scope: str
    markets: dict[str, str]
    required_artifacts: tuple[ArtifactRequirement, ...]
    required_checks: tuple[str, ...]
    model_limitations: tuple[str, ...] = ()
    product_data_validated: bool = False

    def __post_init__(self) -> None:
        if self.product_data_validated:
            raise ValueError(f"Profile {self.profile_id} cannot claim product-wide data validation")
        if self.role != "retained_legacy":
            if not self.required_artifacts:
                raise ValueError(f"Profile {self.profile_id} needs required artifacts")
            if not self.required_checks:
                raise ValueError(f"Profile {self.profile_id} needs required checks")


OFFLINE_FIXTURE = ReleaseProfile(
    profile_id="offline_fixture",
    lineage_class=LINEAGE_FIXTURE,
    role="fixture",
    validation_scope="offline_fixture",
    markets={
        "halifax_maritimes": "unavailable",
        "vancouver": "unavailable",
    },
    required_artifacts=(
        ArtifactRequirement("exports/market_evidence.json", "market evidence export"),
        ArtifactRequirement("contracts.json", "contracts"),
    ),
    required_checks=("fixture.rows",),
    model_limitations=(
        "Fixture checks exercise the publication boundary. They do not validate production data or models.",
    ),
)

RETAINED_LEGACY = ReleaseProfile(
    profile_id="retained_legacy",
    lineage_class=LINEAGE_LEGACY,
    role="retained_legacy",
    validation_scope="retained_legacy",
    markets={
        "halifax_maritimes": "legacy_unvalidated",
        "vancouver": "legacy_unvalidated",
    },
    required_artifacts=(),
    required_checks=(),
    model_limitations=(
        "Processed extracts without recoverable raw lineage stay unvalidated.",
    ),
)

HRM_RAW_EVIDENCE = ReleaseProfile(
    profile_id="hrm_raw_evidence",
    lineage_class=LINEAGE_RAW,
    role="scoped_hrm_data",
    validation_scope="hrm_raw_evidence",
    markets={
        "halifax_maritimes": "data_checks_only",
        "vancouver": "unavailable",
    },
    required_artifacts=(
        ArtifactRequirement("warehouse/property_analytics.duckdb", "analytics warehouse"),
        ArtifactRequirement("reports/analytics_warehouse_report.md", "analytics warehouse"),
        ArtifactRequirement("exports/market_evidence.json", "market evidence export"),
        ArtifactRequirement("contracts.json", "contracts"),
    ),
    required_checks=(
        "halifax_maritimes.observation_id_present",
        "halifax_maritimes.observation_id_unique",
        "halifax_maritimes.sale_to_dwelling_join",
        "halifax_maritimes.sale_identity",
    ),
    model_limitations=(
        "HRM data checks do not resolve Halifax model leakage or the training/serving feature mismatch. "
        "Fitted models were not retrained or promoted.",
    ),
)

PROFILES = {
    profile.profile_id: profile
    for profile in (OFFLINE_FIXTURE, RETAINED_LEGACY, HRM_RAW_EVIDENCE)
}


def get_profile(profile_id: str) -> ReleaseProfile:
    try:
        return PROFILES[profile_id]
    except KeyError as error:
        raise KeyError(f"Unknown release profile: {profile_id}") from error
