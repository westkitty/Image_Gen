// Browser transport for the opt-in Chat workspace. It does not persist text.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DexChatClient = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const TERMINALS = new Set(['done', 'stopped', 'error']);

  function parseFrame(frame) {
    let event = '', data = '';
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data += line.slice(5).trimStart();
    }
    if (!event || !data) return null;
    const payload = JSON.parse(data);
    if (!payload || payload.v !== 'dex.chat.v1' || typeof payload.request_id !== 'string') throw new Error('invalid-chat-event');
    return { event, payload };
  }

  async function readSse(response, onEvent) {
    if (!response.ok) {
      let body = null;
      try { body = await response.json(); } catch (_) {}
      const error = new Error(body && body.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (!response.body || typeof response.body.getReader !== 'function') throw new Error('stream-unavailable');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', terminal = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const item = parseFrame(frame);
          if (!item) continue;
          if (terminal) throw new Error('event-after-terminal');
          if (TERMINALS.has(item.event)) terminal = item;
          await onEvent(item);
        }
        if (done) break;
      }
    } catch (error) {
      try { await reader.cancel(); } catch (_) {}
      throw error;
    } finally { reader.releaseLock(); }
    if (!terminal) throw new Error('stream-ended-without-terminal');
    return terminal;
  }

  function requestId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return 'cr_' + Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  }

  return { parseFrame, readSse, requestId };
});
