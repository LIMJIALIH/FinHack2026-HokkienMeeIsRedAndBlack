"""
Run once to create the DynamoDB table and GSI needed by main.py.

Usage:
    uv run python setup_dynamodb.py

Requires AWS credentials in backend/.env (or environment):
    AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY
    AWS_SESSION_TOKEN   (only if using temporary/SSO credentials)
    AWS_REGION          (defaults to ap-southeast-1)
    DYNAMO_TABLE        (defaults to tng_guardian_users)
"""

import os
import sys
import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()

REGION      = os.getenv("AWS_REGION", "ap-southeast-1")
TABLE_NAME  = os.getenv("DYNAMO_TABLE", "tng_guardian_users")

client = boto3.client(
    "dynamodb",
    region_name=REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    aws_session_token=os.getenv("AWS_SESSION_TOKEN") or None,
)

def table_exists() -> bool:
    try:
        client.describe_table(TableName=TABLE_NAME)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceNotFoundException":
            return False
        raise

def create_table():
    print(f"Creating DynamoDB table '{TABLE_NAME}' in {REGION}…")
    client.create_table(
        TableName=TABLE_NAME,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "user_id", "AttributeType": "S"},
            {"AttributeName": "gmail",   "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "user_id", "KeyType": "HASH"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "gmail-index",
                "KeySchema": [{"AttributeName": "gmail", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
    )

    # Wait until table is active
    waiter = client.get_waiter("table_exists")
    waiter.wait(TableName=TABLE_NAME, WaiterConfig={"Delay": 3, "MaxAttempts": 20})
    print(f"Table '{TABLE_NAME}' is ACTIVE.")
    print(f"GSI 'gmail-index' created for fast email lookup.")

def main():
    if not os.getenv("AWS_ACCESS_KEY_ID"):
        print("ERROR: AWS_ACCESS_KEY_ID not set. Add it to backend/.env and retry.")
        sys.exit(1)

    if table_exists():
        print(f"Table '{TABLE_NAME}' already exists — nothing to do.")
        return

    create_table()
    print("\nSetup complete. Add these to backend/.env if not already there:")
    print(f"  AWS_REGION={REGION}")
    print(f"  DYNAMO_TABLE={TABLE_NAME}")

if __name__ == "__main__":
    main()
