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
    return r.status_code, r.json()

# Show ALL properties of every User node
print("=== All User nodes (all properties) ===")
s, r = run("MATCH (u:User) RETURN u ORDER BY u.created_at DESC")
print(f"Status: {s}")
for row in r.get("results", []):
    print(json.dumps(row.get("u", {}), indent=2, default=str))
    print("---")
