// A1111 inpaint options the installed engine can honour (P08). Pure; shared by the browser and the server.
//   inpaint_area    whole | only_masked        ("Inpaint area": whole picture / only masked)
//   inpaint_padding 0-256 px                   ("Only masked padding, pixels"; only_masked)
//   mask_blur       0-64 px                    ("Mask blur": softness of the edge where the original is restored)
//   masked_content  original | fill            ("Masked content")
// latent noise / latent nothing, conditioning-mask weight and soft inpainting need control sd-cli does not expose.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexInpaint = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const AREAS = Object.freeze(['whole', 'only_masked']);
  const CONTENTS = Object.freeze(['original', 'fill']);
  const UNAVAILABLE_CONTENTS = Object.freeze(['latent_noise', 'latent_nothing']);
  const DEFAULTS = Object.freeze({ area: 'whole', padding: 32, blur: 4, content: 'original', width: 512, height: 512 });
  const num = v => (v === undefined || v === null || v === '' ? null : Number(v));

  // Returns { options } or { error }. Absent fields take the defaults (current behaviour: whole picture, blur 4, original).
  function normalizeInpaintOptions(body = {}) {
    const area = body.inpaint_area === undefined || body.inpaint_area === null || body.inpaint_area === '' ? DEFAULTS.area : String(body.inpaint_area);
    if (!AREAS.includes(area)) return { error: `inpaint_area must be one of ${AREAS.join(', ')}` };
    const content = body.masked_content === undefined || body.masked_content === null || body.masked_content === '' ? DEFAULTS.content : String(body.masked_content);
    if (UNAVAILABLE_CONTENTS.includes(content)) return { error: `masked_content "${content}" is not available: sd-cli cannot initialise the masked latent with noise or nothing` };
    if (!CONTENTS.includes(content)) return { error: `masked_content must be one of ${CONTENTS.join(', ')}` };
    const padding = num(body.inpaint_padding), blur = num(body.mask_blur);
    if (padding !== null && (!Number.isInteger(padding) || padding < 0 || padding > 256)) return { error: 'inpaint_padding must be an integer 0-256' };
    if (blur !== null && (!Number.isInteger(blur) || blur < 0 || blur > 64)) return { error: 'mask_blur must be an integer 0-64' };
    if (area === 'whole' && padding !== null) return { error: 'inpaint_padding only applies when inpaint_area is only_masked' };
    return { options: { area, padding: padding === null ? DEFAULTS.padding : padding, blur: blur === null ? DEFAULTS.blur : blur, content } };
  }

  // Crop region for "only masked": A1111's get_crop_region (mask bounding box + padding) followed by expand_crop_region
  // (grow to the work-size aspect ratio, shifting to stay inside the image). `bbox` is [left, top, right, bottom] of the mask.
  function cropRegion(bbox, padding, workW, workH, imgW, imgH) {
    let [x1, y1, x2, y2] = [Math.max(bbox[0] - padding, 0), Math.max(bbox[1] - padding, 0), Math.min(bbox[2] + padding, imgW), Math.min(bbox[3] + padding, imgH)];
    const ratioCrop = (x2 - x1) / (y2 - y1), ratioWork = workW / workH;
    const pyDiv = (a, b) => Math.floor(a / b); // Python floor division
    if (ratioCrop > ratioWork) {
      const desired = (x2 - x1) / ratioWork, diff = Math.trunc(desired - (y2 - y1));
      y1 -= pyDiv(diff, 2); y2 += diff - pyDiv(diff, 2);
      if (y2 >= imgH) { const d = y2 - imgH; y2 -= d; y1 -= d; }
      if (y1 < 0) { y2 -= y1; y1 = 0; }
      if (y2 >= imgH) y2 = imgH;
    } else {
      const desired = (y2 - y1) * ratioWork, diff = Math.trunc(desired - (x2 - x1));
      x1 -= pyDiv(diff, 2); x2 += diff - pyDiv(diff, 2);
      if (x2 >= imgW) { const d = x2 - imgW; x2 -= d; x1 -= d; }
      if (x1 < 0) { x2 -= x1; x1 = 0; }
      if (x2 >= imgW) x2 = imgW;
    }
    return [x1, y1, x2, y2];
  }

  return { AREAS, CONTENTS, UNAVAILABLE_CONTENTS, DEFAULTS, normalizeInpaintOptions, cropRegion };
});
