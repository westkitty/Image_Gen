'use strict';

const fs = require('fs');
const path = require('path');

const EMPTY = Object.freeze({ schema: 'dexdiffusion.director-preferences.v1', favorite_presets: [], preferred_models: {}, default_direction: '', speed: 1, intensity: 0.5, acting_styles: [], last_audition: {} });
function createDirectorPreferences(file) {
  const target = path.resolve(file);
  const read = () => {
    try {
      const value = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (value && value.schema === EMPTY.schema) return Object.assign({}, EMPTY, value);
    } catch (_) {}
    return Object.assign({}, EMPTY, { favorite_presets: [], preferred_models: {}, acting_styles: [], last_audition: {} });
  };
  const save = value => {
    const dir = path.dirname(target); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, target);
    return value;
  };
  return {
    get: read,
    update(patch = {}) {
      const current = read(), next = Object.assign({}, current);
      for (const k of ['default_direction']) if (patch[k] !== undefined) next[k] = String(patch[k]).slice(0, 240);
      for (const k of ['speed', 'intensity']) if (patch[k] !== undefined && Number.isFinite(Number(patch[k]))) next[k] = Math.max(k === 'speed' ? 0.5 : 0, Math.min(k === 'speed' ? 2 : 1, Number(patch[k])));
      if (patch.favorite_presets !== undefined) next.favorite_presets = [...new Set((Array.isArray(patch.favorite_presets) ? patch.favorite_presets : []).map(String).filter(x => /^[a-z0-9_-]{1,48}$/i.test(x)))].slice(0, 50);
      if (patch.preferred_models && typeof patch.preferred_models === 'object' && !Array.isArray(patch.preferred_models)) next.preferred_models = Object.fromEntries(Object.entries(patch.preferred_models).filter(([k,v]) => /^[a-z0-9_-]{1,80}$/i.test(k) && typeof v === 'string' && /^[a-z0-9_-]{1,80}$/i.test(v)).slice(0, 100));
      if (patch.acting_styles !== undefined) next.acting_styles = (Array.isArray(patch.acting_styles) ? patch.acting_styles : []).slice(0, 50).map(x => ({ id: String(x.id || '').slice(0, 48), name: String(x.name || '').slice(0, 80), direction: String(x.direction || '').slice(0, 240), speed: Number.isFinite(Number(x.speed)) ? Math.max(0.5, Math.min(2, Number(x.speed))) : null, intensity: Number.isFinite(Number(x.intensity)) ? Math.max(0, Math.min(1, Number(x.intensity))) : null })).filter(x => x.id && x.name);
      if (patch.last_audition && typeof patch.last_audition === 'object' && !Array.isArray(patch.last_audition)) next.last_audition = Object.fromEntries(Object.entries(patch.last_audition).filter(([k,v]) => /^[a-z0-9_-]{1,48}$/i.test(k) && ['string','number','boolean'].includes(typeof v)).slice(0, 30));
      return save(next);
    },
    reset() { return save(Object.assign({}, EMPTY, { favorite_presets: [], preferred_models: {}, acting_styles: [], last_audition: {} })); },
  };
}

module.exports = { EMPTY, createDirectorPreferences };
