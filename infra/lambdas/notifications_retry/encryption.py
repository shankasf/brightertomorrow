"""
encryption.py — KMS helpers for the notifications-retry Lambda.

HIPAA note: outbox rows store message payloads as KMS-encrypted blobs
(`payload_ciphertext`, base64-encoded) rather than plaintext columns.
This module handles encrypt/decrypt so handler.py never touches raw PHI.
"""
from __future__ import annotations

import base64
import os
from typing import Any

import boto3

_kms = boto3.client("kms")

# The bt CMK (alias/bt-phi) ARN injected via environment variable at deploy time.
CMK_KEY_ID = os.environ["KMS_KEY_ID"]


def decrypt_payload(ciphertext_b64: str) -> str:
    """Decrypt a base64-encoded KMS ciphertext blob and return the plaintext string."""
    ciphertext = base64.b64decode(ciphertext_b64)
    response = _kms.decrypt(
        CiphertextBlob=ciphertext,
        KeyId=CMK_KEY_ID,
    )
    return response["Plaintext"].decode("utf-8")


def encrypt_payload(plaintext: str) -> str:
    """Encrypt a plaintext string and return a base64-encoded ciphertext blob."""
    response = _kms.encrypt(
        KeyId=CMK_KEY_ID,
        Plaintext=plaintext.encode("utf-8"),
    )
    return base64.b64encode(response["CiphertextBlob"]).decode("utf-8")
