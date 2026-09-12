"""Build 2 preview-URL gate tests: catalog search, product listing, AuthZ, validation,
versioning/overlap, supplier capabilities. Run via pytest."""
import os
import uuid
import pytest
import requests

BASE = "https://a58e29e4-b933-42ad-bc57-a163f74143ee.preview.emergentagent.com"
API = f"{BASE}/api"
PLATFORM_ORG_ID = "514737d2-b7ce-4f20-9724-48752dd9000f"
OWNER_EMAIL = "nagesh.kgpl@gmail.com"
OWNER_PASSWORD = "FloraSetu-Owner-2026"


# ---------- helpers ----------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code in (200, 201), f"login failed: {r.status_code} {r.text}"
    return r.json()["accessToken"]


def _register(email, password, name):
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": password, "displayName": name}, timeout=15)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    return r.json()["accessToken"]


def _create_org(token, name, category):
    """Create org via identity API. Returns org id."""
    r = requests.post(f"{API}/orgs",
                      headers={"Authorization": f"Bearer {token}"},
                      json={"name": name, "category": category}, timeout=15)
    assert r.status_code in (200, 201), f"create org failed: {r.status_code} {r.text}"
    return r.json()["id"]


@pytest.fixture(scope="session")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="session")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "X-Org-Id": PLATFORM_ORG_ID}


# ---------- Health ----------
def test_health():
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------- GATE: Catalog search (alias) ----------
class TestCatalogSearch:
    def test_search_eustoma_returns_lisianthus_alias(self, owner_headers):
        r = requests.get(f"{API}/catalog/search", params={"q": "eustoma"}, headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        assert len(items) >= 1, f"expected >=1 result for eustoma, got {items}"
        top = items[0]
        blob = (str(top.get("name", "")) + " " + str(top.get("botanical_name", ""))).lower()
        assert "lisianth" in blob or "eustoma" in blob, f"no lisianthus/eustoma in top: {top}"
        assert top.get("matched_alias"), f"expected matched_alias: {top}"

    def test_search_statice_returns_limonium(self, owner_headers):
        r = requests.get(f"{API}/catalog/search", params={"q": "statice"}, headers=owner_headers, timeout=15)
        assert r.status_code == 200
        items = r.json().get("items", [])
        assert len(items) >= 1
        blob = str(items[0]).lower()
        assert "limonium" in blob or "statice" in blob


# ---------- GATE: Products list & detail ----------
class TestCatalogProducts:
    def test_list_products_seeded_demo(self, owner_headers):
        r = requests.get(f"{API}/catalog/products", headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body.get("items", body if isinstance(body, list) else [])
        assert len(items) >= 1
        # at least one should be DEMO
        assert any((it.get("data_classification") or it.get("dataClassification")) == "DEMO" for it in items)

    def test_product_detail_shape(self, owner_headers):
        list_r = requests.get(f"{API}/catalog/products", headers=owner_headers, timeout=15)
        items = list_r.json().get("items", list_r.json() if isinstance(list_r.json(), list) else [])
        pid = items[0]["id"]
        r = requests.get(f"{API}/catalog/products/{pid}", headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # required child collections
        for key in ("varieties", "gradeProfiles", "packDefinitions", "unitConversions", "handlingProfiles"):
            assert key in d, f"missing {key}: keys={list(d.keys())}"
        cls = d.get("data_classification") or d.get("dataClassification")
        assert cls == "DEMO"


# ---------- GATE: Authorization (buyer cannot write) ----------
class TestBuyerAuthz:
    @pytest.fixture(scope="class")
    def buyer(self):
        suffix = uuid.uuid4().hex[:8]
        email = f"buyer_{suffix}@test.florasetu.local"
        pw = "BuyerPass1234"
        tok = _register(email, pw, f"Buyer {suffix}")
        # create BUYER org
        org_id = _create_org(tok, f"TestBuyerOrg-{suffix}", "BUYER")
        return {"token": tok, "org_id": org_id, "email": email}

    def test_buyer_can_read_products(self, buyer):
        r = requests.get(f"{API}/catalog/products",
                         headers={"Authorization": f"Bearer {buyer['token']}", "X-Org-Id": buyer["org_id"]},
                         timeout=15)
        assert r.status_code == 200, r.text

    def test_buyer_cannot_write_admin_products(self, buyer):
        r = requests.post(f"{API}/catalog/admin/products",
                          headers={"Authorization": f"Bearer {buyer['token']}", "X-Org-Id": buyer["org_id"]},
                          json={"categoryCode": "FLOWER", "commodityCode": "TEST", "commonName": "X",
                                "botanicalName": "X"},
                          timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


# ---------- GATE: Validation ----------
class TestValidation:
    def test_conversion_factor_zero_400(self, owner_headers):
        # Need a real product + uoms to make the DTO validation reach factor check.
        # Send minimal payload; factor==0 should be rejected regardless
        r = requests.post(f"{API}/catalog/admin/conversions",
                          headers=owner_headers,
                          json={"productId": str(uuid.uuid4()), "fromUomId": str(uuid.uuid4()),
                                "toUomId": str(uuid.uuid4()), "factor": 0},
                          timeout=15)
        assert r.status_code == 400, f"got {r.status_code}: {r.text}"

    def test_conversion_same_uom_400(self, owner_headers):
        same = str(uuid.uuid4())
        r = requests.post(f"{API}/catalog/admin/conversions",
                          headers=owner_headers,
                          json={"productId": str(uuid.uuid4()), "fromUomId": same, "toUomId": same, "factor": 1.5},
                          timeout=15)
        assert r.status_code == 400, f"got {r.status_code}: {r.text}"

    def test_grade_profile_unknown_attribute_400(self, owner_headers):
        # get a product id
        pr = requests.get(f"{API}/catalog/products", headers=owner_headers, timeout=15).json()
        items = pr.get("items", pr if isinstance(pr, list) else [])
        pid = items[0]["id"]
        r = requests.post(f"{API}/catalog/admin/grade-profiles",
                          headers=owner_headers,
                          json={"productId": pid, "gradeCode": "TESTG",
                                "rules": [{"attributeCode": "TOTALLY_BOGUS_ATTR_XYZ", "op": "gte", "value": 10}]},
                          timeout=15)
        assert r.status_code == 400, f"got {r.status_code}: {r.text}"

    def test_handling_profile_temp_min_gt_max_400(self, owner_headers):
        pr = requests.get(f"{API}/catalog/products", headers=owner_headers, timeout=15).json()
        items = pr.get("items", pr if isinstance(pr, list) else [])
        pid = items[0]["id"]
        r = requests.post(f"{API}/catalog/admin/handling-profiles",
                          headers=owner_headers,
                          json={"productId": pid, "tempMinC": 20, "tempMaxC": 5, "humidityMinPct": 50,
                                "humidityMaxPct": 80},
                          timeout=15)
        assert r.status_code == 400, f"got {r.status_code}: {r.text}"

    def test_categories_whitelist_bogusfield_400(self, owner_headers):
        r = requests.post(f"{API}/catalog/admin/categories",
                          headers=owner_headers,
                          json={"code": "TESTCAT", "name": "T", "bogusField": "xx"},
                          timeout=15)
        assert r.status_code == 400, f"got {r.status_code}: {r.text}"


# ---------- GATE: Versioning + overlap ----------
class TestVersioning:
    def test_grade_profile_versioning_and_overlap(self, owner_headers):
        pr = requests.get(f"{API}/catalog/products", headers=owner_headers, timeout=15).json()
        items = pr.get("items", pr if isinstance(pr, list) else [])
        pid = items[0]["id"]
        grade_code = f"VTEST{uuid.uuid4().hex[:6].upper()}"
        base_payload = {
            "commodityId": pid,
            "gradeCode": grade_code,
            "rules": [{"attribute": "stem_length_cm", "op": "MIN", "min": 30}],
        }

        # v1 DRAFT
        r1 = requests.post(f"{API}/catalog/admin/grade-profiles", headers=owner_headers,
                           json={**base_payload, "effectiveFrom": "2026-01-01"}, timeout=15)
        assert r1.status_code in (200, 201), f"first create: {r1.status_code} {r1.text}"
        v1 = r1.json()
        assert (v1.get("version_no") or v1.get("versionNo")) == 1, f"v1: {v1}"

        # v2 DRAFT (same commodity+gradeCode → new version)
        r2 = requests.post(f"{API}/catalog/admin/grade-profiles", headers=owner_headers,
                           json={**base_payload, "effectiveFrom": "2026-01-01"}, timeout=15)
        assert r2.status_code in (200, 201), f"second create: {r2.status_code} {r2.text}"
        v2 = r2.json()
        assert (v2.get("version_no") or v2.get("versionNo")) == 2, f"v2: {v2}"

        # Activate v1 (create v3 with activate:true and bounded window)
        r3 = requests.post(f"{API}/catalog/admin/grade-profiles", headers=owner_headers,
                           json={**base_payload, "effectiveFrom": "2026-01-01",
                                 "effectiveTo": "2027-01-01", "activate": True},
                           timeout=15)
        assert r3.status_code in (200, 201), f"activate v3: {r3.status_code} {r3.text}"

        # Second activation with overlapping window → 409
        r4 = requests.post(f"{API}/catalog/admin/grade-profiles", headers=owner_headers,
                           json={**base_payload, "effectiveFrom": "2026-06-01",
                                 "effectiveTo": "2027-06-01", "activate": True},
                           timeout=15)
        assert r4.status_code == 409, f"overlap should be 409, got {r4.status_code}: {r4.text}"


# ---------- GATE: Supplier capabilities ----------
class TestCapabilities:
    def _get_active_variety_id(self, headers):
        pr = requests.get(f"{API}/catalog/products", headers=headers, timeout=15).json()
        items = pr.get("items", pr if isinstance(pr, list) else [])
        for it in items:
            d = requests.get(f"{API}/catalog/products/{it['id']}", headers=headers, timeout=15).json()
            for v in d.get("varieties", []):
                if (v.get("status") or "").upper() == "ACTIVE":
                    return v["id"]
        return None

    def test_grower_can_post_capability(self, owner_headers):
        variety_id = self._get_active_variety_id(owner_headers)
        assert variety_id, "no active variety found"
        suffix = uuid.uuid4().hex[:8]
        tok = _register(f"grower_{suffix}@test.florasetu.local", "GrowerPass1234", f"Grower {suffix}")
        org_id = _create_org(tok, f"TestGrowerOrg-{suffix}", "GROWER")
        r = requests.post(f"{API}/catalog/capabilities",
                          headers={"Authorization": f"Bearer {tok}", "X-Org-Id": org_id},
                          json={"varietyId": variety_id, "notes": "test capability"},
                          timeout=15)
        assert r.status_code in (200, 201), f"grower capability create: {r.status_code} {r.text}"

    def test_buyer_cannot_post_capability(self, owner_headers):
        variety_id = self._get_active_variety_id(owner_headers)
        assert variety_id
        suffix = uuid.uuid4().hex[:8]
        tok = _register(f"buyer2_{suffix}@test.florasetu.local", "BuyerPass1234", f"Buyer {suffix}")
        org_id = _create_org(tok, f"TestBuyerOrg2-{suffix}", "BUYER")
        r = requests.post(f"{API}/catalog/capabilities",
                          headers={"Authorization": f"Bearer {tok}", "X-Org-Id": org_id},
                          json={"varietyId": variety_id},
                          timeout=15)
        assert r.status_code == 403, f"buyer capability should be 403, got {r.status_code}: {r.text}"
