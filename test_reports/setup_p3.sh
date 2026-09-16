#!/bin/bash
# API-assisted setup for Phase 3 frontend testing
set -e
BASE="https://a58e29e4-b933-42ad-bc57-a163f74143ee.preview.emergentagent.com"

login() {
  curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}"
}

BUYER=$(login demo.buyer@florasetu.dev Demo-Buyer-2026)
BUYER_TOK=$(echo $BUYER | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
BUYER_ORG=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $BUYER_TOK" | python3 -c "import sys,json;m=json.load(sys.stdin)['memberships'];print([x for x in m if 'Buyer' in x.get('name','')][0]['org_id'])")
echo "BUYER_ORG=$BUYER_ORG"

SUP=$(login demo.supplier@florasetu.dev Demo-Supplier-2026)
SUP_TOK=$(echo $SUP | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
SUP_ORG=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $SUP_TOK" | python3 -c "import sys,json;m=json.load(sys.stdin)['memberships'];print(m[0]['org_id'])")
echo "SUP_ORG=$SUP_ORG"

PROD=$(curl -s "$BASE/api/catalog/products" -H "Authorization: Bearer $BUYER_TOK" -H "X-Org-Id: $BUYER_ORG")
ROSE_ID=$(echo $PROD | python3 -c "import sys,json;d=json.load(sys.stdin);items=d.get('items',d) if isinstance(d,dict) else d; print([p for p in items if 'rose' in p.get('name','').lower()][0]['id'])")
echo "ROSE_ID=$ROSE_ID"

UOMS=$(curl -s "$BASE/api/catalog/units" -H "Authorization: Bearer $BUYER_TOK" -H "X-Org-Id: $BUYER_ORG")
STEM_ID=$(echo $UOMS | python3 -c "import sys,json;d=json.load(sys.stdin);items=d.get('items',d) if isinstance(d,dict) else d; print([u for u in items if u.get('code')=='STEM'][0]['id'])")
echo "STEM_ID=$STEM_ID"

NEEDED=$(python3 -c "import datetime;print((datetime.datetime.utcnow()+datetime.timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")

# Create requirement
REQ=$(curl -s -X POST "$BASE/api/demand/requirements" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BUYER_TOK" -H "X-Org-Id: $BUYER_ORG" \
  -d "{\"mode\":\"QUICK\",\"title\":\"P3 test\",\"lines\":[{\"commodityId\":\"$ROSE_ID\",\"quantity\":100,\"uomId\":\"$STEM_ID\",\"neededAt\":\"$NEEDED\",\"deliveryDestination\":\"Chennai\"}]}")
echo "REQ=$REQ"
REQ_ID=$(echo $REQ | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
LINE_ID=$(echo $REQ | python3 -c "import sys,json;print(json.load(sys.stdin)['lines'][0]['id'])")
echo "REQ_ID=$REQ_ID LINE_ID=$LINE_ID"

# Submit (idempotency-key required)
SUB=$(curl -s -X POST "$BASE/api/demand/requirements/$REQ_ID/submit" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BUYER_TOK" -H "X-Org-Id: $BUYER_ORG" \
  -H "Idempotency-Key: p3-$(date +%s)-$RANDOM")
echo "SUB=$SUB"

# Wait a moment
sleep 2

# Supplier: inbox
INBOX=$(curl -s "$BASE/api/demand/inbox" -H "Authorization: Bearer $SUP_TOK" -H "X-Org-Id: $SUP_ORG")
RFQ_ID=$(echo $INBOX | python3 -c "import sys,json,os;d=json.load(sys.stdin);items=d.get('items',d) if isinstance(d,dict) else d;req_id=os.environ['REQ_ID'];print([r for r in items if r.get('requirementId')==req_id][0]['id'])" REQ_ID=$REQ_ID)
RFQ_LINE_ID=$(echo $INBOX | python3 -c "import sys,json,os;d=json.load(sys.stdin);items=d.get('items',d) if isinstance(d,dict) else d;req_id=os.environ['REQ_ID'];print([r for r in items if r.get('requirementId')==req_id][0]['lines'][0]['id'])" REQ_ID=$REQ_ID)
echo "RFQ_ID=$RFQ_ID RFQ_LINE_ID=$RFQ_LINE_ID"

VALIDTO=$(python3 -c "import datetime;print((datetime.datetime.utcnow()+datetime.timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")
QUOTE=$(curl -s -X POST "$BASE/api/demand/rfqs/$RFQ_ID/quotes" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $SUP_TOK" -H "X-Org-Id: $SUP_ORG" \
  -H "Idempotency-Key: q-$(date +%s)-$RANDOM" \
  -d "{\"validTo\":\"$VALIDTO\",\"lines\":[{\"requirementLineId\":\"$LINE_ID\",\"quotedQty\":100,\"quotedUomId\":\"$STEM_ID\",\"unitPriceMinor\":42000}]}")
echo "QUOTE=$QUOTE"

echo "SETUP_DONE REQ_ID=$REQ_ID RFQ_ID=$RFQ_ID"
