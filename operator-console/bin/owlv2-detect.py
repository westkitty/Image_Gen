#!/usr/bin/env python3
"""One-shot, offline OWLv2 inference for DexDiffusion. Model files are local-only."""
import argparse
import json
import os
import sys
import time

def choose_detections(detections, target_selection='largest', selected_instances=None):
    values=selected_instances if isinstance(selected_instances,list) else str(selected_instances or '').split(',')
    selected={str(value).strip() for value in values if str(value).strip()}
    if selected:
        return [d for d in detections if d['instance_id'] in selected]
    if target_selection == 'largest' and detections:
        return [max(detections,key=lambda d:(d['box_pixels'][2]-d['box_pixels'][0])*(d['box_pixels'][3]-d['box_pixels'][1]))]
    return list(detections)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--image', required=True)
    ap.add_argument('--request-stdin', action='store_true')
    ap.add_argument('--target')
    ap.add_argument('--threshold', type=float, default=.25)
    ap.add_argument('--padding', type=float, default=.2)
    ap.add_argument('--feather', type=float, default=8)
    ap.add_argument('--dilate', type=float, default=0)
    ap.add_argument('--repair-expansion', type=float, default=0)
    ap.add_argument('--target-selection', choices=['largest','all'], default='largest')
    ap.add_argument('--selected-instances', default='')
    ap.add_argument('--manual-corrections', default='[]')
    ap.add_argument('--mask-output')
    ap.add_argument('--model', required=True)
    args = ap.parse_args()
    if args.request_stdin:
        request=json.load(sys.stdin)
        for key in ('target','threshold','padding','feather','dilate','repair_expansion','target_selection','selected_instances','manual_corrections','mask_output'):
            if key in request: setattr(args,key,request[key])
    args.target=args.target or ''
    args.target_selection=args.target_selection or 'largest'
    args.manual_corrections=args.manual_corrections or '[]'
    if not args.target.strip() or len(args.target) > 240 or not 0 <= args.threshold <= 1 or not 0 <= args.padding <= 3 or not 0 <= args.feather <= 200 or abs(args.dilate) > 256 or not 0 <= args.repair_expansion <= 1024:
        raise ValueError('invalid target phrase or threshold')
    started = time.monotonic()
    import torch
    from PIL import Image
    from transformers import Owlv2ForObjectDetection, Owlv2Processor
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    processor = Owlv2Processor.from_pretrained(args.model, local_files_only=True)
    model = Owlv2ForObjectDetection.from_pretrained(args.model, local_files_only=True, use_safetensors=True)
    model.eval().to(device)
    with Image.open(args.image) as source:
        image = source.convert('RGB')
    width, height = image.size
    inputs = processor(text=[[args.target.strip()]], images=image, return_tensors='pt')
    inputs = {key: value.to(device) for key, value in inputs.items()}
    with torch.inference_mode():
        outputs = model(**inputs)
    postprocess = getattr(processor, 'post_process_object_detection', None)
    if postprocess is None:
        postprocess = processor.image_processor.post_process_object_detection
    result = postprocess(outputs, threshold=args.threshold, target_sizes=[(height, width)])[0]
    boxes = result['boxes'].detach().cpu().tolist()
    scores = result['scores'].detach().cpu().tolist()
    detections = []
    for i, (box, score) in enumerate(zip(boxes, scores)):
        x0, y0, x1, y1 = [float(v) for v in box]
        x0=max(0.0,min(float(width),x0)); x1=max(0.0,min(float(width),x1))
        y0=max(0.0,min(float(height),y0)); y1=max(0.0,min(float(height),y1))
        detections.append({
            'instance_id': f'owlv2-{i+1}', 'label': args.target.strip(), 'confidence': float(score),
            'box_pixels': [x0, y0, x1, y1],
            'box_normalized': [x0 / width, y0 / height, x1 / width, y1 / height],
            'mask': None
        })
    corrections = args.manual_corrections if isinstance(args.manual_corrections,list) else json.loads(args.manual_corrections)
    if not isinstance(corrections, list) or len(corrections)>100: raise ValueError('invalid manual corrections')
    for c in corrections:
        if not isinstance(c,dict) or c.get('operation') not in ('add','erase') or not isinstance(c.get('box'),list) or len(c['box'])!=4 or any(not isinstance(v,(int,float)) or v<0 or v>1 for v in c['box']): raise ValueError('invalid manual correction')
    chosen = choose_detections(detections,args.target_selection,args.selected_instances)
    for d in detections:
        x0,y0,x1,y1=d['box_pixels']; expand=args.repair_expansion + max(x1-x0,y1-y0)*args.padding/2
        d['selected'] = d in chosen
        d['repair_pixels'] = [max(0,x0-expand),max(0,y0-expand),min(width,x1+expand),min(height,y1+expand)]
    if args.mask_output:
        from PIL import Image, ImageDraw, ImageFilter
        mask = Image.new('RGBA',(width,height),(255,255,255,0)); draw=ImageDraw.Draw(mask)
        for d in chosen:
            x0,y0,x1,y1=d['box_pixels']; pad=max(x1-x0,y1-y0)*args.padding/2 + args.repair_expansion + args.dilate
            bounds=(max(0,round(x0-pad)),max(0,round(y0-pad)),min(width,round(x1+pad)),min(height,round(y1+pad)))
            if bounds[2]>bounds[0] and bounds[3]>bounds[1]: draw.rectangle(bounds,fill=(255,255,255,255))
        for c in corrections:
            x0,y0,x1,y1=c['box']; bounds=(round(x0*width),round(y0*height),round(x1*width),round(y1*height))
            draw.rectangle(bounds,fill=(255,255,255,255) if c['operation']=='add' else (255,255,255,0))
        if args.feather: mask.putalpha(mask.getchannel('A').filter(ImageFilter.GaussianBlur(args.feather)))
        os.makedirs(os.path.dirname(args.mask_output),exist_ok=True); mask.save(args.mask_output)
    print(json.dumps({'status':'ok', 'backend':device, 'detector_id':'owlv2-base-patch16-ensemble',
        'detector_version':'google/owlv2-base-patch16-ensemble@410d70ced26e95c344915c2f10f4ecf967f2cde4',
        'image_width':width, 'image_height':height, 'detections':detections, 'detections_count':len(detections),
        'selection':args.target_selection, 'candidates':len(detections), 'filtered':len(detections),
        'mask':{'kind':'approximate_rectangle','precise':False} if args.mask_output else None,
        'timings_ms':{'total':round((time.monotonic()-started)*1000)}}))

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print(json.dumps({'error':str(exc), 'kind':type(exc).__name__}), file=sys.stderr)
        sys.exit(1)
