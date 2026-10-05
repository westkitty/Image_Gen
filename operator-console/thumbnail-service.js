'use strict';

// F04: Thumbnail generation & secure cache
// Uses macOS native `sips` when available, falling back safely.
// Security contract:
// - ONLY canonical registered media IDs from imageStore.
// - Rejects traversal, absolute paths, symlinks escaping root.
// - Safe cache paths only.
// - Derived cache only; original canonical file never modified.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function createThumbnailService({ cacheDir, imageStore, maxDimension = 384 }) {
  if (!fs.existsSync(cacheDir)) {
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
  }

  function getCachePath(imageId) {
    const safeId = path.basename(imageId).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(cacheDir, `${safeId}_thumb_${maxDimension}.jpg`);
  }

  function hasThumbnail(imageId) {
    const p = getCachePath(imageId);
    return fs.existsSync(p);
  }

  function getThumbnailFile(imageId) {
    const p = getCachePath(imageId);
    if (fs.existsSync(p)) return p;
    return null;
  }

  function generateThumbnail(imageId, callback) {
    // 1. Resolve canonical source path securely through imageStore
    if (!imageStore || typeof imageStore.resolveImage !== 'function') {
      return callback(new Error('ImageStore unavailable'));
    }

    const resolved = imageStore.resolveImage(imageId);
    const sourcePath = typeof resolved === 'string' ? resolved : (resolved && resolved.path);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return callback(new Error(`Canonical source image not found for ${imageId}`));
    }

    const outPath = getCachePath(imageId);
    if (fs.existsSync(outPath)) {
      return callback(null, outPath);
    }

    // Try `sips` (macOS native fast resizer)
    const tmpOut = `${outPath}.tmp.${Date.now()}`;
    execFile('sips', ['-Z', String(maxDimension), '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', sourcePath, '--out', tmpOut], { timeout: 10000 }, (err) => {
      if (!err && fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0) {
        try {
          fs.renameSync(tmpOut, outPath);
          return callback(null, outPath);
        } catch (e) {
          try { fs.unlinkSync(tmpOut); } catch (_) {}
          return callback(e);
        }
      }

      // Cleanup tmp if sips failed
      try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (_) {}

      // Fallback: try `convert` (ImageMagick)
      execFile('convert', [sourcePath, '-resize', `${maxDimension}x${maxDimension}>`, '-quality', '80', tmpOut], { timeout: 10000 }, (cErr) => {
        if (!cErr && fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0) {
          try {
            fs.renameSync(tmpOut, outPath);
            return callback(null, outPath);
          } catch (e) {
            try { fs.unlinkSync(tmpOut); } catch (_) {}
            return callback(e);
          }
        }
        try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (_) {}
        // If external tools are unavailable, fallback gracefully: cannot generate
        callback(new Error('No thumbnail generator tool available (sips/convert)'));
      });
    });
  }

  function clearCache() {
    try {
      const files = fs.readdirSync(cacheDir);
      for (const f of files) {
        fs.unlinkSync(path.join(cacheDir, f));
      }
      return { success: true, cleared: files.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function stats() {
    try {
      const files = fs.readdirSync(cacheDir);
      let totalBytes = 0;
      for (const f of files) {
        try {
          totalBytes += fs.statSync(path.join(cacheDir, f)).size;
        } catch (_) {}
      }
      return { count: files.length, totalBytes };
    } catch (_) {
      return { count: 0, totalBytes: 0 };
    }
  }

  return {
    getCachePath,
    hasThumbnail,
    getThumbnailFile,
    generateThumbnail,
    clearCache,
    stats
  };
}

module.exports = {
  createThumbnailService
};
