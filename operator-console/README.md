# Operator Console

A minimal, secure UI layer for the BigMac SDCPP Image Generation workflow.

## Launching the UI

```sh
cd /Users/andrew/Image_Gen/operator-console
npm install
node server.js
```

Then open `http://127.0.0.1:31337/` in your browser.

## Architecture

- **Frontend**: Vanilla HTML/JS/CSS. Fast, strictly visual, zero framework overhead.
- **Backend Bridge**: Express server binding *only* to localhost.

The UI cannot execute arbitrary commands. It uses a strict allowlist of backend endpoints (like `/api/actions/generate-fast`) which safely proxy arguments to the approved bash scripts.
