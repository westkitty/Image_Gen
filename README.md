# Image_Gen — DexDiffusion

**Start here: [DEXDIFFUSION.md](DEXDIFFUSION.md)**. It is the operator guide: how to open
DexDiffusion (Dock app / URLs), the architecture, the primary model, where images go,
start/stop/status, troubleshooting and protected invariants.

- Open: click **DexDiffusion** in the Dock, or http://127.0.0.1:31337/dexdiffusion/
  (tailnet: https://macbook-air.tailafb7e8.ts.net:8443/dexdiffusion/)
- Control: `bin/dexdiffusion start | stop | restart | status`
- Primary engine: FLUX.2 Klein 4B (`mlx-community/flux2-klein-4b-4bit`) via MFLUX on Big Mac (`ssh westcat`)
- Secondary: stable-diffusion.cpp `7f0e728` (SD1.5 txt2img/img2img/inpaint/hires, Real-ESRGAN); live capability status: System → Truth status or `bin/dexdiffusion status`
- Images: `/Users/andrew/images_made` (only durable copy; Big Mac keeps none)
- Mac app: `/Applications/DexDiffusion.app`, rebuilt/repaired by `scripts/install-macos-app.sh`
- Evidence and history: [OPERATIONAL_STATE.md](OPERATIONAL_STATE.md); long-form project log: [Image_Gen_Bible.md](Image_Gen_Bible.md)
