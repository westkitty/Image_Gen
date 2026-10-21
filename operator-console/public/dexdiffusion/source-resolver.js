// G3 — Canonical source-artifact resolver (T-301)
// Single source of truth for image handoffs: Library ↔ Edit ↔ Enhance ↔ 3D ↔ World
// Resolves canonical artifact IDs via server-authoritative endpoints, never localStorage filename guesses.
// Usage: DexSource.resolve(id) → { id, runId, file, url } or null; DexSource.validate(id) → boolean

(function (global) {
  const CANONICAL_RE = /^[a-z0-9-]+\/[a-z0-9_.-]+\.(png|jpg|jpeg|webp)$/i;

  function resolveImageId(runId, file) {
    if (!runId || !file) return null;
    const name = String(file).split('/').pop();
    return runId + '/' + name;
  }

  function imageUrl(backendBase, artifactId) {
    if (!artifactId) return null;
    // Prefer server canonical route: /api/run-file?path=<id>
    if (artifactId.includes('/')) return backendBase + '/api/run-file?path=' + encodeURIComponent(artifactId);
    return backendBase + '/api/images/' + encodeURIComponent(artifactId);
  }

  function isCanonicalId(id) {
    return typeof id === 'string' && id.length > 3 && (id.includes('/') || CANONICAL_RE.test(id));
  }

  // Validates that an artifact exists in the authoritative Library index
  async function validateArtifact(backendBase, artifactId) {
    if (!isCanonicalId(artifactId)) return { ok: false, reason: 'not-canonical' };
    try {
      const r = await fetch(backendBase + '/api/run-file?path=' + encodeURIComponent(artifactId), { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      return { ok: r.ok, status: r.status, reason: r.ok ? 'found' : 'not-found' };
    } catch (e) {
      return { ok: false, reason: 'network:' + e.message };
    }
  }

  const DexSource = { resolveImageId, imageUrl, isCanonicalId, validateArtifact };
  if (typeof module !== 'undefined' && module.exports) module.exports = DexSource;
  global.DexSource = DexSource;
})(typeof window !== 'undefined' ? window : global);
