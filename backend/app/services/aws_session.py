import os
from collections.abc import Iterator
from contextlib import contextmanager

import boto3
from botocore.exceptions import ProfileNotFound


@contextmanager
def _without_profile_env() -> Iterator[None]:
    saved = {
        "AWS_PROFILE": os.environ.pop("AWS_PROFILE", None),
        "AWS_DEFAULT_PROFILE": os.environ.pop("AWS_DEFAULT_PROFILE", None),
    }
    try:
        yield
    finally:
        for key, value in saved.items():
            if value is not None:
                os.environ[key] = value


def build_boto3_session(region: str, profile: str | None = None) -> boto3.Session:
    profile_name = (profile or "").strip() or None
    if profile_name:
        try:
            return boto3.Session(profile_name=profile_name, region_name=region)
        except ProfileNotFound:
            pass

    # If the configured profile is missing, do not let an inherited AWS_PROFILE
    # make the fallback session fail the same way.
    with _without_profile_env():
        return boto3.Session(region_name=region)
