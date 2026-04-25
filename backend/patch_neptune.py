"""
One-time patch: rename full_name → name on existing registered nodes, delete TEST-001.
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
    r = _req.post(url, data=body, headers=dict(req.headers), timeout=10)
    if r.status_code != 200:
        print(f"ERROR {r.status_code}: {r.text[:300]}")
        return {}
    return r.json()

# 1. Copy full_name → name for all nodes that have full_name but not name
print("Patching full_name -> name on existing nodes...")
s = run("""
MATCH (u:User)
WHERE u.full_name IS NOT NULL AND u.name IS NULL
SET u.name = u.full_name
RETURN count(u) AS patched
""")
print("Patched:", s)

# 2. Delete TEST-001 node
print("Deleting TEST-001 node...")
s = run("MATCH (u:User {user_id: $uid}) DETACH DELETE u RETURN count(u) AS deleted",
        {"uid": "TEST-001"})
print("Deleted:", s)

# 3. Verify all nodes now have name
print("\nVerifying all User nodes have 'name':")
s = run("MATCH (u:User) RETURN u.user_id AS uid, u.name AS name, u.risk_tier_current AS tier ORDER BY u.created_at")
for row in s.get("results", []):
    print(f"  {row.get('uid','?')[:20]:22} | name={row.get('name','<MISSING>'):25} | tier={row.get('tier','')}")
