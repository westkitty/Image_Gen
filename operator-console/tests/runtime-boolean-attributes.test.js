'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('template boolean attributes follow their values while data attributes stay strings', () => {
  const dom = new JSDOM('<div id="root"></div><template id="tpl"><section><textarea disabled="{{ disabled }}" data-flag="{{ disabled }}"></textarea><details open="{{ opened }}"></details><input id="static-disabled" disabled></section></template>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  try {
    w.eval(fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/dc-runtime.js'), 'utf8'));
    class Component extends w.DCLogic {
      renderVals() { return { disabled: this.flag, opened: this.flag }; }
    }
    const app = w.DCRuntime.mount(Component, w.document.querySelector('#tpl').content.firstElementChild, w.document.querySelector('#root'));
    const textarea = w.document.querySelector('textarea'), details = w.document.querySelector('details');
    for (const flag of [null, false, '', 'false', true, 'disabled', false]) {
      app.flag = flag; app.__render();
      const expected = flag === true || flag === 'disabled';
      assert.equal(textarea.disabled, expected, `disabled follows ${JSON.stringify(flag)}`);
      assert.equal(details.open, expected, `open follows ${JSON.stringify(flag)}`);
      assert.equal(w.document.querySelector('#static-disabled').disabled, true, 'static boolean attributes remain present');
      assert.equal(textarea.getAttribute('data-flag'), flag == null ? '' : String(flag));
    }
  } finally { w.close(); }
});
