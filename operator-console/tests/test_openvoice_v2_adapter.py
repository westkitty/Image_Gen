import contextlib
import hashlib
import importlib.util
import io
import json
import math
import pathlib
import struct
import tempfile
import unittest
import wave

DRIVER = pathlib.Path(__file__).parents[1] / "bridges" / "openvoice_v2_remote.py"
SPEC = importlib.util.spec_from_file_location("openvoice_v2_remote", DRIVER)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_wav(path, frequency):
    rate = 24000
    frames = [int(6000 * math.sin(2 * math.pi * frequency * i / rate)) for i in range(rate)]
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b"".join(struct.pack("<h", x) for x in frames))


class OpenVoiceRequestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="openvoice-request-")
        root = pathlib.Path(self.temp.name)
        self.job = root / "job"
        self.job.mkdir()
        (self.job / "out").mkdir()
        self.model = root / "model"
        (self.model / "converter").mkdir(parents=True)
        (self.model / "converter" / "config.json").write_text("{}")
        (self.model / "converter" / "checkpoint.pth").write_bytes(b"synthetic checkpoint")
        write_wav(self.job / "source.wav", 220)
        write_wav(self.job / "target.wav", 330)
        self.request = {
            "source_audio": str(self.job / "source.wav"),
            "target_audio": str(self.job / "target.wav"),
            "out_dir": str(self.job / "out"),
            "model_dir": str(self.model),
            "model_sha256": digest(self.model / "converter" / "checkpoint.pth"),
            "source_wav_sha256": digest(self.job / "source.wav"),
            "target_wav_sha256": digest(self.job / "target.wav"),
        }

    def tearDown(self):
        self.temp.cleanup()

    def rejected(self, request, gate):
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured), self.assertRaises(SystemExit):
            MODULE.validate_request(request, str(self.job))
        self.assertIn("DEXMEDIA_FAIL=" + gate, captured.getvalue())

    def test_valid_request_accepts_distinct_job_owned_wavs_and_verified_checkpoint(self):
        got = MODULE.validate_request(self.request, str(self.job))
        self.assertEqual(got["source_sha"], self.request["source_wav_sha256"])
        self.assertEqual(got["target_sha"], self.request["target_wav_sha256"])
        self.assertEqual(got["model_sha"], self.request["model_sha256"])
        self.assertAlmostEqual(got["src_facts"]["duration"], 1.0)

    def test_same_recording_is_rejected_as_identity_collision(self):
        request = dict(self.request, target_audio=self.request["source_audio"], target_wav_sha256=self.request["source_wav_sha256"])
        self.rejected(request, "identity-separation")

    def test_input_path_escape_is_rejected(self):
        request = dict(self.request, source_audio=str(self.model / "converter" / "config.json"))
        self.rejected(request, "input-scope")

    def test_transferred_hash_mismatch_is_rejected(self):
        request = dict(self.request, target_wav_sha256="0" * 64)
        self.rejected(request, "input-checksum")

    def test_unverified_model_checkpoint_is_rejected(self):
        request = dict(self.request, model_sha256="0" * 64)
        self.rejected(request, "model-checksum")

    def test_non_wav_input_is_rejected(self):
        bad = self.job / "bad.wav"
        bad.write_bytes(b"not a wav file" * 100)
        request = dict(self.request, source_audio=str(bad), source_wav_sha256=digest(bad))
        self.rejected(request, "audio-input")


if __name__ == "__main__":
    unittest.main()
