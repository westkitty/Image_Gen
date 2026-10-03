#!/usr/bin/env python3
"""Stream redactor for sd-cli verbose logs (stdin -> stdout).

    redact_stream.py <prompt> <negative_prompt>

sd-cli -v echoes the prompt in several places: the parameter dump, 'parse ... to [[...]]', 'split prompt "..." to tokens [...]'
and the BPE token array that reconstructs it. A multi-line prompt is echoed across several physical lines, so replacing the
whole prompt string in one line never matches. This filter therefore redacts, per segment: the whole text, its
<lora:...>-stripped form, its whitespace-collapsed form and every individual line of a multi-line text, then neutralises the
token array. It reads in raw chunks and splits on \\r as well as \\n so sd-cli progress updates still arrive live.
"""
import os
import re
import sys

MIN_PIECE = 4   # shorter pieces carry no meaning and would mangle unrelated log text


def forms(secret):
    """Patterns (longest first) that match the secret however sd-cli re-spaces it."""
    if not secret:
        return []
    out = {secret, re.sub(r'<lora:[^>]*>', '', secret).strip()}
    for f in list(out):
        if '\n' in f:
            for piece in f.split('\n'):
                piece = piece.strip()
                if len(piece) >= MIN_PIECE:
                    out.add(piece)
    pats = []
    for f in sorted((x for x in out if x.strip()), key=len, reverse=True):
        words = f.split()
        if words:
            pats.append(re.compile(r'\s+'.join(re.escape(w) for w in words)))   # whitespace-insensitive
    return pats


def segments(fd=0):
    buf = b''
    while True:
        chunk = os.read(fd, 4096)
        if not chunk:
            break
        buf += chunk
        while True:
            m = re.search(rb'[\r\n]', buf)
            if not m:
                break
            yield buf[:m.end()].decode('utf-8', 'replace')
            buf = buf[m.end():]
    if buf:
        yield buf.decode('utf-8', 'replace')


def main(argv):
    secrets = forms(argv[1] if len(argv) > 1 else '') + forms(argv[2] if len(argv) > 2 else '')
    tok_re = re.compile(r'(to tokens\s*)\[.*\]')
    for line in segments():
        for pat in secrets:
            line = pat.sub('[REDACTED]', line)
        if 'to tokens' in line or 'bpe_tokenizer' in line:
            line = tok_re.sub(r'\1[REDACTED]', line)
        sys.stdout.write(line)
        sys.stdout.flush()


if __name__ == '__main__':
    main(sys.argv)
