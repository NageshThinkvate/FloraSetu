"""FloraSetu BUILD-0 acceptance gate tests (HTTP)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://a58e29e4-b933-42ad-bc57-a163f74143ee.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _mint(s, org, perms):
    r = s.post(f"{API}/_baseline/dev-token", json={
        "sub": str(uuid.uuid4()), "orgId": org, "permissions": perms
    })
    assert r.status_code == 200, f"dev-token failed: {r.status_code} {r.text}"
    return r.json()["token"]


# GATE-1
def test_health_ok(s):
    r = s.get(f"{API}/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "up"
    assert r.headers.get("x-trace-id"), "missing x-trace-id header"


# GATE-2
def test_unauth_returns_401_envelope(s):
    r = s.get(f"{API}/_baseline/entries")
    assert r.status_code == 401
    body = r.json()
    assert body["error"]["code"] == "UNAUTHENTICATED"
    assert "trace_id" in body["error"]


def test_forbidden_when_missing_permission(s):
    org = str(uuid.uuid4())
    token = _mint(s, org, [])  # no permissions
    r = s.get(f"{API}/_baseline/entries", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


# GATE-3
def test_idempotency_replay_and_conflict(s):
    org = str(uuid.uuid4())
    token = _mint(s, org, ["config.read", "config.write"])
    hdrs = {"Authorization": f"Bearer {token}", "Idempotency-Key": str(uuid.uuid4())}
    body = {"key": "k1", "value": {"a": 1}}
    r1 = s.post(f"{API}/_baseline/entries", json=body, headers=hdrs)
    assert r1.status_code == 201, r1.text
    r2 = s.post(f"{API}/_baseline/entries", json=body, headers=hdrs)
    assert r2.status_code == 201
    assert r2.json() == r1.json()
    assert r2.headers.get("Idempotency-Replayed") == "true"

    # Same key, different body → 409
    r3 = s.post(f"{API}/_baseline/entries", json={"key": "k2", "value": {"a": 2}}, headers=hdrs)
    assert r3.status_code == 409
    assert r3.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    # Verify only one row via list
    lst = s.get(f"{API}/_baseline/entries", headers={"Authorization": f"Bearer {token}"}).json()
    assert len(lst["items"]) == 1


# GATE-4
def test_tenant_isolation(s):
    org_a = str(uuid.uuid4())
    org_b = str(uuid.uuid4())
    tok_a = _mint(s, org_a, ["config.read", "config.write"])
    tok_b = _mint(s, org_b, ["config.read", "config.write"])
    hdrs = {"Authorization": f"Bearer {tok_a}", "Idempotency-Key": str(uuid.uuid4())}
    r = s.post(f"{API}/_baseline/entries", json={"key": "x", "value": 1}, headers=hdrs)
    assert r.status_code == 201, r.text
    entry_id = r.json()["id"]

    # Org B cannot see it
    r_b = s.get(f"{API}/_baseline/entries/{entry_id}", headers={"Authorization": f"Bearer {tok_b}"})
    assert r_b.status_code == 404
    lst_b = s.get(f"{API}/_baseline/entries", headers={"Authorization": f"Bearer {tok_b}"}).json()
    ids = [i["id"] for i in lst_b["items"]]
    assert entry_id not in ids

    # Org A can see it
    r_a = s.get(f"{API}/_baseline/entries/{entry_id}", headers={"Authorization": f"Bearer {tok_a}"})
    assert r_a.status_code == 200
