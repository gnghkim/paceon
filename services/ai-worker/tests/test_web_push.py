"""Web Push encryption and VAPID signing, checked against RFC 8291's worked example.

The encrypted body is verified by decrypting it with the user agent key from the RFC,
so a wrong key schedule cannot pass. Copying an expected ciphertext by hand would only
prove the copy matched.
"""

import base64
import json
import unittest

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.web_push import (
    RECORD_SIZE,
    b64url_decode,
    b64url_encode,
    encrypt,
    origin_of,
    vapid_headers,
    _hkdf,
)

# RFC 8291 §5. The user agent keys, the server's ephemeral key and the salt are fixed
# so the whole exchange is reproducible.
PLAINTEXT = b"When I grow up, I want to be a watermelon"
UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
SERVER_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
SALT = "DGv6ra1nlYgDCS1FRnbzlw"


def server_key():
    return ec.derive_private_key(int.from_bytes(b64url_decode(SERVER_PRIVATE), "big"), ec.SECP256R1())


def decrypt(body: bytes, ua_private_b64: str, auth_b64: str) -> bytes:
    """Undo encrypt() the way a browser would, from the body alone."""
    salt, rest = body[:16], body[16:]
    record_size = int.from_bytes(rest[:4], "big")
    key_length = rest[4]
    server_public_bytes = rest[5 : 5 + key_length]
    ciphertext = rest[5 + key_length :]

    ua_private = ec.derive_private_key(int.from_bytes(b64url_decode(ua_private_b64), "big"), ec.SECP256R1())
    ua_public_bytes = ua_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    server_public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), server_public_bytes)
    shared = ua_private.exchange(ec.ECDH(), server_public)

    ikm = _hkdf(b64url_decode(auth_b64), shared, b"WebPush: info\x00" + ua_public_bytes + server_public_bytes, 32)
    content_key = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plaintext = AESGCM(content_key).decrypt(nonce, ciphertext, None)
    assert record_size == RECORD_SIZE
    assert plaintext[-1] == 0x02, "the last record must carry the 0x02 delimiter"
    return plaintext[:-1]


class WebPushEncryption(unittest.TestCase):
    def test_a_browser_can_read_back_what_we_encrypt(self):
        body = encrypt(PLAINTEXT, UA_PUBLIC, AUTH, salt=b64url_decode(SALT), server_private=server_key())
        self.assertEqual(decrypt(body, UA_PRIVATE, AUTH), PLAINTEXT)

    def test_the_header_carries_the_salt_record_size_and_our_public_key(self):
        body = encrypt(PLAINTEXT, UA_PUBLIC, AUTH, salt=b64url_decode(SALT), server_private=server_key())
        self.assertEqual(body[:16], b64url_decode(SALT))
        self.assertEqual(int.from_bytes(body[16:20], "big"), RECORD_SIZE)
        self.assertEqual(body[20], 65)
        expected_public = server_key().public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        self.assertEqual(body[21:86], expected_public)

    def test_every_message_gets_a_fresh_salt_and_key(self):
        first = encrypt(PLAINTEXT, UA_PUBLIC, AUTH)
        second = encrypt(PLAINTEXT, UA_PUBLIC, AUTH)
        self.assertNotEqual(first[:16], second[:16], "salt must not repeat")
        self.assertNotEqual(first[21:86], second[21:86], "the ephemeral key must not repeat")
        self.assertEqual(decrypt(first, UA_PRIVATE, AUTH), PLAINTEXT)
        self.assertEqual(decrypt(second, UA_PRIVATE, AUTH), PLAINTEXT)

    def test_a_korean_line_survives_the_round_trip(self):
        line = "오늘 20쪽 · 영어 10분".encode("utf-8")
        body = encrypt(line, UA_PUBLIC, AUTH)
        self.assertEqual(decrypt(body, UA_PRIVATE, AUTH), line)

    def test_malformed_subscription_keys_are_refused(self):
        for p256dh, auth in [
            ("", AUTH),
            (b64url_encode(b"\x04" + b"\x00" * 63), AUTH),  # one byte short
            (b64url_encode(b"\x03" + b"\x00" * 64), AUTH),  # compressed point
            (UA_PUBLIC, b64url_encode(b"\x00" * 4)),  # auth secret too short
        ]:
            with self.assertRaises(ValueError):
                encrypt(PLAINTEXT, p256dh, auth)

    def test_a_payload_too_long_for_one_record_is_refused(self):
        with self.assertRaises(ValueError):
            encrypt(b"x" * RECORD_SIZE, UA_PUBLIC, AUTH)

    def test_a_wrong_salt_length_is_refused(self):
        with self.assertRaises(ValueError):
            encrypt(PLAINTEXT, UA_PUBLIC, AUTH, salt=b"short")


class Vapid(unittest.TestCase):
    PUBLIC = b64url_encode(
        server_key().public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )

    def headers(self, **kwargs):
        return vapid_headers(
            "https://push.example", "mailto:study@paceon.example", SERVER_PRIVATE, self.PUBLIC, **kwargs
        )

    def test_the_token_is_signed_for_this_origin_and_verifies(self):
        headers = self.headers(now=1_000_000)
        scheme, rest = headers["Authorization"].split(" ", 1)
        self.assertEqual(scheme, "vapid")
        token = rest.split(",")[0].strip()[len("t=") :]
        key = rest.split("k=")[1].strip()
        self.assertEqual(key, self.PUBLIC)

        header_b64, claims_b64, signature_b64 = token.split(".")
        self.assertEqual(json.loads(b64url_decode(header_b64)), {"typ": "JWT", "alg": "ES256"})
        claims = json.loads(b64url_decode(claims_b64))
        self.assertEqual(claims["aud"], "https://push.example")
        self.assertEqual(claims["sub"], "mailto:study@paceon.example")
        self.assertEqual(claims["exp"], 1_000_000 + 12 * 3600)

        raw = b64url_decode(signature_b64)
        self.assertEqual(len(raw), 64, "JWS uses the raw r||s pair, not DER")
        der = utils.encode_dss_signature(
            int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")
        )
        server_key().public_key().verify(
            der, f"{header_b64}.{claims_b64}".encode("ascii"), ec.ECDSA(hashes.SHA256())
        )

    def test_the_content_coding_is_announced(self):
        headers = self.headers()
        self.assertEqual(headers["Content-Encoding"], "aes128gcm")
        self.assertEqual(headers["Content-Type"], "application/octet-stream")

    def test_an_insecure_origin_or_odd_subject_is_refused(self):
        for origin, subject in [
            ("http://push.example", "mailto:a@b.example"),
            ("push.example", "mailto:a@b.example"),
            ("https://push.example", "a@b.example"),
            ("https://push.example", "tel:12345"),
        ]:
            with self.assertRaises(ValueError):
                vapid_headers(origin, subject, SERVER_PRIVATE, self.PUBLIC)

    def test_a_private_key_of_the_wrong_length_is_refused(self):
        with self.assertRaises(ValueError):
            vapid_headers(
                "https://push.example", "mailto:a@b.example", b64url_encode(b"\x00" * 16), self.PUBLIC
            )


class Origin(unittest.TestCase):
    def test_the_audience_is_the_scheme_and_host_only(self):
        self.assertEqual(origin_of("https://fcm.googleapis.com/fcm/send/abc"), "https://fcm.googleapis.com")
        self.assertEqual(origin_of("https://push.example"), "https://push.example")
        self.assertEqual(origin_of("https://push.example:8443/x"), "https://push.example:8443")

    def test_anything_but_a_plain_https_endpoint_is_refused(self):
        for endpoint in ["http://push.example/x", "https:///x", "https://user@push.example/x", "ftp://x"]:
            with self.assertRaises(ValueError):
                origin_of(endpoint)


class Base64Url(unittest.TestCase):
    def test_padding_is_added_on_the_way_in_and_dropped_on_the_way_out(self):
        for raw in [b"", b"a", b"ab", b"abc", b"\xff\xfe\x00"]:
            self.assertEqual(b64url_decode(b64url_encode(raw)), raw)
        self.assertNotIn("=", b64url_encode(b"abcd\x00"))
        self.assertEqual(b64url_decode("-_8"), base64.urlsafe_b64decode("-_8="))


if __name__ == "__main__":
    unittest.main()
