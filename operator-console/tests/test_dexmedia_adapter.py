import importlib.util
import pathlib
import unittest

DRIVER = pathlib.Path(__file__).parents[1] / "bridges" / "dexmedia_remote.py"
SPEC = importlib.util.spec_from_file_location("dexmedia_remote", DRIVER)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PerItemInstructionTests(unittest.TestCase):
    def test_voice_design_instruction_reaches_model_generate_kwargs_per_item(self):
        req = {"instruct": "A clear low voice", "lang_code": "en"}
        first = MODULE.build_tts_item_kwargs("qwen3-tts-voice-design", {"text": "Hello", "instruct": "Formal and clipped"}, req)
        second = MODULE.build_tts_item_kwargs("qwen3-tts-voice-design", {"text": "Again", "instruct": "Quietly furious"}, req)
        self.assertEqual(first["instruct"], "Formal and clipped")
        self.assertEqual(second["instruct"], "Quietly furious")
        self.assertEqual(first["lang_code"], "en")

    def test_missing_instruction_fails_instead_of_silently_falling_back(self):
        with self.assertRaisesRegex(RuntimeError, "missing its instruction"):
            MODULE.build_tts_item_kwargs("qwen3-tts-voice-design", {"text": "Hello"}, {"lang_code": "en"})

    def test_voxcpm_controlled_clone_arguments_keep_exact_dialogue_and_voice_reference(self):
        dialogue = "I assure you, that is a profoundly stupid proposition."
        kwargs = MODULE.build_voxcpm_item_kwargs(
            {"text": dialogue, "direction": "formal, rapid, dry", "seed": 44},
            {"ref_audio": "/private/job/ref.wav"},
        )
        self.assertEqual(kwargs["text"], f"(formal, rapid, dry){dialogue}")
        self.assertEqual(kwargs["reference_wav_path"], "/private/job/ref.wav")
        self.assertNotIn("seed", kwargs)  # pinned voxcpm 2.0.3 has no seed parameter

    def test_voxcpm_design_prefix_keeps_dialogue_suffix_and_uses_supported_kwargs(self):
        dialogue = "Wait. I heard something outside."
        kwargs = MODULE.build_voxcpm_item_kwargs(
            {"text": dialogue, "direction": "Quiet, wary, then tense."},
            {"profile_type": "designed", "voice_description": "A low, clear, dry voice."},
        )
        self.assertEqual(kwargs["text"], f"(A low, clear, dry voice Delivery: Quiet, wary, then tense.){dialogue}")
        self.assertNotIn("reference_wav_path", kwargs)
        self.assertNotIn("seed", kwargs)


if __name__ == "__main__":
    unittest.main()
