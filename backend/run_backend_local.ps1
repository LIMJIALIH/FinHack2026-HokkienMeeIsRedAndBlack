$env:AWS_PROFILE = "finhack_IsbUsersPS-393886308397"
$env:AWS_REGION = "ap-southeast-1"
$env:NEPTUNE_ENDPOINT = "db-neptune-2.cluster-cjugq6yyw4j8.ap-southeast-1.neptune.amazonaws.com"
$env:AWS_SDK_LOAD_CONFIG = "1"
uv run uvicorn main:app --host 127.0.0.1 --port 8000
