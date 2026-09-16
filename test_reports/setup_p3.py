#!/usr/bin/env python3
"""API-assisted setup for P3 frontend testing."""
import requests, json, datetime, time, sys, os
BASE = "https://a58e29e4-b933-42ad-bc57-a163f74143ee.preview.emergentagent.com"

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
# Create requirement
r = requests.post(f"{BASE}/api/demand/requirements",
    headers=hdr(buyer_tok, buyer_org),
    json={"mode":"QUICK","title":"P3 auto","lines":[{"commodityId":rose['id'],"quantity":100,"uomId":stem['id'],"neededAt":needed,"deliveryDestination":"Chennai"}]})
print("REQ POST:", r.status_code, r.text[:200])
req_id = r.json()["id"]
# Get lines
req_full = requests.get(f"{BASE}/api/demand/requirements/{req_id}", headers=hdr(buyer_tok, buyer_org)).json()
line_id = req_full["lines"][0]["id"]
print(f"req_id={req_id} line_id={line_id}")

# Submit
import uuid
r = requests.post(f"{BASE}/api/demand/requirements/{req_id}/submit",
    headers={**hdr(buyer_tok, buyer_org), "Idempotency-Key": str(uuid.uuid4())})
print("SUBMIT:", r.status_code, r.text[:200])
time.sleep(2)

# Supplier inbox
inbox = requests.get(f"{BASE}/api/demand/inbox", headers=hdr(sup_tok, sup_org)).json()
inbox_items = inbox.get("items", inbox) if isinstance(inbox, dict) else inbox
rfq = [x for x in inbox_items if x.get("requirementId")==req_id or x.get("requirement_id")==req_id]
print(f"rfq matches: {len(rfq)}. First inbox item keys: {list(inbox_items[0].keys()) if inbox_items else 'empty'}")
if not rfq:
    print("inbox sample:", json.dumps(inbox_items[:1], indent=2)[:800])
    sys.exit(1)
rfq = rfq[0]
rfq_id = rfq["id"]
# rfq lines
rfq_full = requests.get(f"{BASE}/api/demand/rfqs/{rfq_id}", headers=hdr(sup_tok, sup_org)).json()
print("rfq keys:", list(rfq_full.keys()))
rfq_line_id = rfq_full.get("lines", [{}])[0].get("requirement_line_id") or rfq_full.get("lines", [{}])[0].get("requirementLineId") or line_id
print(f"rfq_id={rfq_id}")

validto = (datetime.datetime.utcnow()+datetime.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
r = requests.post(f"{BASE}/api/demand/rfqs/{rfq_id}/quotes",
    headers={**hdr(sup_tok, sup_org), "Idempotency-Key": str(uuid.uuid4())},
    json={"validTo": validto, "lines":[{"requirementLineId": line_id, "quotedQty":100, "quotedUomId":stem['id'], "unitPriceMinor":42000}]})
print("QUOTE:", r.status_code, r.text[:300])

print(f"\n=== SETUP_DONE ===\nREQ_ID={req_id}\nRFQ_ID={rfq_id}\nBUYER_ORG={buyer_org}")

# Save context
with open("/tmp/p3_context.json","w") as f:
    json.dump({"req_id":req_id,"rfq_id":rfq_id,"buyer_org":buyer_org,"sup_org":sup_org,"log_org":log_org,
               "rose_id":rose['id'],"stem_id":stem['id'],"line_id":line_id,
               "buyer_tok":buyer_tok,"sup_tok":sup_tok,"log_tok":log_tok},f)
