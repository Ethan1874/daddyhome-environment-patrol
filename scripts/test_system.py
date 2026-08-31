#!/usr/bin/env python3
"""Safe local regression tests. This module never writes to DingTalk."""

import base64
import tempfile
import time
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server


class PatrolSecurityTests(unittest.TestCase):
    def setUp(self):
        self.original_session_secret = server.PATROL_SESSION_SECRET
        server.PATROL_SESSION_SECRET = "test-only-session-secret-with-sufficient-entropy"

    def tearDown(self):
        server.PATROL_SESSION_SECRET = self.original_session_secret

    def test_area_and_staff_sources_load(self):
        areas = server.load_areas_config().get("areas", [])
        staff = server.load_staff_list()
        self.assertEqual(len(areas), 9)
        self.assertEqual(len(staff), 48)

    def test_signed_session_round_trip_and_tamper_rejection(self):
        user = {"userid": "teacher-1", "name": "测试老师", "title": "教师"}
        session = server.issue_teacher_session(user)
        verified = server.verify_teacher_session(session["token"])
        self.assertEqual(verified["userid"], "teacher-1")
        self.assertEqual(verified["name"], "测试老师")

        payload, signature = session["token"].split(".", 1)
        tampered = ("A" if payload[0] != "A" else "B") + payload[1:] + "." + signature
        self.assertIsNone(server.verify_teacher_session(tampered))

    def test_expired_session_is_rejected(self):
        session = server.issue_teacher_session({"userid": "teacher-1", "name": "测试"}, expires_in_days=-1)
        self.assertLess(session["expiresAt"], int(time.time() * 1000))
        self.assertIsNone(server.verify_teacher_session(session["token"]))

    def test_malformed_session_is_rejected_without_error(self):
        for token in ("not-a-token", "a.@@@", "a." + ("A" * 8000)):
            self.assertIsNone(server.verify_teacher_session(token))

    def test_weak_session_secret_is_rejected(self):
        server.PATROL_SESSION_SECRET = "too-short"
        with self.assertRaises(RuntimeError):
            server.issue_teacher_session({"userid": "teacher-1"})
        self.assertIsNone(server.verify_teacher_session("anything"))

    def test_image_validation_and_size_limit(self):
        original_uploads_dir = server.UPLOADS_DIR
        with tempfile.TemporaryDirectory() as temporary_directory:
            server.UPLOADS_DIR = Path(temporary_directory)
            tiny_jpeg = b"\xff\xd8\xff\xe0" + b"test-image"
            data_url = "data:image/jpeg;base64," + base64.b64encode(tiny_jpeg).decode("ascii")
            reference = server.save_base64_image(data_url)
            self.assertTrue(reference.startswith("/uploads/patrol_"))
            self.assertEqual(len(list(Path(temporary_directory).iterdir())), 1)

            with self.assertRaises(ValueError):
                server.save_base64_image("data:image/png;base64," + base64.b64encode(tiny_jpeg).decode("ascii"))
            with self.assertRaises(ValueError):
                server.save_base64_image("data:text/plain;base64,dGVzdA==")
        server.UPLOADS_DIR = original_uploads_dir

    def test_source_has_no_insecure_ssl_or_cross_project_env_fallback(self):
        source = (ROOT / "server.py").read_text(encoding="utf-8")
        self.assertNotIn("_create_unverified_context", source)
        self.assertNotIn("Documents/Codex/", source)
        self.assertEqual(server.UPLOADS_DIR, ROOT / ".local-uploads")
        self.assertFalse((ROOT / "public" / "uploads").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
