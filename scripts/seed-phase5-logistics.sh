#!/usr/bin/env bash
# Phase 5 (ADR-012) acceptance seed: one logistics job per transport mode against
# Nilgiri Fresh Logistics. DEV ONLY. Re-runnable: every run creates a fresh tagged chain
# (orders/shipments are new rows; nothing is mutated or duplicated in place).
set -euo pipefail

API="${1:-http://localhost:8001/api}"
PSQL="psql postgresql://florasetu:florasetu_dev@localhost:5432/florasetu -t -A -c"
PLATFORM_ORG=$($PSQL "SELECT id FROM identity.organizations WHERE ref='ORG-2026-000000';")
SUPPLIER_ORG=$($PSQL "SELECT m.org_id FROM identity.org_memberships m JOIN identity.users u ON u.id=m.user_id WHERE u.email='demo.supplier@florasetu.dev' AND m.status='ACTIVE' ORDER BY m.created_at DESC LIMIT 1;")
PARTNER_ORG=$($PSQL "SELECT m.org_id FROM identity.org_memberships m JOIN identity.users u ON u.id=m.user_id WHERE u.email='demo.logistics@florasetu.dev' AND m.status='ACTIVE' ORDER BY m.created_at DESC LIMIT 1;")
DRIVER1=$($PSQL "SELECT id FROM identity.users WHERE email='demo.driver@florasetu.dev';")
DRIVER2=$($PSQL "SELECT id FROM identity.users WHERE email='demo.driver2@florasetu.dev';")
ROSE=$($PSQL "SELECT id FROM catalog.commodities WHERE ref='PRD-SEED-ROSE_PREMIUM';")
STEM=$($PSQL "SELECT id FROM catalog.units_of_measure WHERE code='STEM';")
QTY=40
STAMP="$(date +%s)"
TODAY_PM="$(date -u -d 'today 18:00' +%Y-%m-%dT%H:%M:%SZ)"
TOMORROW_AM="$(date -u -d 'tomorrow 09:00' +%Y-%m-%dT%H:%M:%SZ)"
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

jqget() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
failcheck() { python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'error' in d:
    print('STEP FAILED:', json.dumps(d['error']), file=sys.stderr); sys.exit(1)"; }
login() { curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jqget "['accessToken']"; }

# Wait for the API to accept connections (supervisor restarts take a few seconds).
for i in $(seq 1 30); do
  if curl -sf "$API/health" > /dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -sf "$API/health" > /dev/null

OWNER_TOKEN=$(login nagesh.kgpl@gmail.com 'FloraSetu-Owner-2026')
SUP_TOKEN=$(login demo.supplier@florasetu.dev 'Demo-Supplier-2026')
OPS_TOKEN=$(login demo.procops@florasetu.dev 'Demo-ProcOps-2026')
PARTNER_TOKEN=$(login demo.logistics@florasetu.dev 'Demo-Logistics-2026')

OWNER=(-H "Authorization: Bearer $OWNER_TOKEN" -H "X-Org-Id: $PLATFORM_ORG" -H "Content-Type: application/json")
SUP=(-H "Authorization: Bearer $SUP_TOKEN" -H "X-Org-Id: $SUPPLIER_ORG" -H "Content-Type: application/json")
OPS=(-H "Authorization: Bearer $OPS_TOKEN" -H "X-Org-Id: $PLATFORM_ORG" -H "Content-Type: application/json")
PARTNER=(-H "Authorization: Bearer $PARTNER_TOKEN" -H "X-Org-Id: $PARTNER_ORG" -H "Content-Type: application/json")

# requirement -> RFQ -> quote -> award -> order -> declared lot -> allocate -> pack ->
# READY_FOR_DISPATCH -> shipment(mode) -> Ops assigns the PARTNER ORG only (ADR-012).
seed_job() {
  local LABEL="$1" MODE="$2" TC="$3" EXTRA="$4"
  local K="p5-$LABEL-$STAMP"
  local RESP REQ_ID LINE_ID RFQ_ID VERSION_ID AWARD_ID ORDER_ID ALLOC_LINE SAL_LINE LOT M SHIP_ID

  RESP=$(curl -s -X POST "$API/demand/requirements" "${OWNER[@]}" -d "{
    \"mode\":\"FORMAL\",\"title\":\"P5 $LABEL $STAMP\",
    \"lines\":[{\"commodityId\":\"$ROSE\",\"quantity\":$QTY,\"uomId\":\"$STEM\",
      \"neededAt\":\"$(date -u -d '+3 days' +%Y-%m-%dT%H:%M:%SZ)\",\"deliveryDestination\":\"P5 Dest $LABEL $STAMP\"}]}")
  echo "$RESP" | failcheck
  REQ_ID=$(echo "$RESP" | jqget "['id']")
  curl -s -X POST "$API/demand/requirements/$REQ_ID/submit" "${OWNER[@]}" -H "Idempotency-Key: $K-sub" | failcheck
  LINE_ID=$(curl -s "$API/demand/requirements/$REQ_ID" "${OWNER[@]}" | jqget "['lines'][0]['id']")
  RESP=$(curl -s -X POST "$API/demand/requirements/$REQ_ID/publish-rfq" "${OWNER[@]}" -H "Idempotency-Key: $K-pub" -d "{\"supplierOrgIds\":[\"$SUPPLIER_ORG\"]}")
  echo "$RESP" | failcheck
  RFQ_ID=$(echo "$RESP" | jqget "['id']")
  RESP=$(curl -s -X POST "$API/demand/rfqs/$RFQ_ID/quotes" "${SUP[@]}" -H "Idempotency-Key: $K-q" -d "{
    \"lines\":[{\"requirementLineId\":\"$LINE_ID\",\"quotedQty\":$QTY,\"quotedUomId\":\"$STEM\",\"unitPriceMinor\":3000}],
    \"validTo\":\"$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)\"}")
  echo "$RESP" | failcheck
  VERSION_ID=$(echo "$RESP" | jqget "['versionId']")
  RESP=$(curl -s -X POST "$API/demand/rfqs/$RFQ_ID/awards" "${OWNER[@]}" -H "Idempotency-Key: $K-aw" \
    -d "{\"lines\":[{\"requirementLineId\":\"$LINE_ID\",\"quotationVersionId\":\"$VERSION_ID\",\"awardedQty\":$QTY,\"uomId\":\"$STEM\"}]}")
  echo "$RESP" | failcheck
  AWARD_ID=$(echo "$RESP" | jqget "['id']")
  RESP=$(curl -s -X POST "$API/orders/convert-award" "${OWNER[@]}" -H "Idempotency-Key: $K-conv" -d "{\"awardId\":\"$AWARD_ID\"}")
  echo "$RESP" | failcheck
  ORDER_ID=$(echo "$RESP" | jqget "['id']")
  ALLOC_LINE=$(curl -s "$API/orders/allocations/mine" "${SUP[@]}" | python3 -c "import sys,json;items=json.load(sys.stdin)['items'];print([a['id'] for a in items if a['order_id']=='$ORDER_ID'][0])")
  curl -s -X POST "$API/orders/allocations/$ALLOC_LINE/confirm" "${SUP[@]}" | failcheck
  # Supplier allocation line id (NOT the order line id) — allocate/pack reference this.
  SAL_LINE=$(curl -s "$API/orders/$ORDER_ID" "${OWNER[@]}" | jqget "['allocationLines'][0]['id']")
  RESP=$(curl -s -X POST "$API/supply/lots/harvest" "${SUP[@]}" -H "Idempotency-Key: $K-lot" -d "{
    \"commodityId\":\"$ROSE\",\"declaredQty\":50,\"uomId\":\"$STEM\",\"originType\":\"OWN_FARM\",
    \"harvestedAt\":\"$(date -u -d '-6 hours' +%Y-%m-%dT%H:%M:%SZ)\",\"farmName\":\"P5 Farm $LABEL\"}")
  echo "$RESP" | failcheck
  LOT=$(echo "$RESP" | jqget "['id']")
  for i in 1 2; do
    M=$(curl -s -X POST "$API/media" "${SUP[@]}" -d "{\"contentType\":\"image/png\",\"dataBase64\":\"$PNG_B64\",\"bucket\":\"pilot\"}" | jqget "['id']")
    curl -s -X POST "$API/supply/lots/$LOT/media" "${SUP[@]}" -d "{\"mediaObjectId\":\"$M\",\"purpose\":\"LOT_ACTUAL\"}" | failcheck
  done
  curl -s -X POST "$API/supply/lots/$LOT/declaration" "${SUP[@]}" -d "{\"declaredStemLengthCm\":55,\"bloomStage\":\"HALF_OPEN\",\"batchRef\":\"P5-$LABEL-$STAMP\"}" | failcheck
  curl -s -X POST "$API/orders/allocate" "${OWNER[@]}" -H "Idempotency-Key: $K-al" -d "{\"supplierAllocationLineId\":\"$SAL_LINE\",\"lotId\":\"$LOT\",\"qty\":$QTY}" | failcheck
  curl -s -X POST "$API/logistics/pack" "${OWNER[@]}" -H "Idempotency-Key: $K-pk" -d "{\"orderId\":\"$ORDER_ID\",\"supplierAllocationLineId\":\"$SAL_LINE\",\"lotId\":\"$LOT\",\"packedQty\":$QTY,\"uomId\":\"$STEM\",\"packType\":\"CARTON\",\"cartonCount\":2}" | failcheck
  curl -s -X POST "$API/orders/$ORDER_ID/transition" "${OWNER[@]}" -d '{"to":"QC_PACK","reason":"seed"}' | failcheck
  curl -s -X POST "$API/orders/$ORDER_ID/transition" "${OWNER[@]}" -d '{"to":"READY_FOR_DISPATCH","reason":"seed"}' | failcheck
  RESP=$(curl -s -X POST "$API/logistics/shipments" "${OWNER[@]}" -H "Idempotency-Key: $K-sh" -d "{
    \"orderId\":\"$ORDER_ID\",\"mode\":\"$MODE\",\"tempControlled\":$TC,
    \"packageCount\":2,\"originText\":\"P5 Farm $LABEL, Ooty\",\"destinationText\":\"P5 Dest $LABEL $STAMP\",
    \"handlingNote\":\"Keep cartons upright, do not stack\", $EXTRA}")
  echo "$RESP" | failcheck
  SHIP_ID=$(echo "$RESP" | jqget "['id']")
  # ADR-012: Ops selects the partner ORG only — never a driver or vehicle.
  curl -s -X POST "$API/logistics/shipments/$SHIP_ID/assign" "${OPS[@]}" -d "{\"logisticsOrgId\":\"$PARTNER_ORG\"}" | failcheck
  echo "$LABEL shipment: $SHIP_ID" >&2
  echo "$SHIP_ID"
}

# 1. ROAD_DRIVER — reefer road, partner admin assigns own-org driver + vehicle.
J1=$(seed_job road-driver REEFER_ROAD true "\"pickupAt\":\"$TODAY_PM\",\"eta\":\"$TOMORROW_AM\"")
curl -s -X POST "$API/logistics/jobs/$J1/assign-driver" "${PARTNER[@]}" -d "{\"driverUserId\":\"$DRIVER1\",\"vehicleRef\":\"KA-04-E-1234\"}" | failcheck

# 2. ROAD_NO_DRIVER — road job with no named driver (stays valid, manager-executable).
J2=$(seed_job road-no-driver NORMAL_ROAD false "\"pickupAt\":\"$TODAY_PM\",\"eta\":\"$TOMORROW_AM\"")

# 3. BUS — operator + terminals + booking reference, no driver.
J3=$(seed_job bus BUS_PARCEL false "\"carrierName\":\"KPN Travels\",\"originTerminal\":\"Ooty Bus Stand\",\"destinationTerminal\":\"Bengaluru Satellite\",\"transportRef\":\"KPN-EXP-$STAMP\",\"etd\":\"$TODAY_PM\",\"eta\":\"$TOMORROW_AM\"")

# 4. RAIL — consignment reference, no driver.
J4=$(seed_job rail RAIL_PARCEL false "\"carrierName\":\"Indian Railways Parcel\",\"originTerminal\":\"Udagamandalam UAM\",\"destinationTerminal\":\"KSR Bengaluru SBC\",\"transportRef\":\"SWR-12627\",\"etd\":\"$TODAY_PM\",\"eta\":\"$TOMORROW_AM\"")

# 5. AIR — airline + AWB, no driver.
J5=$(seed_job air AIR_CARGO false "\"carrierName\":\"IndiGo Cargo\",\"originTerminal\":\"CJB Cargo Terminal\",\"destinationTerminal\":\"BLR Air Cargo\",\"transportRef\":\"6E-513\",\"parcelAwbRef\":\"AWB-6E-$STAMP\",\"etd\":\"$TODAY_PM\",\"eta\":\"$TOMORROW_AM\"")

# 6. LOCAL_PICKUP — same-day local run.
J6=$(seed_job local-pickup LOCAL_PICKUP false "\"pickupAt\":\"$TODAY_PM\",\"eta\":\"$TODAY_PM\"")

# 7. EXCEPTION — accepted, then an issue reported (Operations visibility, nothing blocked).
J7=$(seed_job exception INSULATED_ROAD true "\"pickupAt\":\"$TODAY_PM\",\"eta\":\"$TOMORROW_AM\"")
curl -s -X POST "$API/logistics/jobs/$J7/accept" "${PARTNER[@]}" | failcheck
curl -s -X POST "$API/logistics/jobs/$J7/exception" "${PARTNER[@]}" -d "{\"type\":\"VEHICLE_BREAKDOWN\",\"note\":\"Insulated van breakdown on NH-44 — recovery arranged\"}" | failcheck

# 8. POD — second driver assigned, full execution to delivered with POD evidence.
J8=$(seed_job pod SPECIAL_EXPRESS false "\"pickupAt\":\"$TODAY_PM\",\"eta\":\"$TODAY_PM\"")
curl -s -X POST "$API/logistics/jobs/$J8/assign-driver" "${PARTNER[@]}" -d "{\"driverUserId\":\"$DRIVER2\",\"vehicleRef\":\"KA-51-M-7788\"}" | failcheck
curl -s -X POST "$API/logistics/jobs/$J8/accept" "${PARTNER[@]}" | failcheck
curl -s -X POST "$API/logistics/jobs/$J8/arrived-pickup" "${PARTNER[@]}" | failcheck
PM=$(curl -s -X POST "$API/media" "${PARTNER[@]}" -d "{\"contentType\":\"image/png\",\"dataBase64\":\"$PNG_B64\",\"bucket\":\"pilot\"}" | jqget "['id']")
curl -s -X POST "$API/logistics/jobs/$J8/pickup" "${PARTNER[@]}" -d "{\"transportRef\":\"KA-51-M-7788\",\"mediaObjectId\":\"$PM\"}" | failcheck
curl -s -X POST "$API/logistics/jobs/$J8/transit" "${PARTNER[@]}" | failcheck
curl -s -X POST "$API/logistics/jobs/$J8/arrived-delivery" "${PARTNER[@]}" | failcheck
DM=$(curl -s -X POST "$API/media" "${PARTNER[@]}" -d "{\"contentType\":\"image/png\",\"dataBase64\":\"$PNG_B64\",\"bucket\":\"pilot\"}" | jqget "['id']")
SM=$(curl -s -X POST "$API/media" "${PARTNER[@]}" -d "{\"contentType\":\"image/png\",\"dataBase64\":\"$PNG_B64\",\"bucket\":\"pilot\"}" | jqget "['id']")
curl -s -X POST "$API/logistics/jobs/$J8/deliver" "${PARTNER[@]}" -d "{\"deliveredQty\":$QTY,\"receiverName\":\"Front Desk\",\"podRef\":\"POD-$STAMP\",\"mediaObjectId\":\"$DM\",\"signatureMediaObjectId\":\"$SM\",\"notes\":\"Received in good order\"}" | failcheck

echo "PHASE 5 SEED COMPLETE (tag $STAMP)"
echo "  road-driver:    $J1 (driver: demo.driver, vehicle KA-04-E-1234)"
echo "  road-no-driver: $J2"
echo "  bus:            $J3"
echo "  rail:           $J4"
echo "  air:            $J5"
echo "  local-pickup:   $J6"
echo "  exception:      $J7 (open issue reported)"
echo "  pod:            $J8 (delivered with POD evidence)"
