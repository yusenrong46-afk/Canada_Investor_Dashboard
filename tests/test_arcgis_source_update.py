from scripts.setup_halifax_data import apply_arcgis_source_updates, parse_arcgis_editing_info


def test_missing_editing_info_stays_unknown():
    assert parse_arcgis_editing_info({"name": "Civic Addresses"}) is None
    assert parse_arcgis_editing_info({"editingInfo": {}}) is None


def test_data_last_edit_date_is_recorded_from_epoch_milliseconds():
    parsed = parse_arcgis_editing_info(
        {"editingInfo": {"dataLastEditDate": 1790329292744, "schemaLastEditDate": 1790329292744}}
    )
    assert parsed is not None
    assert parsed["sourceUpdatedAt"] == "2026-09-25T09:41:32.744000+00:00"
    assert parsed["sourceUpdateField"] == "editingInfo.dataLastEditDate"
    assert parsed["dataAndSchemaTimestampsEqual"] is True


def test_apply_updates_only_layers_with_a_returned_time():
    manifest = {
        "snapshots": [
            {"name": "hrm_civic_addresses", "sourceUpdatedAt": None, "contentSha256": "abc"},
            {"name": "hrm_permits", "sourceUpdatedAt": None, "contentSha256": "def"},
            {"name": "pvsc_sales", "sourceUpdatedAt": "2026-09-01T11:34:29+00:00", "contentSha256": "ghi"},
        ]
    }
    revised = apply_arcgis_source_updates(
        manifest,
        {
            "hrm_civic_addresses": {
                "sourceUpdatedAt": "2026-09-25T09:41:32.744000+00:00",
                "sourceUpdateField": "editingInfo.dataLastEditDate",
                "schemaLastEditDate": "2026-09-25T09:41:32.744000+00:00",
                "dataAndSchemaTimestampsEqual": True,
            },
            "hrm_permits": None,
        },
    )
    civic = revised["snapshots"][0]
    permits = revised["snapshots"][1]
    sales = revised["snapshots"][2]
    assert civic["sourceUpdatedAt"] == "2026-09-25T09:41:32.744000+00:00"
    assert civic["contentSha256"] == "abc"
    assert "dataLastEditDate" in civic["sourceObservationPeriod"]
    assert permits["sourceUpdatedAt"] is None
    assert "sourceUpdateField" not in permits
    assert sales["sourceUpdatedAt"] == "2026-09-01T11:34:29+00:00"
    assert manifest["snapshots"][0]["sourceUpdatedAt"] is None
