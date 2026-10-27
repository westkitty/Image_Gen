'use strict';
// Host / Origin / CSRF guard for the new Chat routes (Phase 0 contract E.5). Closes the DNS-rebinding gap for these routes only;
// applying it app-wide is decision AUTH-7. No CORS headers are ever emitted.

const TAILNET_HOST = 'macbook-air.tailafb7e8.ts.net';
const BIGMAC_TAILNET_HOST = 'bigmac.tailafb7e8.ts.net';
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function defaultPolicy(port) {
  const hosts = [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    TAILNET_HOST,
    `${TAILNET_HOST}:8443`,
    BIGMAC_TAILNET_HOST,
    `${BIGMAC_TAILNET_HOST}:11443`,
    `${BIGMAC_TAILNET_HOST}:8443`,
  ];
  const origins = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `https://${TAILNET_HOST}`,
    `https://${TAILNET_HOST}:8443`,
    `https://${BIGMAC_TAILNET_HOST}`,
    `https://${BIGMAC_TAILNET_HOST}:11443`,
    `https://${BIGMAC_TAILNET_HOST}:8443`,
  ];

  const customHost = process.env.DEX_TAILNET_HOST;
  const customPort = process.env.DEX_TAILNET_PORT;
  if (customHost) {
    const ch = customHost.toLowerCase();
    hosts.push(ch);
    origins.push(`https://${ch}`);
    if (customPort) {
      hosts.push(`${ch}:${customPort}`);
      origins.push(`https://${ch}:${customPort}`);
    }
  } else if (customPort) {
    hosts.push(`${BIGMAC_TAILNET_HOST}:${customPort}`, `${TAILNET_HOST}:${customPort}`);
    origins.push(`https://${BIGMAC_TAILNET_HOST}:${customPort}`, `https://${TAILNET_HOST}:${customPort}`);
  }

  return { hosts, origins };
}

function createRequestGuard({ hosts, origins }) {
  const allowedHosts = new Set(hosts.map(h => h.toLowerCase()));
  const allowedOrigins = new Set(origins.map(o => o.toLowerCase()));
  return function requestGuard(req, res, next) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts.has(host)) return res.status(403).json({ error: 'host-not-allowed' });
    if (STATE_CHANGING.has(req.method)) {
      const origin = String(req.headers.origin || '').toLowerCase();
      if (!origin || !allowedOrigins.has(origin)) return res.status(403).json({ error: 'origin-not-allowed' });
      if (req.headers['x-dex-request'] !== '1') return res.status(403).json({ error: 'request-header-required' });
      if (req.method !== 'DELETE') {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json') return res.status(415).json({ error: 'content-type-not-allowed' });
      }
    }
    next();
  };
}

module.exports = { createRequestGuard, defaultPolicy, TAILNET_HOST, BIGMAC_TAILNET_HOST };
