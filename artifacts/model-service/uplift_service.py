from uplift_model import core as _core

for _name in dir(_core):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_core, _name)


def simulate_uplift(payload):  # type: ignore[no-untyped-def]
    _core.estimate_property = globals().get("estimate_property", _core.estimate_property)
    return _core.simulate_uplift(payload)
