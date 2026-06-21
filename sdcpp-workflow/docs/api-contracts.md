# API Contracts

The workflow talks to `sd-server` through the local tunnel
(`http://127.0.0.1:<LOCAL_TUNNEL_PORT>`, default `17870`). All three contracts
below are proven working against build `7f0e728`.

**Success is always a decoded, verified PNG on the MacBook** (`file` says
`PNG image data`, size > 0). A 200 response, a populated `/v1/models`, or
`/sdcpp/v1/capabilities` is **not** success.

Portable decode: try `base64 --decode`, then `base64 -D`.

---

## OpenAI-compatible (default)
- Endpoint: `POST /v1/images/generations`
- Request:
  ```json
  { "prompt": "a lovely cat", "n": 1, "size": "512x512", "output_format": "png" }
  ```
- Response field: `.data[0].b64_json` (base64 PNG).
- Decode `.data[0].b64_json` → PNG → verify.
- **Steps/cfg/sampler caveat:** this handler reads ONLY `prompt`, `size`, `n`,
  `output_format`. Steps/cfg/sampler otherwise come from the server's defaults.
  To control them, embed an extra-args block in the prompt (the workflow does this
  automatically when you pass `--preset`/`--steps`):
  ```
  <prompt> <sd_cpp_extra_args>{"sample_params":{"sample_steps":8,"sample_method":"euler_a","guidance":{"txt_cfg":7.0}}}</sd_cpp_extra_args>
  ```
  Without it, every OpenAI request runs at the server-default step count.

---

## SD WebUI-compatible
- Endpoint: `POST /sdapi/v1/txt2img`
- Request:
  ```json
  {
    "prompt": "a lovely cat",
    "negative_prompt": "blurry, low quality",
    "width": 512, "height": 512,
    "steps": 1, "cfg_scale": 7.0,
    "sampler_name": "euler_a", "scheduler": "discrete",
    "batch_size": 1
  }
  ```
- Response field: `.images[0]` (base64 PNG).
- Decode `.images[0]` → PNG → verify.

---

## Native async (optional; not required for PASS)
- Submit: `POST /sdcpp/v1/img_gen`
  ```json
  {
    "prompt": "a lovely cat",
    "negative_prompt": "blurry, low quality",
    "width": 512, "height": 512, "seed": 42, "batch_count": 1,
    "sample_params": {
      "scheduler": "discrete", "sample_method": "euler_a",
      "sample_steps": 1, "guidance": { "txt_cfg": 7.0 }
    },
    "output_format": "png"
  }
  ```
  Response (JSON body, after any HTTP headers): `.id`, `.status` (`queued`).
- Poll: `GET /sdcpp/v1/jobs/<id>` until `.status == "completed"` (or `failed`).
  - **Bounded**: at most ~60s (30 polls × 2s). On `failed` or timeout → that path fails (non-fatal overall).
- Result field: `.result.images[0].b64_json` → decode → verify.

---

## Informational (allowed, never counted as success)
- `GET /v1/models` → `{ "data": [ { "id": "sd-cpp-local", ... } ] }`
- `GET /sdcpp/v1/capabilities` → current mode + defaults.

---

## Seed control by endpoint (Phase 2)
- **CLI**: `--seed N` (default 42; `<0` random). Verified deterministic (same seed → identical SHA256).
- **SDAPI**: payload `"seed": N`. Default `-1` (random) if omitted — the workflow sends a seed when controlled.
- **Native**: body top-level `"seed": N` (parsed by `gen_params.from_json_str`).
- **OpenAI**: only via `<sd_cpp_extra_args>{"seed":N,...}</sd_cpp_extra_args>` (the workflow embeds it when a seed is set).
See `seed-batch-controls.md` for the full table and determinism notes.

## PASS criteria (`sdcpp-server-generate.sh`)
- `--api openai` → OpenAI PNG verified.
- `--api sdapi` → SDAPI PNG verified.
- `--api both` → both attempted; PASS if ≥1 verified.
- `--api native` → native PNG verified within the time bound.
- Overall script PASS = at least one requested path produced a verified PNG.
