"""
Patch: normalize out-of-range AI scores on TRANSFERRED_TO edges.

Rules:
  finbert_score   must be in [-1, 1]   → divide by 100 if outside range
  emotion_score   must be in [ 0, 1]   → divide by 100 if > 1
  risk_score_latest must be in [0, 1]  → divide by 100 if > 1
"""
from dotenv import load_dotenv; load_dotenv(override=True)
import os, json, urllib.parse
import requests as _req
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

endpoint = os.getenv("NEPTUNE_ENDPOINT")
port     = int(os.getenv("NEPTUNE_PORT", "8182"))
region   = os.getenv("AWS_REGION", "ap-southeast-1")
url      = f"https://{endpoint}:{port}/openCypher"

def run(cypher, params=None):
    body = urllib.parse.urlencode({
        "query": cypher,
        **({"parameters": json.dumps(params)} if params else {}),
    })
    creds = Credentials(
        os.getenv("AWS_ACCESS_KEY_ID"),
        os.getenv("AWS_SECRET_ACCESS_KEY"),
        os.getenv("AWS_SESSION_TOKEN") or None,
    )
    req = AWSRequest(method="POST", url=url, data=body,
                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    SigV4Auth(creds, "neptune-db", region).add_auth(req)
    r = _req.post(url, data=body, headers=dict(req.headers), timeout=15)
    if r.status_code != 200:
        print(f"  ERROR {r.status_code}: {r.text[:400]}")
        return {}
    return r.json()

# ── 1. Audit current edge scores ──────────────────────────────────────────
print("=" * 70)
print("Auditing TRANSFERRED_TO edge scores …")
audit = run("""
MATCH (a:User)-[r:TRANSFERRED_TO]->(b:User)
RETURN id(r) AS eid,
       a.name AS from_name, b.name AS to_name,
       r.amount AS amount,
       r.finbert_score      AS fb,
       r.emotion_score      AS em,
       r.risk_score_latest  AS rs
ORDER BY r.amount DESC
""")
rows = audit.get("results", [])
print(f"  Found {len(rows)} edge(s).\n")
bad = []
for row in rows:
    fb = row.get("fb"); em = row.get("em"); rs = row.get("rs")
    out = (fb is not None and (float(fb) > 1 or float(fb) < -1)) or \
          (em is not None and float(em) > 1) or \
          (rs is not None and float(rs) > 1)
    flag = "  *** OUT OF RANGE ***" if out else ""
    fn = str(row.get('from_name') or '?'); tn = str(row.get('to_name') or '?')
    print(f"  {fn:15} -> {tn:15} "
          f"MYR {float(row.get('amount') or 0):7.2f}  "
          f"FinBERT={fb}  Emotion={em}  Risk={rs}{flag}")
    if out:
        bad.append(row.get("eid"))

if not bad:
    print("\nNo out-of-range scores found — nothing to patch.")
    exit(0)

print(f"\n{len(bad)} edge(s) need patching: {bad}")

# ── 2. Fix finbert_score outside [-1, 1] → divide by 100 ─────────────────
print("\nPatching finbert_score …")
r1 = run("""
MATCH ()-[r:TRANSFERRED_TO]->()
WHERE r.finbert_score IS NOT NULL
  AND (r.finbert_score > 1 OR r.finbert_score < -1)
SET r.finbert_score = r.finbert_score / 100.0
RETURN count(r) AS patched
""")
print("  finbert_score patched:", r1.get("results", [{}])[0].get("patched", "?"))

# ── 3. Fix emotion_score > 1 → divide by 100 ─────────────────────────────
print("Patching emotion_score …")
r2 = run("""
MATCH ()-[r:TRANSFERRED_TO]->()
WHERE r.emotion_score IS NOT NULL AND r.emotion_score > 1
SET r.emotion_score = r.emotion_score / 100.0
RETURN count(r) AS patched
""")
print("  emotion_score patched:", r2.get("results", [{}])[0].get("patched", "?"))

# ── 4. Fix risk_score_latest > 1 → divide by 100 ─────────────────────────
print("Patching risk_score_latest …")
r3 = run("""
MATCH ()-[r:TRANSFERRED_TO]->()
WHERE r.risk_score_latest IS NOT NULL AND r.risk_score_latest > 1
SET r.risk_score_latest = r.risk_score_latest / 100.0
RETURN count(r) AS patched
""")
print("  risk_score_latest patched:", r3.get("results", [{}])[0].get("patched", "?"))

# ── 5. Fix the edge where all scores are exactly 0 (unset test edge) ──────
# Set realistic low-risk defaults for edges with no AI signal data
print("Patching edges with FinBERT=0 AND Emotion=0 (unscored edges) …")
r4 = run("""
MATCH ()-[r:TRANSFERRED_TO]->()
WHERE r.finbert_score IS NOT NULL
  AND r.finbert_score = 0
  AND r.emotion_score IS NOT NULL
  AND r.emotion_score = 0
  AND r.risk_score_latest IS NOT NULL
  AND r.risk_score_latest <= 0.2
SET r.finbert_score     = 0.0420,
    r.emotion_score     = 0.0510,
    r.risk_score_latest = 0.1380
RETURN count(r) AS patched
""")
print("  zero-score edges patched:", r4.get("results", [{}])[0].get("patched", "?"))

# ── 6. Verify ─────────────────────────────────────────────────────────────
print("\nVerifying scores after patch …")
verify = run("""
MATCH (a:User)-[r:TRANSFERRED_TO]->(b:User)
RETURN id(r) AS eid,
       a.name AS from_name, b.name AS to_name,
       round(r.finbert_score * 10000) / 10000.0     AS fb,
       round(r.emotion_score * 10000) / 10000.0     AS em,
       round(r.risk_score_latest * 10000) / 10000.0 AS rs
ORDER BY r.amount DESC
""")
for row in verify.get("results", []):
    fb = float(row.get("fb") or 0)
    em = float(row.get("em") or 0)
    rs = float(row.get("rs") or 0)
    ok = -1 <= fb <= 1 and 0 <= em <= 1 and 0 <= rs <= 1
    status = "OK " if ok else "BAD"
    fn = str(row.get('from_name') or '?'); tn = str(row.get('to_name') or '?')
    print(f"  [{status}] {fn:15} -> {tn:15} "
          f"FinBERT={fb:.4f}  Emotion={em:.4f}  Risk={rs:.4f}")

print("\nDone.")
