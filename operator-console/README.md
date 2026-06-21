# Operator Console

A minimal, secure UI layer for the BigMac SDCPP Image Generation workflow.

## Launching the UI

```sh
cd /Users/andrew/Image_Gen/operator-console
npm install
npm start
```

Then open `http://127.0.0.1:31337/` in your browser.

## Architecture

- **Frontend**: Vanilla HTML/JS/CSS. Fast, strictly visual, zero framework overhead. Uses a premium three-zone desktop layout.
- **Backend Bridge**: Express server binding *only* to localhost.

The UI cannot execute arbitrary commands. It uses a strict allowlist of backend endpoints which safely proxy arguments to the approved bash scripts.

## Prompt Privacy

By default, prompt text will not be written to disk, manifests, localStorage, or logs. 
- Setting "Save prompts in run records" is OFF by default.
- When OFF, Express sets environment variable `SDCPP_REDACT_PROMPTS=1` before spawning generation tasks.
- All reports, manifest JSON, manifest TSV, and per-image records write `[REDACTED]` for prompt values.
- Log streams are redacted on-the-fly in Express memory before displaying.

## Validation

To validate the console's static configuration and API endpoints:

```sh
cd /Users/andrew/Image_Gen/operator-console
npm run check
```
