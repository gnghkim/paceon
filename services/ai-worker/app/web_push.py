"""Web Push encryption and VAPID signing.

RFC 8291 (message encryption) and RFC 8292 (VAPID) over the aes128gcm content
coding of RFC 8188. Only the pieces PaceOn sends are here: one record, no padding
beyond the delimiter, and a JWT for the push service.

Nothing from a learner's records reaches this module. The caller passes a short
line it has already composed.
"""

import base64
import json
import os
import time

from cryptography.hazmat.primitives import hashes, hmac, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

#: One record is plenty for a single line, and matches what push services expect.
RECORD_SIZE = 4096


def b64url_decode(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding)


def b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _hmac(key: bytes, message: bytes) -> bytes:
    mac = hmac.HMAC(key, hashes.SHA256())
    mac.update(message)
    return mac.finalize()


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    """One-block HKDF. Every output here is 32 bytes or fewer."""
    if length > 32:
        raise ValueError("length")
    return _hmac(_hmac(salt, ikm), info + b"\x01")[:length]


def encrypt(payload: bytes, p256dh: str, auth: str, *, salt=None, server_private=None) -> bytes:
    """Return the aes128gcm body for one subscription.

    `salt` and `server_private` exist so a test can pin the RFC's example inputs.
    In production both are fresh for every message.
    """
    ua_public_bytes = b64url_decode(p256dh)
    auth_secret = b64url_decode(auth)
    if len(ua_public_bytes) != 65 or ua_public_bytes[0] != 0x04:
        raise ValueError("p256dh")
    if not 8 <= len(auth_secret) <= 32:
        raise ValueError("auth")

    salt = salt if salt is not None else os.urandom(16)
    if len(salt) != 16:
        raise ValueError("salt")
    private = server_private if server_private is not None else ec.generate_private_key(ec.SECP256R1())
    server_public_bytes = private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )

    ua_public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public_bytes)
    shared = private.exchange(ec.ECDH(), ua_public)

    # RFC 8291 §3.4: the user agent key comes first, then ours.
    key_info = b"WebPush: info\x00" + ua_public_bytes + server_public_bytes
    ikm = _hkdf(auth_secret, shared, key_info, 32)
    content_key = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)

    # 0x02 marks the last record. Anything longer than one record is refused rather
    # than silently truncated.
    plaintext = payload + b"\x02"
    if len(plaintext) + 16 > RECORD_SIZE:
        raise ValueError("payload")
    ciphertext = AESGCM(content_key).encrypt(nonce, plaintext, None)

    header = salt + RECORD_SIZE.to_bytes(4, "big") + len(server_public_bytes).to_bytes(1, "big")
    return header + server_public_bytes + ciphertext


def vapid_headers(origin: str, subject: str, private_key_b64: str, public_key_b64: str, *, now=None) -> dict:
    """Authorization header for one push origin, valid for twelve hours."""
    if not origin.startswith("https://"):
        raise ValueError("origin")
    if not (subject.startswith("mailto:") or subject.startswith("https://")):
        raise ValueError("subject")
    issued = int(now if now is not None else time.time())
    header = b64url_encode(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64url_encode(
        json.dumps({"aud": origin, "exp": issued + 12 * 3600, "sub": subject}, separators=(",", ":")).encode()
    )
    signing_input = f"{header}.{claims}".encode("ascii")

    secret = b64url_decode(private_key_b64)
    if len(secret) != 32:
        raise ValueError("private_key")
    private = ec.derive_private_key(int.from_bytes(secret, "big"), ec.SECP256R1())
    der = private.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = utils.decode_dss_signature(der)
    # JWS wants the raw pair, not the DER envelope the library returns.
    signature = b64url_encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return {
        "Authorization": f"vapid t={header}.{claims}.{signature}, k={public_key_b64}",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
    }


def origin_of(endpoint: str) -> str:
    """Scheme and host of the push endpoint, which is the JWT audience."""
    if not endpoint.startswith("https://"):
        raise ValueError("endpoint")
    rest = endpoint[len("https://") :]
    host = rest.split("/", 1)[0]
    if not host or "@" in host:
        raise ValueError("endpoint")
    return "https://" + host
