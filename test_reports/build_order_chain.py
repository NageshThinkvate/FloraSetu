#!/usr/bin/env python3
"""Build full order chain -> deliver, for the confirmed offer/award."""
import requests, json, datetime, time, uuid, sys, os, base64
BASE = os.environ.get("BASE") or "https://flora-modular-core.preview.emergentagent.com"

ctx = json.load(open("/tmp/p3_context.json"))
buyer_tok = ctx["buyer_tok"]; sup_tok = ctx["sup_tok"]; log_tok = ctx["log_tok"]
buyer_org = ctx["buyer_org"]; sup_org = ctx["sup_org"]; log_org = ctx["log_org"]
rose_id = ctx["rose_id"]; stem_id = ctx["stem_id"]
req_id = ctx["req_id"]; rfq_id = ctx["rfq_id"]

def H(tok, org, extra=None):
    h = {"Authorization": f"Bearer {tok}", "X-Org-Id": org, "Content-Type": "application/json"}
    if extra: h.update(extra)
    return h

def idem(): return {"Idempotency-Key": str(uuid.uuid4())}

# Find the award linked to this requirement/rfq
aw = requests.get(f"{BASE}/api/demand/rfqs/{rfq_id}/awards", headers=H(buyer_tok, buyer_org)).json()
items = aw.get("items", aw) if isinstance(aw, dict) else aw
print("awards count:", len(items))
award = items[0]
award_id = award["id"]
print("award_id:", award_id, "status:", award.get("status"))

# Prepare-order (creates order from award)
r = requests.post(f"{BASE}/api/orders/convert-award",
    headers=H(buyer_tok, buyer_org, idem()),
    json={"awardId": award_id})
print("CONVERT:", r.status_code, r.text[:400])
conv = r.json() if r.status_code < 300 else {}
order_id = conv.get("orderId") or conv.get("order_id") or conv.get("id")
if not order_id:
    orders = requests.get(f"{BASE}/api/orders", headers=H(buyer_tok, buyer_org)).json()
    oi = orders.get("items", orders) if isinstance(orders, dict) else orders
    print("orders count:", len(oi))
    if oi: order_id = oi[0]["id"]
print("order_id:", order_id)

# Supplier: create harvest lot
harvest_at = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
r = requests.post(f"{BASE}/api/supply/lots/harvest", headers=H(sup_tok, sup_org, idem()),
    json={"commodityId": rose_id, "declaredQty": 100, "uomId": stem_id, "originType":"OWN_FARM", "harvestedAt": harvest_at})
print("LOT HARVEST:", r.status_code, r.text[:300])
lot = r.json(); lot_id = lot.get("id")

# media
png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
media_ids = []
for _ in range(2):
    r = requests.post(f"{BASE}/api/media", headers=H(sup_tok, sup_org),
        json={"contentType":"image/png","dataBase64":png_b64,"bucket":"pilot"})
    print("MEDIA:", r.status_code, r.text[:150])
    m = r.json(); media_ids.append(m.get("id") or m.get("mediaObjectId"))
for mid in media_ids:
    r = requests.post(f"{BASE}/api/supply/lots/{lot_id}/media", headers=H(sup_tok, sup_org),
        json={"mediaObjectId": mid, "purpose":"LOT_ACTUAL"})
    print("LOT MEDIA:", r.status_code, r.text[:150])

# declaration
r = requests.post(f"{BASE}/api/supply/lots/{lot_id}/declaration", headers=H(sup_tok, sup_org),
    json={"batchRef":"P3-RETEST","bloomStage":"HALF_OPEN","declaredStemLengthCm":55})
print("DECLARATION:", r.status_code, r.text[:200])

# Buyer: get order + line
r = requests.get(f"{BASE}/api/orders/{order_id}", headers=H(buyer_tok, buyer_org))
print("ORDER GET (buyer):", r.status_code)
order = r.json()
order_line_id = order["lines"][0]["id"]
sup_alloc_line_id = order["allocationLines"][0]["id"]
sup_alloc_id = order["allocations"][0]["id"]
print("order_line_id:", order_line_id, "sup_alloc_line_id:", sup_alloc_line_id, "sup_alloc_id:", sup_alloc_id)

# Supplier confirms the allocation (moves SAL from PENDING_CONFIRMATION -> CONFIRMED)
r = requests.post(f"{BASE}/api/orders/allocations/{sup_alloc_id}/confirm",
    headers=H(sup_tok, sup_org, idem()))
print("SUP ALLOC CONFIRM:", r.status_code, r.text[:300])

# Buyer allocates lot -> supplier allocation line
r = requests.post(f"{BASE}/api/orders/allocate", headers=H(buyer_tok, buyer_org, idem()),
    json={"supplierAllocationLineId": sup_alloc_line_id, "lotId": lot_id, "qty": 100})
print("ALLOCATE LOT:", r.status_code, r.text[:400])
alloc_resp = r.json() if r.status_code<300 else {}
allocation_id = alloc_resp.get("id")
print("allocation_id:", allocation_id)

# Transitions - use 'to' field per DTO
r = requests.post(f"{BASE}/api/orders/{order_id}/transition", headers=H(buyer_tok, buyer_org, idem()),
    json={"to": "QC_PACK"})
print("TRANSITION QC_PACK:", r.status_code, r.text[:200])

# Pack (supplier - pack.manage)
r = requests.post(f"{BASE}/api/logistics/pack", headers=H(sup_tok, sup_org, idem()),
    json={"orderId": order_id, "supplierAllocationLineId": sup_alloc_line_id, "lotId": lot_id, "packedQty": 100, "uomId": stem_id, "packType":"CARTON","cartonCount":2})
print("PACK:", r.status_code, r.text[:300])

r = requests.post(f"{BASE}/api/orders/{order_id}/transition", headers=H(buyer_tok, buyer_org, idem()),
    json={"to": "READY_FOR_DISPATCH"})
print("TRANSITION READY_FOR_DISPATCH:", r.status_code, r.text[:200])

# Shipment (buyer first, procops fallback)
r = requests.post(f"{BASE}/api/logistics/shipments", headers=H(buyer_tok, buyer_org, idem()),
    json={"orderId": order_id, "mode":"REEFER_ROAD","tempControlled":True,"packageCount":2})
print("SHIPMENT (buyer):", r.status_code, r.text[:200])
if r.status_code >= 400:
    # try procops
    p = requests.post(f"{BASE}/api/auth/login", json={"email":"demo.procops@florasetu.dev","password":"Demo-ProcOps-2026"}).json()
    proc_tok = p["accessToken"]
    proc_me = requests.get(f"{BASE}/api/auth/me", headers={"Authorization":f"Bearer {proc_tok}"}).json()
    proc_org = proc_me["memberships"][0]["org_id"]
    r = requests.post(f"{BASE}/api/logistics/shipments", headers=H(proc_tok, proc_org, idem()),
        json={"orderId": order_id, "mode":"REEFER_ROAD","tempControlled":True,"packageCount":2})
    print("SHIPMENT (procops):", r.status_code, r.text[:300])
    shp_tok, shp_org = proc_tok, proc_org
else:
    shp_tok, shp_org = buyer_tok, buyer_org
shp = r.json(); shp_id = shp.get("id")
print("shipment id:", shp_id)

LOG_ORG_ID = "f0891873-773a-45af-a2aa-7cd8fb7d221a"
r = requests.post(f"{BASE}/api/logistics/shipments/{shp_id}/assign", headers=H(shp_tok, shp_org, idem()),
    json={"logisticsOrgId": LOG_ORG_ID})
print("ASSIGN:", r.status_code, r.text[:300])

# Logistics accept / pickup / transit / deliver
jobs = requests.get(f"{BASE}/api/logistics/jobs", headers=H(log_tok, LOG_ORG_ID)).json()
ji = jobs.get("items", jobs) if isinstance(jobs, dict) else jobs
print("jobs count:", len(ji), "first:", (json.dumps(ji[0])[:400] if ji else "none"))
job = None
for j in ji:
    if not isinstance(j, dict): continue
    if j.get("shipmentId")==shp_id or j.get("shipment_id")==shp_id:
        job = j; break
if not job and ji:
    for j in ji:
        if isinstance(j, dict): job = j; break
job_id = job["id"] if job else None
print("job_id:", job_id)

for path, body in [("accept", {}), ("pickup", {}), ("transit", {}), ("deliver", {"deliveredQty":100, "receiverName":"Front Desk"})]:
    r = requests.post(f"{BASE}/api/logistics/jobs/{job_id}/{path}",
        headers=H(log_tok, LOG_ORG_ID, idem()), json=body)
    print(f"LOG {path}:", r.status_code, r.text[:200])

print(f"\n=== ORDER READY === order_id={order_id} lot_id={lot_id} shp_id={shp_id}")
ctx.update({"order_id": order_id, "lot_id": lot_id, "shp_id": shp_id, "award_id": award_id})
with open("/tmp/p3_context.json","w") as f:
    json.dump(ctx, f)
