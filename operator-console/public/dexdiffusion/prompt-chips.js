// prompt-chips.js — <dex-prompt-field>: the prompt box, with each __wildcard__ shown as a chip inside the text. A chip can be
// dragged to a new place (or into the other prompt field), duplicated with + and dismissed with ×. The field's value is always
// the plain prompt text with __name__ tokens, so generation and everything else that reads the prompt is unchanged. It offers
// the same value / selectionStart / selectionEnd / setSelectionRange a textarea does. The text helpers are exported for Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DexPromptChips = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TOKEN_SOURCE = '__[A-Za-z0-9_-]+__';
  const matchTokens = text => { const re = new RegExp(TOKEN_SOURCE, 'g'), out = []; let m; while ((m = re.exec(text)) !== null) out.push({ token: m[0], name: m[0].slice(2, -2), at: m.index }); return out; };

  function parseSegments(text) {
    const s = String(text == null ? '' : text), out = []; let pos = 0;
    for (const t of matchTokens(s)) {
      if (t.at > pos) out.push({ type: 'text', text: s.slice(pos, t.at) });
      out.push({ type: 'token', token: t.token, name: t.name });
      pos = t.at + t.token.length;
    }
    if (pos < s.length) out.push({ type: 'text', text: s.slice(pos) });
    return out;
  }

  // Close the gap a token leaves, without touching other text.
  function joinAfterRemoval(before, after) {
    if (!before.trim()) return after.replace(/^[\s,]+/, '');
    if (!after.trim()) return before.replace(/[\s,]+$/, '');
    if (/,\s*$/.test(before) && /^\s*,/.test(after)) return before.replace(/\s+$/, '') + after.replace(/^\s*,/, '');
    if (/\s$/.test(before) && /^\s/.test(after)) return before + after.replace(/^\s+/, '');
    return before + after;
  }
  // Put text at an offset with the separators the prompt needs. -> { text, at } where `at` is where the piece starts.
  function insertPiece(text, piece, offset) {
    const s = String(text == null ? '' : text), at = Math.max(0, Math.min(s.length, offset == null ? s.length : offset));
    const before = s.slice(0, at), after = s.slice(at);
    const left = before && !/[\s,(\[]$/.test(before) ? ', ' : '';
    const right = after && !/^[\s,)\]]/.test(after) ? ', ' : '';
    return { text: before + left + piece + right + after, at: before.length + left.length };
  }
  function removeTokenAt(text, index) {
    const s = String(text), t = matchTokens(s)[index];
    return t ? joinAfterRemoval(s.slice(0, t.at), s.slice(t.at + t.token.length)) : s;
  }
  function duplicateTokenAt(text, index) {
    const s = String(text), t = matchTokens(s)[index];
    return t ? insertPiece(s, t.token, t.at + t.token.length).text : s;
  }
  // Move a token to an offset in the current text. Dropping it onto itself changes nothing.
  function moveTokenTo(text, index, offset) {
    const s = String(text), t = matchTokens(s)[index];
    if (!t || (offset >= t.at && offset <= t.at + t.token.length)) return s;
    const MARK = '';
    const marked = s.slice(0, offset) + MARK + s.slice(offset);
    const shift = offset <= t.at ? 1 : 0;
    const removed = joinAfterRemoval(marked.slice(0, t.at + shift), marked.slice(t.at + shift + t.token.length));
    const at = removed.indexOf(MARK);
    return insertPiece(removed.slice(0, at) + removed.slice(at + 1), t.token, at).text;
  }
  function swapTokens(text, index, dir) {
    const s = String(text), ts = matchTokens(s), a = ts[index], b = ts[index + dir];
    if (!a || !b) return s;
    const [lo, hi] = a.at < b.at ? [a, b] : [b, a];
    return s.slice(0, lo.at) + hi.token + s.slice(lo.at + lo.token.length, hi.at) + lo.token + s.slice(hi.at + hi.token.length);
  }

  const api = { parseSegments, matchTokens, removeTokenAt, duplicateTokenAt, moveTokenTo, swapTokens, insertPiece, setBankCounts() {} };
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return api;

  const ZWSP = '​'; // Gives the caret somewhere to sit beside a chip; never part of the value.
  const FIELD_STYLE = `
dex-prompt-field{display:block;width:100%;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;overflow-y:auto;cursor:text;outline:none}
dex-prompt-field:focus-visible{box-shadow:0 0 0 2px rgba(56,189,248,.55)}
dex-prompt-field[data-empty]::before{content:attr(placeholder);color:#8a8fa8;pointer-events:none}
dex-prompt-field[aria-disabled="true"]{opacity:.55;cursor:not-allowed}
.dx-pchip{display:inline-flex;align-items:center;gap:1px;vertical-align:baseline;margin:1px 2px;padding:0 2px;border:1px solid rgba(167,139,250,.5);background:rgba(167,139,250,.16);border-radius:7px;color:#ddd6fe;font:600 11px/1.6 'IBM Plex Mono',monospace;white-space:nowrap;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-user-drag:element}
.dx-pchip[data-wildcard-chip="negative"]{border-color:rgba(248,113,113,.5);background:rgba(248,113,113,.12);color:#fecaca}
.dx-pchip:focus-visible{outline:2px solid #38bdf8;outline-offset:1px}
.dx-pchip[data-dragging]{opacity:.45}
.dx-pchip button{border:none;background:transparent;color:inherit;opacity:.75;cursor:pointer;min-width:18px;min-height:0;height:18px;padding:0;margin:0;font:700 13px/1 'DM Sans',sans-serif;border-radius:4px}
.dx-pchip button:hover{opacity:1;background:rgba(255,255,255,.14)}
.dx-pchip small{opacity:.65;font-weight:400;font-size:10px;margin-left:3px}
.dx-pchip-drop{position:fixed;width:2px;background:#38bdf8;border-radius:1px;pointer-events:none;z-index:20000}`;
  function injectStyle() {
    if (document.getElementById('dx-prompt-field-style')) return;
    const style = document.createElement('style'); style.id = 'dx-prompt-field-style'; style.textContent = FIELD_STYLE; document.head.appendChild(style);
  }

  let bankCounts = new Map();
  api.setBankCounts = banks => {
    bankCounts = new Map((banks || []).map(b => [String(b.name).toLowerCase(), b.count]));
    document.querySelectorAll('.dx-pchip small').forEach(n => { const c = bankCounts.get(n.dataset.bank); n.textContent = c == null ? '' : String(c); });
  };

  function serialize(node) {
    let out = '';
    node.childNodes.forEach((n, i) => {
      if (n.nodeType === 3) out += n.data.replace(/​/g, '').replace(/ /g, ' ');
      else if (n.nodeType !== 1) return;
      else if (n.dataset && n.dataset.token) out += n.dataset.token;
      else if (n.tagName === 'BR') { if (i < node.childNodes.length - 1) out += '\n'; }
      else { if (out && n.tagName === 'DIV' && !out.endsWith('\n')) out += '\n'; out += serialize(n); }
    });
    return out;
  }

  let dragging = null; // { field, index, chip }
  let dropMark = null;
  const clearDropMark = () => { if (dropMark) { dropMark.remove(); dropMark = null; } };

  class DexPromptField extends HTMLElement {
    constructor() { super(); this._sel = { start: 0, end: 0 }; this._built = false; this._pending = ''; }

    connectedCallback() {
      injectStyle();
      if (this._built) return;
      this._built = true;
      this.setAttribute('role', 'textbox'); this.setAttribute('aria-multiline', 'true'); this.setAttribute('tabindex', '0'); this.setAttribute('spellcheck', 'true');
      this._applyEditable();
      const rows = parseInt(this.getAttribute('rows'), 10);
      if (rows > 0 && !this.style.minHeight) this.style.minHeight = 'calc(' + rows + ' * 1.5em + 20px)';
      this.addEventListener('input', e => this._onInput(e));
      this.addEventListener('compositionend', () => this._onInput());
      this.addEventListener('keyup', () => this._rememberSelection());
      this.addEventListener('mouseup', () => this._rememberSelection());
      this.addEventListener('focusin', () => this._rememberSelection());
      this.addEventListener('paste', e => this._onPaste(e));
      this.addEventListener('copy', e => this._onCopy(e, false));
      this.addEventListener('cut', e => this._onCopy(e, true));
      this.addEventListener('dragover', e => this._onDragOver(e));
      this.addEventListener('dragleave', clearDropMark);
      this.addEventListener('drop', e => this._onDrop(e));
      this._render(this._pending);
    }

    static get observedAttributes() { return ['disabled', 'placeholder']; }
    attributeChangedCallback() { if (this._built) this._applyEditable(); }
    _applyEditable() {
      const off = this.hasAttribute('disabled');
      this.setAttribute('aria-disabled', String(off));
      this.setAttribute('contenteditable', off ? 'false' : 'plaintext-only');
      if (!off && this.contentEditable !== 'plaintext-only') this.setAttribute('contenteditable', 'true');
    }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(v) { this.toggleAttribute('disabled', !!v); }

    get value() { return this._built ? serialize(this) : this._pending; }
    set value(v) {
      const text = String(v == null ? '' : v);
      if (!this._built) { this._pending = text; return; }
      if (text === serialize(this)) return;
      this._render(text);
      const focused = this.contains(document.activeElement);
      const end = Math.min(this._sel.end, text.length), start = Math.min(this._sel.start, end);
      if (focused) this.setSelectionRange(start, end); else this._sel = { start, end };
    }
    get selectionStart() { this._rememberSelection(); return this._sel.start; }
    get selectionEnd() { this._rememberSelection(); return this._sel.end; }
    get selectionDirection() { return 'forward'; }
    setSelectionRange(start, end) {
      this._sel = { start, end };
      const sel = window.getSelection(); if (!sel) return;
      const a = this._pointAt(start), b = this._pointAt(end), r = document.createRange();
      r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset);
      sel.removeAllRanges(); sel.addRange(r);
    }
    select() { this.setSelectionRange(0, this.value.length); }

    _chips() { return [...this.querySelectorAll(':scope > .dx-pchip')]; }
    _offsetOf(container, offset) {
      const r = document.createRange(); r.setStart(this, 0); r.setEnd(container, offset);
      const holder = document.createElement('div'); holder.append(r.cloneContents());
      return serialize(holder).length;
    }
    _rememberSelection() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !this.contains(sel.anchorNode) || !this.contains(sel.focusNode)) return;
      const r = sel.getRangeAt(0);
      this._sel = { start: this._offsetOf(r.startContainer, r.startOffset), end: this._offsetOf(r.endContainer, r.endOffset) };
    }
    // The DOM point for an offset in the value. Counts visible characters, so the caret spacers cost nothing.
    _pointAt(target) {
      let left = target;
      const kids = [...this.childNodes];
      for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (n.nodeType === 3) {
          let used = 0;
          for (let j = 0; j <= n.data.length; j++) {
            if (used === left && (j === n.data.length || n.data[j] !== ZWSP)) return { node: n, offset: j };
            if (j < n.data.length && n.data[j] !== ZWSP) used++;
          }
          left -= used;
        } else if (n.dataset && n.dataset.token) {
          if (left === 0) return { node: this, offset: i };
          left -= n.dataset.token.length;
          if (left < 0) return { node: this, offset: i + 1 };
        }
      }
      return { node: this, offset: this.childNodes.length };
    }

    _makeChip(seg, index) {
      const negative = this.getAttribute('data-dex-field') === 'negative-prompt';
      const chip = document.createElement('span');
      chip.className = 'dx-pchip'; chip.contentEditable = 'false'; chip.draggable = true; chip.tabIndex = 0;
      chip.dataset.token = seg.token; chip.dataset.wildcardChip = negative ? 'negative' : 'positive';
      chip.title = seg.token + ': drag to move. Arrow keys move, Delete removes, + duplicates, N moves to the other prompt.';
      chip.setAttribute('role', 'group'); chip.setAttribute('aria-label', 'Wildcard ' + seg.token);
      const button = (text, label, attr, run) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = text; b.tabIndex = -1; b.setAttribute('aria-label', label); b.setAttribute(attr, '');
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); run(); });
        return b;
      };
      const name = document.createElement('span'); name.textContent = seg.name;
      const count = document.createElement('small'); count.dataset.bank = seg.name.toLowerCase();
      const known = bankCounts.get(count.dataset.bank); if (known != null) count.textContent = String(known);
      chip.append(
        button('+', 'Duplicate ' + seg.token, 'data-chip-duplicate', () => this._apply(duplicateTokenAt(this.value, this._chips().indexOf(chip)))),
        name, count,
        button('×', 'Remove ' + seg.token, 'data-chip-remove', () => this._apply(removeTokenAt(this.value, this._chips().indexOf(chip)))));
      chip.addEventListener('keydown', e => this._onChipKey(e, chip));
      chip.addEventListener('dragstart', e => {
        dragging = { field: this, index: this._chips().indexOf(chip), chip };
        chip.setAttribute('data-dragging', '');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', seg.token); }
      });
      chip.addEventListener('dragend', () => { chip.removeAttribute('data-dragging'); dragging = null; clearDropMark(); });
      return chip;
    }
    _render(text) {
      const segs = parseSegments(text), nodes = [];
      let index = 0;
      segs.forEach((seg, i) => {
        if (seg.type === 'text') { nodes.push(document.createTextNode(seg.text)); return; }
        if (i === 0) nodes.push(document.createTextNode(ZWSP));
        nodes.push(this._makeChip(seg, index++));
        if (i === segs.length - 1 || segs[i + 1].type === 'token') nodes.push(document.createTextNode(ZWSP));
      });
      this.replaceChildren(...nodes);
      this.toggleAttribute('data-empty', !text);
    }
    // A chip operation: the field changes and whoever listens for input hears it.
    _apply(next, focusChip) {
      this._render(next);
      if (focusChip != null && this._chips()[focusChip]) this._chips()[focusChip].focus();
      this.dispatchEvent(new Event('input', { bubbles: true }));
    }
    _onChipKey(e, chip) {
      if (e.target !== chip) return;
      const i = this._chips().indexOf(chip), v = this.value;
      let handled = true;
      if (e.key === 'ArrowLeft') this._apply(swapTokens(v, i, -1), Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') this._apply(swapTokens(v, i, 1), Math.min(this._chips().length - 1, i + 1));
      else if (e.key === 'Delete' || e.key === 'Backspace') { this._apply(removeTokenAt(v, i)); this.focus(); }
      else if (e.key === '+' || e.key === '=') this._apply(duplicateTokenAt(v, i), i + 1);
      else if (e.key === 'n' || e.key === 'N') this._moveAcross(i);
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    }
    _otherField() {
      const mine = this.getAttribute('data-dex-field');
      const other = mine === 'prompt' ? 'negative-prompt' : mine === 'negative-prompt' ? 'prompt' : null;
      return other && document.querySelector('dex-prompt-field[data-dex-field="' + other + '"]:not([disabled])');
    }
    _moveAcross(index) {
      const other = this._otherField(); if (!other) return;
      const token = matchTokens(this.value)[index].token;
      other._apply(insertPiece(other.value, token).text);
      this._apply(removeTokenAt(this.value, index));
    }
    _onInput(e) {
      if (e && e.isComposing) return;
      const text = serialize(this);
      this.toggleAttribute('data-empty', !text);
      const typedToken = [...this.childNodes].some(n => n.nodeType === 3 && new RegExp(TOKEN_SOURCE).test(n.data));
      if (typedToken) {
        this._rememberSelection();
        const sel = this._sel;
        this._render(text);
        this.setSelectionRange(Math.min(sel.start, text.length), Math.min(sel.end, text.length));
      } else this._rememberSelection();
    }
    _onPaste(e) {
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (text == null) return;
      e.preventDefault();
      document.execCommand('insertText', false, text);
    }
    _onCopy(e, cut) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed || !e.clipboardData) return;
      const holder = document.createElement('div'); holder.append(sel.getRangeAt(0).cloneContents());
      e.clipboardData.setData('text/plain', serialize(holder));
      e.preventDefault();
      if (cut) document.execCommand('delete');
    }
    _dropOffset(e) {
      const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (!range || !this.contains(range.startContainer)) return { offset: this.value.length, range: null };
      return { offset: this._offsetOf(range.startContainer, range.startOffset), range };
    }
    _onDragOver(e) {
      if (!dragging || this.hasAttribute('disabled')) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const { range } = this._dropOffset(e);
      const rect = range && (range.getClientRects()[0] || range.getBoundingClientRect());
      if (!rect || !rect.height) { clearDropMark(); return; }
      if (!dropMark) { dropMark = document.createElement('div'); dropMark.className = 'dx-pchip-drop'; document.body.appendChild(dropMark); }
      Object.assign(dropMark.style, { left: rect.left - 1 + 'px', top: rect.top + 'px', height: rect.height + 'px' });
    }
    _onDrop(e) {
      if (!dragging || this.hasAttribute('disabled')) return;
      e.preventDefault();
      clearDropMark();
      const { field, index } = dragging, { offset } = this._dropOffset(e);
      dragging = null;
      if (field === this) { this._apply(moveTokenTo(this.value, index, offset)); return; }
      const token = matchTokens(field.value)[index].token;
      this._apply(insertPiece(this.value, token, offset).text);
      field._apply(removeTokenAt(field.value, index));
    }
  }
  if (!customElements.get('dex-prompt-field')) customElements.define('dex-prompt-field', DexPromptField);
  return api;
});
