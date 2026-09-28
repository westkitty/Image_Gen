'use strict';

// F01: Event-driven Job Bus (SSE control plane)
// Native Server-Sent Events, monotonic IDs, bounded replay ring, privacy-safe allowlisted payloads.

const crypto = require('crypto');

const SCHEMA_VERSION = 'dexdiffusion.events.v1';
const DEFAULT_MAX_REPLAY = 200;
const HEARTBEAT_INTERVAL_MS = 15000;

// Explicit event allowlist
const ALLOWED_EVENT_CLASSES = new Set([
  'system.ready',
  'snapshot',
  'job.created',
  'job.queued',
  'job.waiting',
  'job.started',
  'job.progress',
  'job.log',
  'job.completed',
  'job.failed',
  'job.interrupted',
  'job.cancelled',
  'queue.changed',
  'resource.changed',
  'library.changed',
  'heartbeat'
]);

// Fields strictly forbidden from event payloads (privacy canary guarantee)
const FORBIDDEN_CANARY_FIELDS = new Set([
  'prompt',
  'negative_prompt',
  'requestParams',
  'text',
  'lyrics',
  'caption',
  'ref_text',
  'instruct'
]);

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const clean = {};
  for (const [k, v] of Object.entries(payload)) {
    if (FORBIDDEN_CANARY_FIELDS.has(k)) continue;
    if (k.toLowerCase().includes('prompt') && k !== 'save_prompts') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      clean[k] = sanitizePayload(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

function createEventBus({ maxReplay = DEFAULT_MAX_REPLAY, heartbeatMs = HEARTBEAT_INTERVAL_MS } = {}) {
  let nextId = 1;
  const replayRing = []; // Array of { id, event, data, ts }
  const clients = new Set();
  let heartbeatTimer = null;

  function publish(event, rawData = {}) {
    if (!ALLOWED_EVENT_CLASSES.has(event)) {
      throw new Error(`Event '${event}' is not in the allowed event classes`);
    }

    const id = nextId++;
    const payload = sanitizePayload(rawData);
    payload.schemaVersion = SCHEMA_VERSION;
    payload.eventId = id;
    payload.ts = Date.now();

    const record = { id, event, data: payload, ts: payload.ts };

    replayRing.push(record);
    if (replayRing.length > maxReplay) {
      replayRing.shift();
    }

    // Broadcast to connected clients
    for (const client of clients) {
      try {
        client.send(record);
      } catch (err) {
        // Client write failure; will be cleaned up
      }
    }

    return record;
  }

  function getReplaySince(lastId) {
    const parsedId = Number(lastId);
    if (!Number.isFinite(parsedId) || parsedId < 0) return [];
    return replayRing.filter(r => r.id > parsedId);
  }

  function handleSseConnection(req, res, getInitialSnapshot = null) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    const client = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
      connectedAt: Date.now(),
      send: (record) => {
        const payloadStr = JSON.stringify(record.data);
        res.write(`id: ${record.id}\nevent: ${record.event}\ndata: ${payloadStr}\n\n`);
      }
    };

    clients.add(client);

    // Initial system.ready event
    client.send({
      id: nextId++,
      event: 'system.ready',
      data: {
        schemaVersion: SCHEMA_VERSION,
        connected: true,
        serverTime: Date.now(),
        clientCount: clients.size
      }
    });

    // Check Last-Event-ID header for catchup
    const lastEventId = req.headers && req.headers['last-event-id'];
    if (lastEventId) {
      const missed = getReplaySince(lastEventId);
      for (const rec of missed) {
        client.send(rec);
      }
    }

    // Send initial snapshot if provider supplied
    if (getInitialSnapshot && typeof getInitialSnapshot === 'function') {
      try {
        const snap = sanitizePayload(getInitialSnapshot());
        client.send({
          id: nextId++,
          event: 'snapshot',
          data: {
            schemaVersion: SCHEMA_VERSION,
            snapshot: snap,
            ts: Date.now()
          }
        });
      } catch (_) {}
    }

    const cleanup = () => {
      clients.delete(client);
    };

    req.on('close', cleanup);
    req.on('end', cleanup);
    res.on('close', cleanup);
    res.on('finish', cleanup);
  }

  // Heartbeat loop
  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(() => {
      if (clients.size > 0) {
        publish('heartbeat', { alive: true, clients: clients.size });
      }
    }, heartbeatMs);
    heartbeatTimer.unref?.();
  }

  function close() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    clients.clear();
    replayRing.length = 0;
  }

  function clientCount() {
    return clients.size;
  }

  function ringSize() {
    return replayRing.length;
  }

  return {
    publish,
    handleSseConnection,
    getReplaySince,
    clientCount,
    ringSize,
    close,
    SCHEMA_VERSION
  };
}

module.exports = {
  createEventBus,
  ALLOWED_EVENT_CLASSES,
  FORBIDDEN_CANARY_FIELDS,
  sanitizePayload,
  SCHEMA_VERSION
};
