"""Reference implementations for the DexDiffusion differential parity lab.

Each function below is a VERBATIM excerpt of AUTOMATIC1111/stable-diffusion-webui at the pinned commit
82a973c04367123ae98bd9abdf80d9eda9b910e2 (AGPL-3.0, (c) AUTOMATIC1111 and contributors), reduced only by
removing branches that need the webui runtime (upscaler models, shared.opts, styles). The removed branches are
named in each docstring. Line numbers refer to the pinned files. Do not "fix" these: they are the oracle.
"""
import json
import re

from PIL import Image

LANCZOS = Image.LANCZOS
opt_f = 8


def resize_image(resize_mode, im, width, height):
    """modules/images.py L252-326. Removed: model-upscaler branch of the inner resize() (upscaler_name None path kept)."""

    def resize(im, w, h):
        return im.resize((w, h), resample=LANCZOS)

    if resize_mode == 0:
        res = resize(im, width, height)

    elif resize_mode == 1:
        ratio = width / height
        src_ratio = im.width / im.height

        src_w = width if ratio > src_ratio else im.width * height // im.height
        src_h = height if ratio <= src_ratio else im.height * width // im.width

        resized = resize(im, src_w, src_h)
        res = Image.new("RGB", (width, height))
        res.paste(resized, box=(width // 2 - src_w // 2, height // 2 - src_h // 2))

    else:
        ratio = width / height
        src_ratio = im.width / im.height

        src_w = width if ratio < src_ratio else im.width * height // im.height
        src_h = height if ratio >= src_ratio else im.height * width // im.width

        resized = resize(im, src_w, src_h)
        res = Image.new("RGB", (width, height))
        res.paste(resized, box=(width // 2 - src_w // 2, height // 2 - src_h // 2))

        if ratio < src_ratio:
            fill_height = height // 2 - src_h // 2
            if fill_height > 0:
                res.paste(resized.resize((width, fill_height), box=(0, 0, width, 0)), box=(0, 0))
                res.paste(resized.resize((width, fill_height), box=(0, resized.height, width, resized.height)), box=(0, fill_height + src_h))
        elif ratio > src_ratio:
            fill_width = width // 2 - src_w // 2
            if fill_width > 0:
                res.paste(resized.resize((fill_width, height), box=(0, 0, 0, height)), box=(0, 0))
                res.paste(resized.resize((fill_width, height), box=(resized.width, 0, resized.width, height)), box=(fill_width + src_w, 0))

    return res


def calculate_target_resolution(width, height, hr_scale, hr_resize_x, hr_resize_y):
    """modules/processing.py L1213-1250 (StableDiffusionProcessingTxt2Img). Removed: use_old_hires_fix_width_height.
    Returns (hr_upscale_to_x, hr_upscale_to_y, truncate_x, truncate_y)."""
    truncate_x = truncate_y = 0
    if hr_resize_x == 0 and hr_resize_y == 0:
        hr_upscale_to_x = int(width * hr_scale)
        hr_upscale_to_y = int(height * hr_scale)
    else:
        if hr_resize_y == 0:
            hr_upscale_to_x = hr_resize_x
            hr_upscale_to_y = hr_resize_x * height // width
        elif hr_resize_x == 0:
            hr_upscale_to_x = hr_resize_y * width // height
            hr_upscale_to_y = hr_resize_y
        else:
            target_w = hr_resize_x
            target_h = hr_resize_y
            src_ratio = width / height
            dst_ratio = hr_resize_x / hr_resize_y

            if src_ratio < dst_ratio:
                hr_upscale_to_x = hr_resize_x
                hr_upscale_to_y = hr_resize_x * height // width
            else:
                hr_upscale_to_x = hr_resize_y * width // height
                hr_upscale_to_y = hr_resize_y

            truncate_x = (hr_upscale_to_x - target_w) // opt_f
            truncate_y = (hr_upscale_to_y - target_h) // opt_f
    return hr_upscale_to_x, hr_upscale_to_y, truncate_x, truncate_y


def hires_latent_crop(upscale_x, upscale_y, truncate_x, truncate_y):
    """modules/processing.py L1427: samples[:, :, ty//2 : H-(ty+1)//2, tx//2 : W-(tx+1)//2], in pixels (x8).
    Returns the pixel crop box (x, y, w, h) of the upscaled image that survives."""
    W, H = upscale_x // opt_f, upscale_y // opt_f
    x0, y0 = truncate_x // 2, truncate_y // 2
    x1, y1 = W - (truncate_x + 1) // 2, H - (truncate_y + 1) // 2
    return x0 * opt_f, y0 * opt_f, (x1 - x0) * opt_f, (y1 - y0) * opt_f


re_param_code = r'\s*(\w[\w \-/]+):\s*("(?:\\.|[^\\"])+"|[^,]*)(?:,|$)'
re_param = re.compile(re_param_code)
re_imagesize = re.compile(r"^(\d+)x(\d+)$")


def unquote(text):
    """modules/infotext_utils.py unquote()."""
    if len(text) == 0 or text[0] != '"' or text[-1] != '"':
        return text

    try:
        return json.loads(text)
    except Exception:
        return text


def parse_generation_parameters_core(x):
    """modules/infotext_utils.py parse_generation_parameters(): the prompt/negative split and key-value parse. Removed: style extraction and the default-filling that follows (L270+)."""
    res = {}

    prompt = ""
    negative_prompt = ""

    done_with_prompt = False

    *lines, lastline = x.strip().split("\n")
    if len(re_param.findall(lastline)) < 3:
        lines.append(lastline)
        lastline = ''

    for line in lines:
        line = line.strip()
        if line.startswith("Negative prompt:"):
            done_with_prompt = True
            line = line[16:].strip()
        if done_with_prompt:
            negative_prompt += ("" if negative_prompt == "" else "\n") + line
        else:
            prompt += ("" if prompt == "" else "\n") + line

    for k, v in re_param.findall(lastline):
        try:
            if v[0] == '"' and v[-1] == '"':
                v = unquote(v)

            m = re_imagesize.match(v)
            if m is not None:
                res[f"{k}-1"] = m.group(1)
                res[f"{k}-2"] = m.group(2)
            else:
                res[k] = v
        except Exception:
            print(f"Error parsing \"{k}: {v}\"")

    res["Prompt"] = prompt
    res["Negative prompt"] = negative_prompt
    return res


re_attention = re.compile(r"""
\\\(|
\\\)|
\\\[|
\\]|
\\\\|
\\|
\(|
\[|
:\s*([+-]?[.\d]+)\s*\)|
\)|
]|
[^\\()\[\]:]+|
:
""", re.X)

re_break = re.compile(r"\s*\bBREAK\b\s*", re.S)


def parse_prompt_attention(text):
    """modules/prompt_parser.py parse_prompt_attention() (verbatim body)."""
    res = []
    round_brackets = []
    square_brackets = []

    round_bracket_multiplier = 1.1
    square_bracket_multiplier = 1 / 1.1

    def multiply_range(start_position, multiplier):
        for p in range(start_position, len(res)):
            res[p][1] *= multiplier

    for m in re_attention.finditer(text):
        text = m.group(0)
        weight = m.group(1)

        if text.startswith('\\'):
            res.append([text[1:], 1.0])
        elif text == '(':
            round_brackets.append(len(res))
        elif text == '[':
            square_brackets.append(len(res))
        elif weight is not None and round_brackets:
            multiply_range(round_brackets.pop(), float(weight))
        elif text == ')' and round_brackets:
            multiply_range(round_brackets.pop(), round_bracket_multiplier)
        elif text == ']' and square_brackets:
            multiply_range(square_brackets.pop(), square_bracket_multiplier)
        else:
            parts = re.split(re_break, text)
            for i, part in enumerate(parts):
                if i > 0:
                    res.append(["BREAK", -1])
                res.append([part, 1.0])

    for pos in round_brackets:
        multiply_range(pos, round_bracket_multiplier)

    for pos in square_brackets:
        multiply_range(pos, square_bracket_multiplier)

    if len(res) == 0:
        res = [["", 1.0]]

    # merge runs of identical weights
    i = 0
    while i + 1 < len(res):
        if res[i][1] == res[i + 1][1]:
            res[i][0] += res[i + 1][0]
            res.pop(i + 1)
        else:
            i += 1

    return res
