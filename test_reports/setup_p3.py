#!/usr/bin/env python3
"""API-assisted setup for P3 frontend testing (iter16 retest)."""
import requests, json, datetime, time, sys, os, uuid
BASE = os.environ.get("BASE") or "https://flora-modular-core.preview.emergentagent.com"

def login(email, pw):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})
    r.raise_for_status()
    tok = r.json()["accessToken"]
    me = requests.get(f"{BASE}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()
    return tok, me

def hdr(tok, org):
    return {"Authorization": f"Bearer {tok}", "X-Org-Id": org, "Content-Type": "application/json"}

buyer_tok, buyer_me = login("demo.buyer@florasetu.dev", "Demo-Buyer-2026")
buyer_org = buyer_me["memberships"][0]["org_id"]
sup_tok, sup_me = login("demo.supplier@florasetu.dev", "Demo-Supplier-2026")
sup_org = sup_me["memberships"][0]["org_id"]
log_tok, log_me = login("demo.logistics@florasetu.dev", "Demo-Logistics-2026")
log_org = log_me["memberships"][0]["org_id"]
print(f"buyer_org={buyer_org} sup_org={sup_org} log_org={log_org}")

# catalog
products = requests.get(f"{BASE}/api/catalog/products", headers=hdr(buyer_tok, buyer_org)).json()
items = products.get("items", products) if isinstance(products, dict) else products
rose = [p for p in items if "rose" in p.get("name","").lower()][0]
uoms = requests.get(f"{BASE}/api/catalog/units", headers=hdr(buyer_tok, buyer_org)).json()
uitems = uoms.get("items", uoms) if isinstance(uoms, dict) else uoms
stem = [u for u in uitems if u.get("code")=="STEM"][0]
print(f"rose_id={rose['id']} stem_id={stem['id']}")

needed = (datetime.datetime.utcnow()+datetime.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
tag = f"P3-RETEST-{int(time.time())}"
r = requests.post(f"{BASE}/api/demand/requirements",
    headers=hdr(buyer_tok, buyer_org),
    json={"mode":"QUICK","title":tag,"lines":[{"commodityId":rose['id'],"quantity":100,"uomId":stem['id'],"neededAt":needed,"deliveryDestination":"Chennai"}]})
print("REQ POST:", r.status_code, r.text[:200])
req_id = r.json()["id"]
req_full = requests.get(f"{BASE}/api/demand/requirements/{req_id}", headers=hdr(buyer_tok, buyer_org)).json()
line_id = req_full["lines"][0]["id"]

r = requests.post(f"{BASE}/api/demand/requirements/{req_id}/submit",
    headers={**hdr(buyer_tok, buyer_org), "Idempotency-Key": str(uuid.uuid4())})
print("SUBMIT:", r.status_code, r.text[:200])
time.sleep(2)

# Supplier inbox — CORRECT endpoint
inbox = requests.get(f"{BASE}/api/demand/rfqs/inbox", headers=hdr(sup_tok, sup_org)).json()
inbox_items = inbox.get("items", inbox) if isinstance(inbox, dict) else inbox
print(f"inbox count: {len(inbox_items)}")
# Match by requirement_id
rfq = None
for x in inbox_items:
    rid = x.get("requirementId") or x.get("requirement_id")
    if rid == req_id:
        rfq = x; break
if not rfq and inbox_items:
    # fallback: newest
    rfq = sorted(inbox_items, key=lambda x: x.get("createdAt") or x.get("created_at") or "", reverse=True)[0]
if not rfq:
    print("NO RFQ FOUND", json.dumps(inbox_items[:2])[:500]); sys.exit(1)
rfq_id = rfq["id"]
rfq_full = requests.get(f"{BASE}/api/demand/rfqs/{rfq_id}", headers=hdr(sup_tok, sup_org)).json()
rfq_line = rfq_full.get("lines", [{}])[0]
rfq_line_id = rfq_line.get("requirement_line_id") or rfq_line.get("requirementLineId") or line_id
print(f"rfq_id={rfq_id} rfq_line_id={rfq_line_id}")

validto = (datetime.datetime.utcnow()+datetime.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
r = requests.post(f"{BASE}/api/demand/rfqs/{rfq_id}/quotes",
    headers={**hdr(sup_tok, sup_org), "Idempotency-Key": str(uuid.uuid4())},
    json={"validTo": validto, "lines":[{"requirementLineId": rfq_line_id, "quotedQty":100, "quotedUomId":stem['id'], "unitPriceMinor":42000}]})
print("QUOTE:", r.status_code, r.text[:300])

print(f"\n=== SETUP_DONE ===\nREQ_ID={req_id}\nRFQ_ID={rfq_id}\nTAG={tag}\nBUYER_ORG={buyer_org}")

with open("/tmp/p3_context.json","w") as f:
    json.dump({"req_id":req_id,"rfq_id":rfq_id,"tag":tag,"buyer_org":buyer_org,"sup_org":sup_org,"log_org":log_org,
               "rose_id":rose['id'],"stem_id":stem['id'],"line_id":line_id,
               "buyer_tok":buyer_tok,"sup_tok":sup_tok,"log_tok":log_tok, "base": BASE},f)
