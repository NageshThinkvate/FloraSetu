"""Build 1 HTTP gate verification against preview URL."""
import os, time, uuid, pyotp, subprocess, json, pytest, requests

BASE = os.environ.get("BASE_URL", "http://localhost:8001")

def _rand(): return uuid.uuid4().hex[:10]

def _register(email=None, password="Passw0rd-Strong-1"):
    email = email or f"test_{_rand()}@ex.com"
    r = requests.post(f"{BASE}/api/auth/register", json={"email":email,"password":password,"displayName":"T"})
    assert r.status_code in (200,201), r.text
    d = r.json().get("data", r.json())
    return email, password, d["accessToken"], d.get("refreshToken"), d.get("userId") or d["user"]["id"]

def _login(email, password, mfa=None):
    body = {"email":email,"password":password}
    if mfa: body["mfaCode"]=mfa
    return requests.post(f"{BASE}/api/auth/login", json=body)

def _sql(q):
    """Run SQL as postgres. Returns stdout."""
    return subprocess.run(
        ["psql","postgresql://florasetu:florasetu_dev@localhost:5432/florasetu","-tAc",q],
        capture_output=True, text=True, check=True).stdout.strip()

# =========== BUG-VERIFY-1: MFA ==========
def test_bug1_mfa_enroll_and_login():
    email, pw, tok, _, _ = _register()
    r = requests.post(f"{BASE}/api/auth/mfa/enroll", headers={"Authorization":f"Bearer {tok}"})
    assert r.status_code in (200,201), r.text
    secret = r.json().get("data",r.json())["secret"]
    code = pyotp.TOTP(secret).now()
    r2 = requests.post(f"{BASE}/api/auth/mfa/verify", headers={"Authorization":f"Bearer {tok}"}, json={"code":code})
    assert r2.status_code in (200,201), r2.text
    # login now requires TOTP
    r3 = _login(email, pw)
    assert r3.status_code in (400,401,403), f"expected MFA_REQUIRED, got {r3.status_code} {r3.text}"
    body = r3.json()
    assert "MFA" in json.dumps(body).upper()
    # with code succeeds
    time.sleep(1)
    code2 = pyotp.TOTP(secret).now()
    r4 = _login(email, pw, mfa=code2)
    assert r4.status_code in (200,201), r4.text

# =========== BUG-VERIFY-2: lockout ==========
def test_bug2_lockout_5_fails_then_429():
    email, pw, _, _, _ = _register()
    codes=[]
    for i in range(5):
        codes.append(_login(email,"wrongPass-Zzz9").status_code)
    # 6th attempt
    sixth = _login(email,"wrongPass-Zzz9")
    assert sixth.status_code == 429, f"expected 429 on 6th, got {sixth.status_code}; prior={codes}"
    # even correct password locked
    r = _login(email, pw)
    assert r.status_code == 429, f"expected 429 with correct pw during lockout, got {r.status_code}"

# =========== GATE: full HTTP dual approval flow ==========
def test_gate_full_flow_buyer_forbidden_and_dual_approval():
    # Owner (supplier admin)
    o_email, o_pw, o_tok, _, o_uid = _register()

    # Buyer org
    r = requests.post(f"{BASE}/api/orgs", headers={"Authorization":f"Bearer {o_tok}"},
                      json={"name":f"BuyerCo {_rand()}","category":"BUYER"})
    assert r.status_code in (200,201), r.text
    buyer_org = r.json()["id"]

    # Buyer forbidden from bank/accounts (buyer category cannot have payout)
    r = requests.post(f"{BASE}/api/orgs/{buyer_org}/bank/accounts",
                      headers={"Authorization":f"Bearer {o_tok}","X-Org-Id":buyer_org},
                      json={"accountRef":"A1","ifsc":"HDFC0000001","accountNumber":"1234567890","holderName":"Buyer"})
    assert r.status_code == 403, f"buyer should be 403 for bank.write, got {r.status_code} {r.text}"

    # Grower org
    r = requests.post(f"{BASE}/api/orgs", headers={"Authorization":f"Bearer {o_tok}"},
                      json={"name":f"GrowCo {_rand()}","category":"GROWER"})
    assert r.status_code in (200,201), r.text
    grow_org = r.json()["id"]

    # Submit bank account
    r = requests.post(f"{BASE}/api/orgs/{grow_org}/bank/accounts",
                      headers={"Authorization":f"Bearer {o_tok}","X-Org-Id":grow_org},
                      json={"accountRef":"A1","ifsc":"HDFC0000001","accountNumber":"1234567890","holderName":"Grow"})
    assert r.status_code in (200,201), r.text
    body = r.json()
    bank_id = body["changeRequestId"]
    assert body["status"] == "PENDING_REVERIFICATION", body

    # Provision two finance approvers as platform finance users via SQL
    f1_email, f1_pw, f1_tok, _, f1_uid = _register()
    f2_email, f2_pw, f2_tok, _, f2_uid = _register()
    plat_org_id = _sql("select id from identity.organizations where ref='ORG-2026-000000'")
    finance_role = _sql("select id from identity.roles where name='PLATFORM_FINANCE_APPROVER' and org_id is null")
    if not finance_role:
        finance_role = _sql("select id from identity.roles where name ilike '%FINANCE%' and org_id is null limit 1")
    for uid in (f1_uid, f2_uid):
        _sql(f"insert into identity.org_memberships(org_id,user_id,status) values ('{plat_org_id}','{uid}','ACTIVE') on conflict do nothing")
        _sql(f"insert into identity.user_roles(user_id,role_id,org_id) values ('{uid}','{finance_role}','{plat_org_id}') on conflict do nothing")

    # finance1 approves
    r = requests.post(f"{BASE}/api/orgs/{grow_org}/bank/change-requests/{bank_id}/approve",
                     headers={"Authorization":f"Bearer {f1_tok}","X-Org-Id":plat_org_id})
    assert r.status_code in (200,201), f"finance1 approve failed {r.status_code} {r.text}"
    body = r.json()
    assert body.get("status") == "APPROVED_FIRST", body

    # same approver again → 409
    r = requests.post(f"{BASE}/api/orgs/{grow_org}/bank/change-requests/{bank_id}/approve",
                     headers={"Authorization":f"Bearer {f1_tok}","X-Org-Id":plat_org_id})
    assert r.status_code == 409, f"same approver twice should be 409, got {r.status_code} {r.text}"

    # finance2 approves → APPROVED_FINAL
    r = requests.post(f"{BASE}/api/orgs/{grow_org}/bank/change-requests/{bank_id}/approve",
                     headers={"Authorization":f"Bearer {f2_tok}","X-Org-Id":plat_org_id})
    assert r.status_code in (200,201), r.text
    body = r.json()
    assert body.get("status") == "APPROVED_FINAL", body

# =========== GATE: tenant isolation / IDOR ==========
def test_gate_tenant_isolation_idor():
    ea, pa, ta, _, _ = _register()
    r = requests.post(f"{BASE}/api/orgs", headers={"Authorization":f"Bearer {ta}"},
                      json={"name":f"A {_rand()}","category":"BUYER"})
    org_a = r.json()["id"]

    eb, pb, tb, _, _ = _register()
    r = requests.post(f"{BASE}/api/orgs", headers={"Authorization":f"Bearer {tb}"},
                      json={"name":f"B {_rand()}","category":"BUYER"})
    org_b = r.json()["id"]

    # A reading B → 404
    r = requests.get(f"{BASE}/api/orgs/{org_b}", headers={"Authorization":f"Bearer {ta}","X-Org-Id":org_a})
    assert r.status_code == 404, f"cross-org read should 404, got {r.status_code}"

    # foreign X-Org-Id → 403
    r = requests.get(f"{BASE}/api/orgs/{org_b}", headers={"Authorization":f"Bearer {ta}","X-Org-Id":org_b})
    assert r.status_code == 403, f"foreign X-Org-Id should 403, got {r.status_code}"

# =========== GATE: privilege escalation ==========
def test_gate_priv_escalation_and_tampered_token():
    e, p, tok, _, uid = _register()
    r = requests.post(f"{BASE}/api/orgs", headers={"Authorization":f"Bearer {tok}"},
                      json={"name":f"X {_rand()}","category":"BUYER"})
    org = r.json()["id"]
    # Try to assign PLATFORM_ADMIN via any exposed member-role endpoint
    r = requests.post(f"{BASE}/api/orgs/{org}/members/{uid}/roles",
                      headers={"Authorization":f"Bearer {tok}","X-Org-Id":org},
                      json={"role":"PLATFORM_ADMIN"})
    assert r.status_code in (403,400,404), f"platform-role assignment must not succeed, got {r.status_code}"

    # tampered token
    r = requests.get(f"{BASE}/api/auth/me", headers={"Authorization":f"Bearer {tok}xxx"})
    assert r.status_code == 401, f"tampered token should be 401, got {r.status_code}"
