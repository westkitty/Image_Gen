#!/usr/bin/env python3
"""Re-encode an image as PNG / JPEG / WebP into a NEW stream. Never writes to the source.

usage: encode-image.py --src FILE --format png|jpeg|webp [--quality 1-100] [--lossless]
                       [--infotext-stdin] [--out FILE]

With --infotext-stdin the text on stdin is embedded as A1111 metadata:
  PNG       -> iTXt "parameters" chunk
  JPEG/WebP -> EXIF UserComment (UNICODE header + UTF-16BE, as piexif.helper.UserComment.dump(.., "unicode"))
Without it, no source metadata is carried over (text chunks, EXIF, XMP are all dropped; only the ICC profile is kept),
so a source file that happens to hold a prompt cannot leak it through an export.
Output goes to stdout unless --out is given; --out may never be the source file (and is created exclusively).
"""
import argparse
import io
import os
import sys

from PIL import Image, PngImagePlugin

MAX_PIXELS = 200_000_000


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--format", required=True, choices=["png", "jpeg", "webp"])
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--lossless", action="store_true")
    ap.add_argument("--infotext-stdin", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()

    if a.out:
        same = os.path.realpath(a.out) == os.path.realpath(a.src)
        try:
            same = same or (os.path.exists(a.out) and os.path.samefile(a.src, a.out))
        except OSError:
            pass
        if same:
            sys.stderr.write("refusing to write over the source image\n")
            return 2

    text = sys.stdin.buffer.read().decode("utf-8") if a.infotext_stdin else None
    quality = max(1, min(100, a.quality))

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with Image.open(a.src) as im:  # opened read-only
        im.load()
        icc = im.info.get("icc_profile")
        if a.format == "png":
            pnginfo = None
            if text:
                pnginfo = PngImagePlugin.PngInfo()
                pnginfo.add_itxt("parameters", text)
            kw = {}
            if pnginfo is not None:
                kw["pnginfo"] = pnginfo
            if icc:
                kw["icc_profile"] = icc
            out = im
        else:
            if im.mode in ("RGBA", "LA", "P", "PA"):
                out = im.convert("RGBA")
                if a.format == "jpeg":  # flatten alpha onto white; WebP keeps it
                    bg = Image.new("RGB", out.size, (255, 255, 255))
                    bg.paste(out, mask=out.getchannel("A"))
                    out = bg
            elif im.mode == "I;16":
                out = im.point(lambda p: p * 0.0038910505836576).convert("RGB")
            elif im.mode not in ("RGB", "L"):
                out = im.convert("RGB")
            else:
                out = im
            kw = {"quality": quality}
            if a.format == "webp":
                kw["lossless"] = bool(a.lossless)
            if icc:
                kw["icc_profile"] = icc
            if text:
                exif = Image.Exif()
                ifd = exif.get_ifd(0x8769)
                ifd[0x9286] = b"UNICODE\x00" + text.encode("utf-16-be")
                kw["exif"] = exif.tobytes()
        buf = io.BytesIO()
        out.save(buf, format={"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}[a.format], **kw)

    data = buf.getvalue()
    if a.out:
        with open(a.out, "xb") as f:
            f.write(data)
    else:
        sys.stdout.buffer.write(data)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("encode failed: %s\n" % e)
        sys.exit(1)
