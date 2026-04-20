from app.services.cache_utils import generate_hash


def test_hash_stable_across_float_and_key_order():
    a = {"rsi_threshold": 30.000000001, "sma": 5}
    b = {"sma": 5, "rsi_threshold": 30.000000002}
    assert generate_hash(a) == generate_hash(b)


def test_hash_changes_on_engine_version(monkeypatch):
    import app.services.cache_utils as mod
    data = {"x": 1}
    h1 = generate_hash(data)
    monkeypatch.setattr(mod, "ENGINE_VERSION", "99.0.0")
    h2 = generate_hash(data)
    assert h1 != h2
