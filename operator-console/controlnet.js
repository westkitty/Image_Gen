'use strict';
// ControlNet for the local engine (Create on SD 1.5 / SDXL checkpoints).
//
// Proven on the Big Mac on 2026-11-05 with sd-cli 7f0e728:
//   - SD 1.5 OpenPose (control_v11p_sd15_openpose_fp16) loads and follows the pose with the stock engine.
//   - SDXL OpenPose (xinsir) needs (a) its diffusers tensor names renamed to the original layout (the "-ldm" copy) and
//     (b) an sd-cli built with CONTROL_NET_GRAPH_SIZE = MAX_GRAPH_SIZE; the stock build aborts with
//     GGML_ASSERT(cgraph->n_nodes < cgraph->size). The rebuilt binary renders SD 1.5 pixel-identically to the stock one.
// Every model and the ControlNet-capable binary live on WC2TB and are read only by the job that uses them.
// The client names a ControlNet id, never a path; paths are server- and worker-owned.

const CONTROLNET_ROOT = '/Volumes/wc2tb/ImageGen/controlnet';
// Separate binary used only for ControlNet jobs, so ordinary generation keeps the proven stock sd-cli.
const SDCLI_CONTROL = '/Volumes/wc2tb/ImageGen/engines/sdcpp-controlnet-7f0e728/sd-cli';

// family: the checkpoint architecture the ControlNet was trained for ('sd15' | 'sdxl').
const CONTROLNETS = Object.freeze({
  'openpose-sd15': Object.freeze({ id: 'openpose-sd15', label: 'OpenPose · SD 1.5', kind: 'openpose', family: 'sd15',
    path: CONTROLNET_ROOT + '/control_v11p_sd15_openpose_fp16.safetensors',
    sha256: '4003c1da17b0e4ba444e02140e1c0d83bb24b79e4dcfd613c3a554d38f0f89c7' }),
  'openpose-sdxl': Object.freeze({ id: 'openpose-sdxl', label: 'OpenPose · SDXL (xinsir)', kind: 'openpose', family: 'sdxl',
    path: CONTROLNET_ROOT + '/xinsir-openpose-sdxl-1.0-ldm.safetensors',
    sha256: '1fef69c7a198424b4bd918f2748206226ed6b319fbd64d7edb4953395c31fd3b' }),
});

const STRENGTH = Object.freeze({ min: 0, max: 2, default: 0.9 });
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

// Extra-networks family -> ControlNet family. Pony and SDXL Turbo are SDXL architectures; FLUX has no ControlNet here.
function controlFamily(family) {
  const f = String(family || '').toLowerCase();
  if (f === 'sd15') return 'sd15';
  if (f === 'sdxl' || f === 'sdxl_turbo' || f === 'pony') return 'sdxl';
  return null;
}

// Ids of the ControlNets a target can use. spec: a controlled target; familyOf: resolveTargetFamily.
function controlnetsForTarget(spec, familyOf) {
  if (!spec || spec.backend === 'mflux') return [];
  const fam = controlFamily(familyOf(spec.aliasOf || spec.id));
  return fam ? Object.values(CONTROLNETS).filter(c => c.family === fam).map(c => c.id) : [];
}

// Validate the client's `controlnet` field. Returns { control } | { error } | { control: null } when absent.
// raw: { model, strength, image (data:image/png;base64,...) | image_id }
function normalizeControlnet(raw, spec, familyOf) {
  if (raw === undefined || raw === null || raw === false) return { control: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'controlnet must be an object' };
  const extra = Object.keys(raw).filter(k => !['model', 'strength', 'image', 'image_id'].includes(k));
  if (extra.length) return { error: 'Unknown controlnet field: ' + extra[0] };
  const cn = CONTROLNETS[raw.model];
  if (!cn) return { error: 'Unknown ControlNet model' };
  if (!controlnetsForTarget(spec, familyOf).includes(cn.id)) return { error: `${cn.label} does not work with ${spec && (spec.label || spec.id) || 'this model'}. ControlNet needs a matching SD 1.5 or SDXL checkpoint.` };
  const strength = raw.strength === undefined || raw.strength === '' ? STRENGTH.default : Number(raw.strength);
  if (!Number.isFinite(strength) || strength < STRENGTH.min || strength > STRENGTH.max) return { error: `ControlNet strength must be between ${STRENGTH.min} and ${STRENGTH.max}` };
  const hasData = typeof raw.image === 'string' && raw.image !== '';
  const hasId = typeof raw.image_id === 'string' && raw.image_id !== '';
  if (!hasData && !hasId) return { error: 'Add a pose for ControlNet, or turn ControlNet off.' };
  if (hasData && hasId) return { error: 'ControlNet needs exactly one of image or image_id' };
  let png = null;
  if (hasData) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw.image);
    if (!m) return { error: 'ControlNet image must be a PNG data URL' };
    png = Buffer.from(m[1], 'base64');
    if (png.length > MAX_IMAGE_BYTES || !isPng(png)) return { error: 'ControlNet image must be a PNG of at most 16 MB' };
  } else if (!/^[A-Za-z0-9._-]{1,200}$/.test(raw.image_id)) return { error: 'Invalid ControlNet image_id' };
  return { control: { model: cn.id, strength, png, imageId: hasId ? raw.image_id : null } };
}

function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

// Public list for /api/capabilities and the Studio panel (no paths).
function publicControlnets() {
  return Object.values(CONTROLNETS).map(({ id, label, kind, family }) => ({ id, label, kind, family }));
}

module.exports = { CONTROLNETS, CONTROLNET_ROOT, SDCLI_CONTROL, STRENGTH, MAX_IMAGE_BYTES, controlFamily, controlnetsForTarget, normalizeControlnet, publicControlnets, isPng };
