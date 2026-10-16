#!/usr/bin/env python3
"""Read-only safetensors header inspection (P11): architecture, kind, dtype, embedded VAE and kohya metadata from the
header alone (never the tensor data). Usage: safetensors-inspect.py <file> [<file> ...]   -> one JSON object per line.
Runs locally or on Big Mac (piped over ssh); only the standard library is used."""
import json, os, struct, sys

MAX_HEADER = 64 * 1024 * 1024
TAGS_TOP = 12


def read_header(path):
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        raw = f.read(8)
        if len(raw) < 8:
            raise ValueError('file shorter than the 8-byte header length')
        n = struct.unpack('<Q', raw)[0]
        if n < 2 or n > MAX_HEADER or 8 + n > size:
            raise ValueError(f'implausible header length {n}')
        header = json.loads(f.read(n).decode('utf8'))
    return size, n, header


def classify(keys, hdr):
    ks = list(keys)
    has = lambda pre: any(k.startswith(pre) for k in ks)
    contains = lambda s: any(s in k for k in ks)
    meta = hdr.get('__metadata__') or {}
    shape = lambda k: (hdr.get(k) or {}).get('shape')
    kind, arch = 'unknown', 'unknown'
    if contains('lora_down') or contains('lora_up') or contains('.lora_A.') or contains('.lora_B.') or has('lora_unet_') or has('lora_te'):
        kind = 'lora'
        if has('lora_te2_') or contains('text_encoder_2') or contains('lora_unet_output_blocks_') and has('lora_te1_'):
            arch = 'sdxl'
        elif has('lora_te_') or has('lora_unet_'):
            # SD1.x/2.x kohya naming; the SDXL naming always carries te1/te2.
            arch = 'sd1x'
        if contains('double_blocks') or contains('single_blocks') or contains('transformer_blocks') and not has('lora_unet_'):
            arch = 'flux' if (contains('double_blocks') or contains('single_blocks')) else arch
    elif 'emb_params' in hdr or ('clip_l' in hdr and 'clip_g' in hdr) or 'string_to_param' in hdr:
        kind = 'embedding'
        if 'clip_l' in hdr and 'clip_g' in hdr:
            arch = 'sdxl'
        elif 'emb_params' in hdr:
            d = (shape('emb_params') or [0])[-1]
            arch = {768: 'sd15', 1024: 'sd2'}.get(d, 'unknown')
    elif has('conditioner.embedders.1.') or has('conditioner.embedders.0.'):
        kind = 'checkpoint'
        arch = 'sdxl' if has('conditioner.embedders.1.') else 'sdxl_refiner'
        if has('conditioner.embedders.0.') and not has('conditioner.embedders.1.') and contains('conditioner.embedders.0.model'):
            arch = 'sdxl_refiner'
    elif has('cond_stage_model.'):
        kind = 'checkpoint'
        arch = 'sd2' if has('cond_stage_model.model.') else 'sd15'
    elif has('double_blocks.') or has('model.diffusion_model.double_blocks.') or contains('single_blocks.'):
        kind = 'checkpoint'
        arch = 'flux'
    elif has('first_stage_model.') and not has('model.diffusion_model.'):
        kind = 'vae'
        arch = 'unknown'
    elif has('decoder.') and has('encoder.') and not has('model.'):
        kind = 'vae'
    return kind, arch


def inspect(path):
    size, n, hdr = read_header(path)
    meta = hdr.pop('__metadata__', None) or {}
    tensors = {k: v for k, v in hdr.items() if isinstance(v, dict) and 'dtype' in v}
    # data_offsets must fit inside the file, else it is truncated
    end = max((v['data_offsets'][1] for v in tensors.values()), default=0)
    truncated = 8 + n + end > size
    dtypes, params = {}, 0
    for v in tensors.values():
        dtypes[v['dtype']] = dtypes.get(v['dtype'], 0) + 1
        p = 1
        for d in v.get('shape', []):
            p *= d
        params += p
    kind, arch = classify(tensors.keys(), dict(tensors, __metadata__=meta))
    out = {
        'path': path, 'bytes': size, 'header_bytes': n, 'tensor_count': len(tensors), 'dtypes': dtypes, 'parameters': params,
        'truncated': truncated, 'kind': kind, 'arch': arch,
        'embedded_vae': any(k.startswith('first_stage_model.') for k in tensors),
    }
    hint = meta.get('ss_base_model_version') or meta.get('modelspec.architecture')
    if hint:
        out['metadata_base_hint'] = str(hint)[:80]
        h = str(hint).lower()
        hinted = 'sdxl' if 'xl' in h else ('sd15' if h.startswith('sd_v1') or 'v1' in h else None)
        if hinted and out['arch'] not in ('unknown', hinted, 'sd1x'):
            out['hint_disagrees'] = True
    # kohya tag frequency -> likely trigger words (most frequent tags across datasets)
    try:
        freq = json.loads(meta.get('ss_tag_frequency') or '{}')
        agg = {}
        for ds in freq.values():
            for t, c in ds.items():
                agg[t] = agg.get(t, 0) + int(c)
        out['trigger_candidates'] = [t for t, _ in sorted(agg.items(), key=lambda x: -x[1])[:TAGS_TOP]]
    except Exception:
        pass
    for k in ('modelspec.title', 'ss_output_name', 'ss_network_dim', 'ss_network_alpha'):
        if k in meta:
            out.setdefault('metadata', {})[k] = str(meta[k])[:120]
    return out


if __name__ == '__main__':
    for p in sys.argv[1:]:
        try:
            print(json.dumps(inspect(p)))
        except Exception as e:
            print(json.dumps({'path': p, 'error': str(e)[:200]}))
