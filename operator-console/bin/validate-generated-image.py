#!/usr/bin/env python3
"""Reject undecodable or exactly solid-color generated frames (numerical/decode failure)."""
import sys
from PIL import Image

try:
    with Image.open(sys.argv[1]) as image:
        image.load()
        extrema = image.convert('RGB').getextrema()
        if all(low == high for low, high in extrema):
            raise ValueError('generated image is an exactly solid color; possible numerical or VAE decode failure')
except Exception as error:
    print(f'output-content: {error}', file=sys.stderr)
    sys.exit(1)
