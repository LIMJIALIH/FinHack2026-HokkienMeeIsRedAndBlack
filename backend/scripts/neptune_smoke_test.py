import json
import os
import sys
from pathlib import Path
from urllib import error, request

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest


def _load_simple_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def main() -> int:
    repo_backend = Path(__file__).resolve().parents[1]
    _load_simple_env(repo_backend / ".env")

    endpoint = os.getenv("NEPTUNE_ENDPOINT", "").strip()
    region = os.getenv("AWS_REGION", "ap-southeast-1").strip()
    profile = os.getenv("AWS_PROFILE", "").strip()
    if not endpoint:
        print("Missing NEPTUNE_ENDPOINT. Example:")
        print("NEPTUNE_ENDPOINT=db-neptune-1-instance-1.cjugq6yyw4j8.ap-southeast-1.neptune.amazonaws.com")
        return 2

    url = f"https://{endpoint}:8182/openCypher"
    payload = {"query": "RETURN 1 AS ok"}
    body = json.dumps(payload)

    session = boto3.Session(profile_name=profile or None, region_name=region)
    credentials = session.get_credentials()
    if credentials is None:
        print("No AWS credentials found. Set AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.")
        return 2
    frozen = credentials.get_frozen_credentials()

    aws_req = AWSRequest(
        url=url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    SigV4Auth(frozen, "neptune-db", region).add_auth(aws_req)
    signed_headers = dict(aws_req.headers.items())

    req = request.Request(
        url=url,
        data=body.encode("utf-8"),
        headers=signed_headers,
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=8) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            print(f"HTTP {resp.status}")
            print(body)
            return 0
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP {exc.code}")
        print(body)
        if exc.code in (401, 403):
            print(
                "Auth/access issue. Check IAM DB auth, VPC security group, and whether your client can reach the Neptune VPC."
            )
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"Connection error: {exc}")
        print("Check endpoint, VPC reachability, and security-group inbound rule for port 8182.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
