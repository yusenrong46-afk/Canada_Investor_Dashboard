from uplift_model import core as _core

for _name in dir(_core):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_core, _name)


def simulate_uplift(payload):  # type: ignore[no-untyped-def]
    # Look up this shim's estimate_property at call time (so tests can monkeypatch it here) and pass it
    # through, instead of rebinding uplift_model.core.estimate_property for every later caller.
    return _core.simulate_uplift(payload, estimate=globals()["estimate_property"])
