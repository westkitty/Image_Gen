'use strict';
// Tailscale identity & access authorization gate for DexDiffusion.
// Tailscale Serve cryptographically authenticates incoming tailnet requests
// and forwards trusted Tailscale-User-Login headers.
// Only authorized users (default: westkitty@*) are permitted; unauthorized users (e.g. bcroc@*) are blocked.

function getAuthorizedLogins() {
  const raw = process.env.DEX_AUTHORIZED_TAILSCALE_USERS || 'westkitty';
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAuthorizedTailscaleUser(login, authorizedList = getAuthorizedLogins()) {
  if (!login || typeof login !== 'string') return false;
  const raw = login.trim().toLowerCase();
  const username = raw.split('@')[0];
  return authorizedList.some(a => raw === a || username === a || raw.startsWith(a + '@'));
}

function isTailscaleHost(hostHeader) {
  if (!hostHeader) return false;
  const h = String(hostHeader).toLowerCase().split(':')[0];
  return h.endsWith('.ts.net') || h.endsWith('.tailafb7e8.ts.net');
}

function createTailscaleAuthGate(options = {}) {
  const getAuthorized = options.getAuthorized || getAuthorizedLogins;

  return function tailscaleAuthGate(req, res, next) {
    const login = req.headers['tailscale-user-login'];
    const host = String(req.headers.host || '').toLowerCase();
    const xfHost = String(req.headers['x-forwarded-host'] || '').toLowerCase();
    const isTs = isTailscaleHost(host) || isTailscaleHost(xfHost) || login != null;

    if (isTs) {
      const authorizedList = getAuthorized();
      if (!login || !isAuthorizedTailscaleUser(login, authorizedList)) {
        return res.status(403).json({
          error: 'unauthorized-tailnet-user',
          message: 'Access denied: tailnet user not authorized for DexDiffusion',
          login: login || null,
        });
      }
    }
    next();
  };
}

module.exports = {
  createTailscaleAuthGate,
  isAuthorizedTailscaleUser,
  isTailscaleHost,
  getAuthorizedLogins,
};
