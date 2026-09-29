'use strict';

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function rulesForTarget(target = {}) {
  const mflux = target.backend === 'mflux';
  return {
    minWidth: finiteOr(target.minWidth, mflux ? 256 : 64),
    minHeight: finiteOr(target.minHeight, mflux ? 256 : 64),
    maxWidth: finiteOr(target.maxWidth, 2048),
    maxHeight: finiteOr(target.maxHeight, 2048),
    dimensionMultiple: finiteOr(target.dimensionMultiple, mflux ? 16 : 8),
  };
}

function validateDimensions(target, width, height) {
  const label = target.label || target.id || 'this target';
  const r = rulesForTarget(target);
  const w = Number(width), h = Number(height);
  if (!Number.isInteger(w) || w < r.minWidth || w > r.maxWidth) return `Width must be between ${r.minWidth} and ${r.maxWidth} for ${label}.`;
  if (w % r.dimensionMultiple) return `Width must be a multiple of ${r.dimensionMultiple} for ${label}.`;
  if (!Number.isInteger(h) || h < r.minHeight || h > r.maxHeight) return `Height must be between ${r.minHeight} and ${r.maxHeight} for ${label}.`;
  if (h % r.dimensionMultiple) return `Height must be a multiple of ${r.dimensionMultiple} for ${label}.`;
  return null;
}

module.exports = { rulesForTarget, validateDimensions };
