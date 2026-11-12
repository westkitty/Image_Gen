# DexDiffusion: authorized Big Mac recovery and one image library

The only canonical image directory is /Users/andrew/images_made on MacBook. Big Mac uses /Volumes/wc2tb/DexDiffusion for models, jobs and nonimage workflow data when accessible. New external-mode image working copies stage on Big Mac internal /Users/bigmac/DexDiffusion-PublicationStaging, never the external images directory. In fallback they stage in /Users/bigmac/DexDiffusion-InternalFallback/images. Both modes submit pending publications to MacBook.

The MacBook publication worker pulls through its project-owned SSH tunnel, fsyncs, atomically installs the file, verifies bytes and SHA-256, and acknowledges it. Big Mac may release a working copy only after verified MacBook retention; failed/pending outputs remain intact. Older external files are historical, not an independent canonical library. Never delete them without independently checking the MacBook copy.

## On-demand trigger, without screen sharing

Use connected DEX//REACH on node bigmac, workdir /Users/bigmac/Image_Gen:

    scripts/recover-backend-authorized.sh --restore-external

For health-preserving start: scripts/recover-backend-authorized.sh --ensure
For status only: scripts/recover-backend-authorized.sh --status

This requires the existing authorized DEX//REACH execution service; it does not grant, fake or bypass macOS privacy permissions. An independently detached process launched by MacBook SSH was denied external-volume access (EPERM), while DEX//REACH-launched children passed. Generic SSH, LaunchAgents and DEX//REACH are NOT interchangeable permission contexts. The trigger is on-demand, not an unattended startup guarantee. Persistent boot operation would require an OS-authorized signed helper/login item and its user approval.

Recovery guards include machine and repository identity, clean source, listening PID ownership, active-job and compute-lease checks, bounded external-volume probes, no force-kills, no public bind, and post-start API/Studio/revision/storage verification. If startup fails, it attempts a bounded return to the original fallback agent. It does not touch Jellyfin, Ollama, Hermes, Tailscale, DEX//REACH or the disk mount.

## End-to-end definition of done

Big Mac port 31337 reports external or intentionally selected fallback mode, the correct commit, MacBook canonical path, Big Mac internal working path, and working Studio. A real image generates and is copied to /Users/andrew/images_made, SHA-256/bytes verified there, with publication ACK. Any outstanding original is pending rather than canonical. Verify MacBook native app and tunnel when possible. Do not claim those checks passed based on Git or startup success alone.

## Verified live proof

DEX//REACH on-demand external recovery returned SERVICE_READY PID 66012, and a second --ensure returned SERVICE_ALREADY_LOADED. A generated 323036-byte PNG staged on Big Mac internal, not WC2TB, was published to MacBook images_made with matching size/SHA, and acknowledged. WC2TB image directory later contained zero PNGs after the app's verified-publication cleanup. This does not establish unattended startup after a host restart.
