import json
import hashlib

ENGINE_VERSION = "1.0.0"


def normalize_for_hash(value):
    if isinstance(value, dict):
        return {k: normalize_for_hash(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [normalize_for_hash(v) for v in value]
    if isinstance(value, float):
        return round(value, 8)
    return value


def generate_hash(payload):
    normalized = normalize_for_hash({
        "engine_version": ENGINE_VERSION,
        "payload": payload,
    })
    raw = json.dumps(normalized, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()
