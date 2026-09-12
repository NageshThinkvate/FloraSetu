"""Prebuild3 HTTP gate: OD-07/OD-08 via preview URL."""
import os, uuid, requests, psycopg2, pytest

BASE = "https://a58e29e4-b933-42ad-bc57-a163f74143ee.preview.emergentagent.com"
API = f"{BASE}/api"
DB = "postgresql://florasetu:florasetu_dev@localhost:5432/florasetu"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()["accessToken"]


@pytest.fixture(scope="module")
def owner_ctx():
    tok = _login("nagesh.kgpl@gmail.com", "FloraSetu-Owner-2026")
    conn = psycopg2.connect(DB)
    cur = conn.cursor()
    cur.execute("SELECT id FROM identity.organizations WHERE ref='ORG-2026-000000'")
    org = cur.fetchone()[0]
    cur.close(); conn.close()
    return {"headers": {"Authorization": f"Bearer {tok}", "X-Org-Id": str(org), "Content-Type": "application/json"}, "org": str(org)}


def _q(sql, params=None):
    conn = psycopg2.connect(DB); cur = conn.cursor()
    cur.execute(sql, params or ())
    rows = cur.fetchall()
    cur.close(); conn.close()
    return rows


# ---------- F1/F2: commercial-line validate ----------
def test_commercial_line_missing_uom_returns_400(owner_ctx):
    cid = _q("SELECT id FROM catalog.commodities LIMIT 1")[0][0]
    r = requests.post(f"{API}/catalog/commercial-line/validate",
                      headers=owner_ctx["headers"], json={"commodityId": str(cid)}, timeout=15)
    assert r.status_code == 400, r.text
    body = r.json()
    # error envelope
    assert body.get("code") in ("VALIDATION_FAILED", "VALIDATION_ERROR") or "VALIDATION" in str(body).upper()


def test_commercial_line_valid_uom_returns_201(owner_ctx):
    cid = _q("SELECT id FROM catalog.commodities WHERE ref='PRD-SEED-ROSE_PREMIUM' LIMIT 1")[0][0]
    uom = _q("SELECT id FROM catalog.units_of_measure WHERE status='ACTIVE' AND code='STEM' LIMIT 1")[0][0]
    r = requests.post(f"{API}/catalog/commercial-line/validate",
                      headers=owner_ctx["headers"],
                      json={"commodityId": str(cid), "uomId": str(uom)}, timeout=15)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body.get("valid") is True
    assert "preferredOrderUomId" in body or "preferred_order_uom_id" in body


# ---------- F3–F6: validation workflow (grade_profiles) ----------
@pytest.fixture(scope="module")
def demo_grade_profile(owner_ctx):
    # Pick a DEMO grade profile (validation_status='DEMO', not yet requested)
    rows = _q("""SELECT id FROM catalog.grade_profiles
                 WHERE validation_status='DEMO' AND status='ACTIVE'
                 LIMIT 1""")
    if not rows:
        pytest.skip("no DEMO grade_profile available")
    return str(rows[0][0])


def test_request_validation_transitions_to_pending(owner_ctx, demo_grade_profile):
    r = requests.post(f"{API}/catalog/admin/grade_profiles/{demo_grade_profile}/request-validation",
                      headers=owner_ctx["headers"], json={"validationReference": "TEST-REQ-1"}, timeout=15)
    assert r.status_code in (200, 201), r.text
    row = _q("SELECT validation_status FROM catalog.grade_profiles WHERE id=%s", (demo_grade_profile,))
    assert row[0][0] == "PENDING_REVIEW"


def test_self_approval_blocked_403(owner_ctx, demo_grade_profile):
    r = requests.post(f"{API}/catalog/admin/grade_profiles/{demo_grade_profile}/review-validation",
                      headers=owner_ctx["headers"],
                      json={"decision": "VALIDATED", "notes": "self"}, timeout=15)
    assert r.status_code == 403, r.text
    body = r.json()
    detail = str(body).upper()
    assert "SELF_APPROVAL" in detail or "SELF" in detail, body


def test_second_reviewer_validates(owner_ctx, demo_grade_profile):
    # Provision second user with CATALOG_VALIDATOR
    email = f"validator+{uuid.uuid4().hex[:6]}@dev.florasetu.local"
    pw = "ValidatorPass-2026"
    reg = requests.post(f"{API}/auth/register",
                        json={"email": email, "password": pw, "displayName": "Validator"}, timeout=15)
    assert reg.status_code in (200, 201), reg.text
    tok2 = reg.json().get("accessToken") or _login(email, pw)

    # Attach platform org membership + validator role via SQL
    conn = psycopg2.connect(DB); cur = conn.cursor()
    cur.execute("SELECT id FROM identity.users WHERE email=%s", (email,))
    uid = cur.fetchone()[0]
    org = owner_ctx["org"]
    cur.execute("""INSERT INTO identity.org_memberships (id, user_id, org_id, status, created_at)
                   VALUES (gen_random_uuid(), %s, %s, 'ACTIVE', now())
                   ON CONFLICT DO NOTHING""", (uid, org))
    # Grant CATALOG_VALIDATOR role
    cur.execute("SELECT id FROM identity.roles WHERE name='CATALOG_VALIDATOR' LIMIT 1")
    r_row = cur.fetchone()
    assert r_row, "CATALOG_VALIDATOR role missing"
    role_id = r_row[0]
    cur.execute("""INSERT INTO identity.user_roles (id, user_id, role_id, org_id, created_at)
                   VALUES (gen_random_uuid(), %s, %s, %s, now())
                   ON CONFLICT DO NOTHING""", (uid, role_id, org))
    conn.commit(); cur.close(); conn.close()

    headers2 = {"Authorization": f"Bearer {tok2}", "X-Org-Id": org, "Content-Type": "application/json"}
    r = requests.post(f"{API}/catalog/admin/grade_profiles/{demo_grade_profile}/review-validation",
                      headers=headers2,
                      json={"decision": "VALIDATED", "notes": "ok"}, timeout=15)
    assert r.status_code in (200, 201), r.text
    row = _q("SELECT validation_status FROM catalog.grade_profiles WHERE id=%s", (demo_grade_profile,))
    assert row[0][0] == "VALIDATED"


def test_commercial_check_usable_after_validation(owner_ctx, demo_grade_profile):
    r = requests.get(f"{API}/catalog/commercial-check/grade_profiles/{demo_grade_profile}",
                     headers=owner_ctx["headers"], timeout=15)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body.get("usable") is True, body


# ---------- F7: normalize-preview ----------
def test_normalize_preview_rose_bunch_to_stem(owner_ctx):
    cid = _q("SELECT id FROM catalog.commodities WHERE ref='PRD-SEED-ROSE_PREMIUM'")[0][0]
    bunch = _q("SELECT id FROM catalog.units_of_measure WHERE code='BUNCH' AND status='ACTIVE'")[0][0]
    stem = _q("SELECT id FROM catalog.units_of_measure WHERE code='STEM' AND status='ACTIVE'")[0][0]
    conv_before = _q("""SELECT id, factor, version_no
                        FROM catalog.unit_conversions
                        WHERE commodity_id=%s AND from_uom_id=%s AND to_uom_id=%s AND status='ACTIVE'""",
                     (cid, bunch, stem))
    assert conv_before, "seed conversion missing"
    body = {"commodityId": str(cid), "qty": 2, "uomId": str(bunch), "targetUomId": str(stem)}
    r = requests.post(f"{API}/catalog/normalize-preview", headers=owner_ctx["headers"], json=body, timeout=15)
    assert r.status_code in (200, 201), r.text
    resp = r.json()
    assert resp.get("originalQty") == 2 or resp.get("original_qty") == 2
    assert str(resp.get("originalUomId") or resp.get("original_uom_id")) == str(bunch)
    assert (resp.get("normalizedQty") or resp.get("normalized_qty")) == 40
    assert (resp.get("conversionVersionNo") or resp.get("conversion_version_no")) == 1
    # verify unchanged
    conv_after = _q("""SELECT id, factor, version_no
                       FROM catalog.unit_conversions
                       WHERE commodity_id=%s AND from_uom_id=%s AND to_uom_id=%s AND status='ACTIVE'""",
                    (cid, bunch, stem))
    assert conv_after == conv_before, "conversion row must be unchanged after preview"
