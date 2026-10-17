// PR-23: A1111 keyboard prompt editing, ported from the pinned source (82a973c0) javascript/edit-attention.js and
// javascript/edit-order.js. Ctrl/Cmd+Up/Down raises/lowers the (attention:weight) of the selection, the enclosing
// (…)/[…]/<…> block or the word at the caret; Alt+Left/Right moves comma-separated prompt elements. Pure functions plus
// one keydown listener limited to the prompt / negative-prompt textareas; the field's own input handler receives an
// 'input' event so application state follows (upstream updateInput).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexEditAttention = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // shared_options.py defaults: keyedit_precision_attention 0.1, keyedit_precision_extra 0.05,
  // keyedit_delimiters ".,\/!?%^*;:{}=`~() " + Tab / CR / LF, keyedit_move true.
  const DEFAULTS = { precisionAttention: 0.1, precisionExtra: 0.05, delimiters: '.,\\/!?%^*;:{}=`~() \t\r\n' };

  // -> { text, selectionStart, selectionEnd } | null (nothing to do). Mirrors keyupEditAttention step by step.
  function editAttention(text0, selStart, selEnd, isPlus, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    let text = String(text0), selectionStart = selStart, selectionEnd = selEnd;
    function selectCurrentParenthesisBlock(OPEN, CLOSE) {
      if (selectionStart !== selectionEnd) return false;
      const before = text.substring(0, selectionStart);
      const beforeParen = before.lastIndexOf(OPEN);
      if (beforeParen === -1) return false;
      const beforeClosingParen = before.lastIndexOf(CLOSE);
      if (beforeClosingParen !== -1 && beforeClosingParen > beforeParen) return false;
      const after = text.substring(selectionStart);
      const afterParen = after.indexOf(CLOSE);
      if (afterParen === -1) return false;
      const afterOpeningParen = after.indexOf(OPEN);
      if (afterOpeningParen !== -1 && afterOpeningParen < afterParen) return false;
      const parenContent = text.substring(beforeParen + 1, selectionStart + afterParen);
      if (/.*:-?[\d.]+/s.test(parenContent)) {
        const lastColon = parenContent.lastIndexOf(':');
        selectionStart = beforeParen + 1; selectionEnd = selectionStart + lastColon;
      } else {
        selectionStart = beforeParen + 1; selectionEnd = selectionStart + parenContent.length;
      }
      return true;
    }
    function selectCurrentWord() {
      if (selectionStart !== selectionEnd) return false;
      const d = o.delimiters;
      while (!d.includes(text[selectionStart - 1]) && selectionStart > 0) selectionStart--;
      while (!d.includes(text[selectionEnd]) && selectionEnd < text.length) selectionEnd++;
      while (text[selectionStart] === ' ' && selectionStart < selectionEnd) selectionStart++;
      while (text[selectionEnd - 1] === ' ' && selectionEnd > selectionStart) selectionEnd--;
      return true;
    }
    if (!selectCurrentParenthesisBlock('<', '>') && !selectCurrentParenthesisBlock('(', ')') && !selectCurrentParenthesisBlock('[', ']')) selectCurrentWord();

    let closeCharacter = ')', delta = o.precisionAttention;
    const start = selectionStart > 0 ? text[selectionStart - 1] : '', end = text[selectionEnd];
    if (start === '<') { closeCharacter = '>'; delta = o.precisionExtra; }
    else if ((start === '(' && end === ')') || (start === '[' && end === ']')) {   // convert old-style (((emphasis)))
      let numParen = 0;
      while (text[selectionStart - numParen - 1] === start && text[selectionEnd + numParen] === end) numParen++;
      let w = start === '[' ? (1 / 1.1) ** numParen : 1.1 ** numParen;
      w = Math.round(w / o.precisionAttention) * o.precisionAttention;
      text = text.slice(0, selectionStart - numParen) + '(' + text.slice(selectionStart, selectionEnd) + ':' + w + ')' + text.slice(selectionEnd + numParen);
      selectionStart -= numParen - 1; selectionEnd -= numParen - 1;
    } else if (start !== '(') {
      while (selectionEnd > selectionStart && text[selectionEnd - 1] === ' ') selectionEnd--;
      if (selectionStart === selectionEnd) return null;
      text = text.slice(0, selectionStart) + '(' + text.slice(selectionStart, selectionEnd) + ':1.0)' + text.slice(selectionEnd);
      selectionStart++; selectionEnd++;
    }
    if (text[selectionEnd] !== ':') return null;
    const weightLength = text.slice(selectionEnd + 1).indexOf(closeCharacter) + 1;
    let weight = parseFloat(text.slice(selectionEnd + 1, selectionEnd + weightLength));
    if (isNaN(weight)) return null;
    weight += isPlus ? delta : -delta;
    weight = parseFloat(weight.toPrecision(12));
    if (Number.isInteger(weight)) weight += '.0';
    if (closeCharacter === ')' && Number(weight) === 1) {
      const endParenPos = text.substring(selectionEnd).indexOf(')');
      text = text.slice(0, selectionStart - 1) + text.slice(selectionStart, selectionEnd) + text.slice(selectionEnd + endParenPos + 1);
      selectionStart--; selectionEnd--;
    } else {
      text = text.slice(0, selectionEnd + 1) + weight + text.slice(selectionEnd + weightLength);
    }
    return { text, selectionStart, selectionEnd };
  }

  // edit-order.js keyupEditOrder. -> { text, selectionStart, selectionEnd } | null.
  function editOrder(text, selectionStart, selectionEnd, isLeft) {
    const items = String(text).split(',');
    const indexStart = (text.slice(0, selectionStart).match(/,/g) || []).length;
    const indexEnd = (text.slice(0, selectionEnd).match(/,/g) || []).length;
    const range = indexEnd - indexStart + 1;
    if (isLeft && indexStart > 0) {
      items.splice(indexStart - 1, 0, ...items.splice(indexStart, range));
      return { text: items.join(), selectionStart: items.slice(0, indexStart - 1).join().length + (indexStart === 1 ? 0 : 1), selectionEnd: items.slice(0, indexEnd).join().length };
    }
    if (!isLeft && indexEnd < items.length - 1) {
      items.splice(indexStart + 1, 0, ...items.splice(indexStart, range));
      return { text: items.join(), selectionStart: items.slice(0, indexStart + 1).join().length + 1, selectionEnd: items.slice(0, indexEnd + 2).join().length };
    }
    return null;
  }

  const PROMPT_FIELDS = 'textarea[data-dex-field="prompt"], textarea[data-dex-field="negative-prompt"], textarea[data-edit-prompt], textarea[data-edit-negative], textarea[data-prompt-edit]';
  function install(win) {
    if (!win || win.__dexEditAttention) return;
    win.__dexEditAttention = true;
    win.addEventListener('keydown', ev => {
      const t = ev.target;
      if (!t || !t.matches || !t.matches(PROMPT_FIELDS)) return;
      let r = null;
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) r = editAttention(t.value, t.selectionStart, t.selectionEnd, ev.key === 'ArrowUp');
      else if (ev.altKey && !ev.metaKey && !ev.ctrlKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) r = editOrder(t.value, t.selectionStart, t.selectionEnd, ev.key === 'ArrowLeft');
      else return;
      ev.preventDefault();
      if (!r) return;
      t.value = r.text;
      t.setSelectionRange(r.selectionStart, r.selectionEnd);
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }, true);
  }
  if (typeof window !== 'undefined') install(window);
  return { DEFAULTS, editAttention, editOrder, install, PROMPT_FIELDS };
});
