#!/usr/bin/env bash
# Seeds a fresh pilot order in READY_FOR_DISPATCH (packed, not yet dispatched) so the
# UI dispatch -> POD -> accept -> claim chain stays reproducible. Dev env only.
set -euo pipefail

API="${1:-http://localhost:8001/api}"
# IDs are resolved dynamically so the script survives pod restarts / DB re-seeds.
PSQL="psql postgresql://florasetu:florasetu_dev@localhost:5432/florasetu -t -A -c"
BUYER_ORG=$($PSQL "SELECT id FROM identity.organizations WHERE ref='ORG-2026-000000';")
SUPPLIER_ORG=$($PSQL "SELECT m.org_id FROM identity.org_memberships m JOIN identity.users u ON u.id=m.user_id WHERE u.email='demo.supplier@florasetu.dev' AND m.status='ACTIVE' ORDER BY m.created_at DESC LIMIT 1;")
ROSE=$($PSQL "SELECT id FROM catalog.commodities WHERE ref='PRD-SEED-ROSE_PREMIUM';")
STEM=$($PSQL "SELECT id FROM catalog.units_of_measure WHERE code='STEM';")
QTY=40
STAMP="$(date +%s)"

jqget() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
failcheck() { python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'error' in d:
    print('STEP FAILED:', json.dumps(d['error'])); sys.exit(1)
print(json.dumps(d))"; }

OWNER_TOKEN=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"nagesh.kgpl@gmail.com","password":"FloraSetu-Owner-2026"}' | jqget "['accessToken']")
SUP_TOKEN=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"demo.supplier@florasetu.dev","password":"Demo-Supplier-2026"}' | jqget "['accessToken']")

OWNER=(-H "Authorization: Bearer $OWNER_TOKEN" -H "X-Org-Id: $BUYER_ORG" -H "Content-Type: application/json")
SUP=(-H "Authorization: Bearer $SUP_TOKEN" -H "X-Org-Id: $SUPPLIER_ORG" -H "Content-Type: application/json")

REQ=$(curl -s -X POST "$API/demand/requirements" "${OWNER[@]}" -d "{
  \"mode\":\"FORMAL\",\"title\":\"Pilot seed $STAMP\",
  \"lines\":[{\"commodityId\":\"$ROSE\",\"quantity\":$QTY,\"uomId\":\"$STEM\",
    \"neededAt\":\"$(date -u -d '+3 days' +%Y-%m-%dT%H:%M:%SZ)\",\"deliveryDestination\":\"Pilot Dest $STAMP\"}]}")
REQ_ID=$(echo "$REQ" | jqget "['id']")
echo "requirement: $REQ_ID"

curl -s -X POST "$API/demand/requirements/$REQ_ID/submit" "${OWNER[@]}" -H "Idempotency-Key: seed-$STAMP-sub" > /dev/null
LINE_ID=$(curl -s "$API/demand/requirements/$REQ_ID" "${OWNER[@]}" | jqget "['lines'][0]['id']")
echo "requirement line: $LINE_ID"

RFQ=$(curl -s -X POST "$API/demand/requirements/$REQ_ID/publish-rfq" "${OWNER[@]}" -H "Idempotency-Key: seed-$STAMP-pub" \
  -d "{\"supplierOrgIds\":[\"$SUPPLIER_ORG\"]}")
RFQ_ID=$(echo "$RFQ" | jqget "['id']")
echo "rfq: $RFQ_ID"

QUOTE=$(curl -s -X POST "$API/demand/rfqs/$RFQ_ID/quotes" "${SUP[@]}" -H "Idempotency-Key: seed-$STAMP-q" -d "{
  \"lines\":[{\"requirementLineId\":\"$LINE_ID\",\"quotedQty\":$QTY,\"quotedUomId\":\"$STEM\",\"unitPriceMinor\":3000}],
  \"validTo\":\"$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)\"}")
VERSION_ID=$(echo "$QUOTE" | jqget "['versionId']")
echo "quote version: $VERSION_ID"

AWARD=$(curl -s -X POST "$API/demand/rfqs/$RFQ_ID/awards" "${OWNER[@]}" -H "Idempotency-Key: seed-$STAMP-aw" \
  -d "{\"lines\":[{\"requirementLineId\":\"$LINE_ID\",\"quotationVersionId\":\"$VERSION_ID\",\"awardedQty\":$QTY,\"uomId\":\"$STEM\"}]}")
AWARD_ID=$(echo "$AWARD" | jqget "['id']")
echo "award: $AWARD_ID"

ORDER=$(curl -s -X POST "$API/orders/convert-award" "${OWNER[@]}" -H "Idempotency-Key: seed-$STAMP-conv" \
  -d "{\"awardId\":\"$AWARD_ID\"}")
ORDER_ID=$(echo "$ORDER" | jqget "['id']")
echo "order: $ORDER_ID ($(echo "$ORDER" | jqget "['ref']"))"

ALLOC_LINE=$(curl -s "$API/orders/allocations/mine" "${SUP[@]}" | jqget "['items'][0]['id']")
curl -s -X POST "$API/orders/allocations/$ALLOC_LINE/confirm" "${SUP[@]}" > /dev/null
echo "allocation confirmed: $ALLOC_LINE"
SAL_LINE=$(curl -s "$API/orders/$ORDER_ID" "${SUP[@]}" | jqget "['lines'][0]['id']")
echo "supplier allocation line: $SAL_LINE"

# Fresh supplier lot in the SAME uom as the order line (STEM) — lot/line uom must match.
LOT_RESP=$(curl -s -X POST "$API/supply/lots/harvest" "${SUP[@]}" -H "Idempotency-Key: seed-$STAMP-lot" -d "{
  \"commodityId\":\"$ROSE\",\"declaredQty\":50,\"uomId\":\"$STEM\",\"originType\":\"OWN_FARM\",
  \"harvestedAt\":\"$(date -u -d '-6 hours' +%Y-%m-%dT%H:%M:%SZ)\",\"farmName\":\"Pilot Farm\"}")
LOT=$(echo "$LOT_RESP" | jqget "['id']")
echo "lot: $LOT ($(echo "$LOT_RESP" | jqget "['ref']"))"
# ADR-011: supplier-declaration path — 2 actual-lot photos + declaration makes the lot AVAILABLE (no QC).
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
for i in 1 2; do
  M=$(curl -s -X POST "$API/media" "${SUP[@]}" -d "{\"contentType\":\"image/png\",\"dataBase64\":\"$PNG_B64\",\"bucket\":\"pilot\"}" | jqget "['id']")
  curl -s -X POST "$API/supply/lots/$LOT/media" "${SUP[@]}" -d "{\"mediaObjectId\":\"$M\",\"purpose\":\"LOT_ACTUAL\"}" | failcheck > /dev/null
done
curl -s -X POST "$API/supply/lots/$LOT/declaration" "${SUP[@]}" -d "{
  \"declaredStemLengthCm\":55,\"bloomStage\":\"HALF_OPEN\",\"batchRef\":\"PILOT-$STAMP\"}" | failcheck
echo "lot declared (supplier declaration, no QC)"

curl -s -X POST "$API/orders/allocate" "${OWNER[@]}" -H "Idempotency-Key: seed-$STAMP-al" \
  -d "{\"supplierAllocationLineId\":\"$SAL_LINE\",\"lotId\":\"$LOT\",\"qty\":$QTY}" | failcheck
echo "lot allocated"

curl -s -X POST "$API/logistics/pack" "${OWNER[@]}" -H "Idempotency-Key: seed-$STAMP-pk" -d "{
  \"orderId\":\"$ORDER_ID\",\"supplierAllocationLineId\":\"$SAL_LINE\",\"lotId\":\"$LOT\",
  \"packedQty\":$QTY,\"uomId\":\"$STEM\",\"packType\":\"CARTON\",\"cartonCount\":2}" | failcheck
echo "packed"

curl -s -X POST "$API/orders/$ORDER_ID/transition" "${OWNER[@]}" -d '{"to":"QC_PACK","reason":"seed"}' | failcheck
curl -s -X POST "$API/orders/$ORDER_ID/transition" "${OWNER[@]}" -d '{"to":"READY_FOR_DISPATCH","reason":"seed"}' | failcheck
FINAL=$(curl -s "$API/orders/$ORDER_ID" "${OWNER[@]}" | jqget "['status']")
echo "SEEDED order $ORDER_ID status=$FINAL"
