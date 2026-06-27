// dc-runtime.js — a small runtime that lets the DexDiffusion ".dc" prototype run as a
// real web page. The prototype was authored for a proprietary reactive runtime that was
// not shipped with the handoff. This file reimplements exactly the surface API the
// prototype uses — no more:
//
//   * React.createElement            (the component builds vnode trees with it)
//   * class DCLogic { state; setState; componentDidMount; ... }
//   * an HTML template using {{ binding }}, onClick / onChange, value / checked,
//     <sc-if value="{{ cond }}"> and <sc-for list="{{ arr }}" as="item">
//
// Rendering strategy: compile the template once into real DOM, then PATCH bind-points
// on each render (rather than rebuilding innerHTML). This keeps form fields stable so
// typing in a textarea/input does not lose focus when state updates.

(function () {
  'use strict';

  // -- React.createElement shim ------------------------------------------------
  // Returns a plain vnode; renderVNode() turns it into real DOM.
  const React = {
    createElement(type, props, ...children) {
      return {
        __vnode: true,
        type,
        props: props || {},
        children: children.flat(Infinity).filter((c) => c != null && c !== false),
      };
    },
  };
  window.React = React;

  // CSS properties that take unitless numeric values (mirrors React's list).
  const UNITLESS = new Set([
    'animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice',
    'borderImageWidth', 'boxFlex', 'boxFlexGroup', 'boxOrdinalGroup', 'columnCount',
    'columns', 'flex', 'flexGrow', 'flexShrink', 'flexOrder', 'gridArea', 'gridRow',
    'gridRowEnd', 'gridRowStart', 'gridColumn', 'gridColumnEnd', 'gridColumnStart',
    'fontWeight', 'lineHeight', 'opacity', 'order', 'orphans', 'tabSize', 'widows',
    'zIndex', 'zoom', 'fillOpacity', 'floodOpacity', 'stopOpacity', 'strokeOpacity',
    'strokeWidth',
  ]);

  function camelToKebab(s) {
    return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  }

  function applyStyle(el, styleObj) {
    el.style.cssText = '';
    for (const [k, v] of Object.entries(styleObj)) {
      if (v == null || v === false) continue;
      let val = v;
      if (typeof v === 'number' && !UNITLESS.has(k)) val = v + 'px';
      el.style.setProperty(camelToKebab(k), String(val));
    }
  }

  function applyVNodeProps(el, props) {
    for (const [k, val] of Object.entries(props)) {
      if (k === 'key') continue;
      if (k === 'style' && val && typeof val === 'object') {
        applyStyle(el, val);
      } else if (k === 'className') {
        el.setAttribute('class', val);
      } else if (/^on[A-Z]/.test(k) && typeof val === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), val);
      } else if (k === 'value' || k === 'checked' || k === 'selected') {
        el[k] = val;
      } else if (val === false || val == null) {
        // skip falsy attributes
      } else {
        el.setAttribute(k, val === true ? '' : val);
      }
    }
  }

  // vnode | string | number | Node -> DOM Node (or null)
  function renderVNode(v) {
    if (v == null || v === false) return null;
    if (v instanceof Node) return v;
    if (typeof v === 'string' || typeof v === 'number') {
      return document.createTextNode(String(v));
    }
    if (!v.__vnode) return document.createTextNode(String(v));
    const el = document.createElement(v.type);
    applyVNodeProps(el, v.props);
    for (const child of v.children) {
      const n = renderVNode(child);
      if (n) el.appendChild(n);
    }
    return el;
  }

  function isRenderable(v) {
    return v instanceof Node || (v && typeof v === 'object' && v.__vnode);
  }

  // -- DCLogic base class ------------------------------------------------------
  let scheduled = false;
  const dirty = new Set();
  function flush() {
    scheduled = false;
    const insts = [...dirty];
    dirty.clear();
    for (const inst of insts) if (inst.__render) inst.__render();
  }
  function scheduleRender(inst) {
    dirty.add(inst);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  }

  class DCLogic {
    constructor() {
      if (!this.state) this.state = {};
    }
    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state) : patch;
      this.state = Object.assign({}, this.state, next);
      scheduleRender(this);
    }
  }
  window.DCLogic = DCLogic;

  // -- Template binding --------------------------------------------------------
  // Split a string into static/expr segments around {{ ... }}.
  function parseSegments(str) {
    const out = [];
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) out.push({ t: 'lit', v: str.slice(last, m.index) });
      out.push({ t: 'expr', v: m[1].trim() });
      last = m.index + m[0].length;
    }
    if (last < str.length) out.push({ t: 'lit', v: str.slice(last) });
    return out;
  }
  const hasExpr = (str) => /\{\{/.test(str);
  const bareExpr = (str) => str.replace(/\{\{\s*|\s*\}\}/g, '').trim();

  function resolve(expr, vals, scope) {
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (expr.indexOf('.') !== -1) {
      const parts = expr.split('.');
      const head = parts[0];
      let base = scope && head in scope ? scope[head] : vals[head];
      for (let i = 1; i < parts.length; i++) {
        if (base == null) return undefined;
        base = base[parts[i]];
      }
      return base;
    }
    return scope && expr in scope ? scope[expr] : vals[expr];
  }

  const EVENT_MAP = {
    onclick: 'click', onchange: 'input', oninput: 'input', onkeydown: 'keydown',
    onkeyup: 'keyup', onsubmit: 'submit', onblur: 'blur', onfocus: 'focus',
  };

  // ctx = { vals } shared mutable holder so event handlers always see latest bindings.
  function makeBinder(node, scope, ctx) {
    // Element ---------------------------------------------------------------
    if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'sc-if') return makeIfBinder(node, scope, ctx);
      if (tag === 'sc-for') return makeForBinder(node, scope, ctx);

      const el = document.createElement(node.tagName);
      const dynAttrs = [];
      let valueExpr = null, checkedExpr = null;

      for (const attr of Array.from(node.attributes)) {
        const name = attr.name;
        const value = attr.value;
        if (name.indexOf('hint-') === 0) continue; // design-tool hints
        const lower = name.toLowerCase();
        if (EVENT_MAP[lower] && hasExpr(value)) {
          const expr = bareExpr(value);
          const evt = EVENT_MAP[lower];
          el.addEventListener(evt, (e) => {
            const fn = resolve(expr, ctx.vals, scope);
            if (typeof fn === 'function') fn(e);
          });
        } else if (name === 'value' && hasExpr(value)) {
          valueExpr = bareExpr(value);
        } else if (name === 'checked' && hasExpr(value)) {
          checkedExpr = bareExpr(value);
        } else if (hasExpr(value)) {
          dynAttrs.push({ name, segs: parseSegments(value), last: undefined });
        } else {
          el.setAttribute(name, value);
        }
      }

      const childBinders = [];
      for (const child of Array.from(node.childNodes)) {
        const b = makeBinder(child, scope, ctx);
        if (b) { childBinders.push(b); b.mount(el); }
      }

      return {
        get node() { return el; },
        mount(parent) { parent.appendChild(el); },
        patch(vals) {
          for (const a of dynAttrs) {
            const str = a.segs
              .map((s) => (s.t === 'lit' ? s.v : String(resolve(s.v, vals, scope) ?? '')))
              .join('');
            if (str !== a.last) { el.setAttribute(a.name, str); a.last = str; }
          }
          if (valueExpr != null && document.activeElement !== el) {
            const v = resolve(valueExpr, vals, scope);
            const str = v == null ? '' : String(v);
            if (el.value !== str) el.value = str;
          }
          if (checkedExpr != null) {
            const v = resolve(checkedExpr, vals, scope);
            el.checked = v === true || v === 'true';
          }
          for (const b of childBinders) b.patch(vals);
        },
      };
    }

    // Text ------------------------------------------------------------------
    if (node.nodeType === 3) {
      const raw = node.nodeValue;
      if (!hasExpr(raw)) {
        const tn = document.createTextNode(raw);
        return { node: tn, mount: (p) => p.appendChild(tn), patch() {} };
      }
      const segs = parseSegments(raw);
      // A "dynamic slot" is a text node holding exactly one {{ expr }} with only
      // insignificant whitespace around it. Such a binding may resolve to a vnode/Node
      // (e.g. {{ imageDisplay }}, {{ toastOverlay }}) and must be rendered as DOM, not
      // stringified. Anything with literal non-whitespace text (e.g. "{{ n }} chars")
      // is treated as interpolated text instead.
      const exprSegs = segs.filter((s) => s.t === 'expr');
      const litTextSegs = segs.filter((s) => s.t === 'lit' && s.v.trim() !== '');
      const dynamicSlot = exprSegs.length === 1 && litTextSegs.length === 0;
      if (dynamicSlot) {
        const slotExpr = exprSegs[0].v;
        const anchor = document.createComment('dc');
        let managed = [];
        return {
          node: anchor,
          mount(p) { p.appendChild(anchor); },
          patch(vals) {
            const v = resolve(slotExpr, vals, scope);
            const parent = anchor.parentNode;
            if (!parent) return;
            for (const n of managed) if (n.parentNode === parent) parent.removeChild(n);
            let newNodes;
            if (isRenderable(v)) {
              const dom = renderVNode(v);
              newNodes = dom ? [dom] : [];
            } else if (v == null || v === '') {
              newNodes = [];
            } else {
              newNodes = [document.createTextNode(String(v))];
            }
            const ref = anchor.nextSibling;
            for (const n of newNodes) parent.insertBefore(n, ref);
            managed = newNodes;
          },
        };
      }
      const tn = document.createTextNode('');
      let last;
      return {
        node: tn,
        mount(p) { p.appendChild(tn); },
        patch(vals) {
          const str = segs
            .map((s) => (s.t === 'lit' ? s.v : String(resolve(s.v, vals, scope) ?? '')))
            .join('');
          if (str !== last) { tn.nodeValue = str; last = str; }
        },
      };
    }

    // Comment ---------------------------------------------------------------
    if (node.nodeType === 8) {
      const c = document.createComment(node.nodeValue);
      return { node: c, mount: (p) => p.appendChild(c), patch() {} };
    }
    return null;
  }

  // <sc-if value="{{ cond }}"> ... </sc-if>
  function makeIfBinder(node, scope, ctx) {
    const condExpr = bareExpr(node.getAttribute('value') || 'false');
    const templateChildren = Array.from(node.childNodes);
    const anchor = document.createComment('sc-if');
    let instance = null; // array of child binders while active

    function teardown() {
      if (!instance) return;
      for (const b of instance) {
        const n = b.node;
        if (n && n.parentNode) n.parentNode.removeChild(n);
      }
      instance = null;
    }

    return {
      node: anchor,
      mount(p) { p.appendChild(anchor); },
      patch(vals) {
        const cond = !!resolve(condExpr, vals, scope);
        const parent = anchor.parentNode;
        if (!parent) return;
        if (cond && !instance) {
          instance = [];
          const ref = anchor.nextSibling;
          for (const tc of templateChildren) {
            const b = makeBinder(tc, scope, ctx);
            if (!b) continue;
            parent.insertBefore(b.node, ref);
            instance.push(b);
          }
          for (const b of instance) b.patch(vals);
        } else if (cond && instance) {
          for (const b of instance) b.patch(vals);
        } else if (!cond && instance) {
          teardown();
        }
      },
    };
  }

  // <sc-for list="{{ arr }}" as="item"> ... </sc-for>
  function makeForBinder(node, scope, ctx) {
    const listExpr = bareExpr(node.getAttribute('list') || '');
    const asName = node.getAttribute('as') || 'item';
    const templateChildren = Array.from(node.childNodes);
    const anchor = document.createComment('sc-for');
    let managed = []; // flat list of mounted DOM nodes
    let lastList;     // reference of the list rendered last time

    return {
      node: anchor,
      mount(p) { p.appendChild(anchor); },
      patch(vals) {
        const parent = anchor.parentNode;
        if (!parent) return;
        const list = resolve(listExpr, vals, scope) || [];
        // The list is replaced (never mutated) when its data changes, so a
        // reference check lets us skip rebuilding all items on unrelated renders.
        if (list === lastList && managed.length) return;
        lastList = list;
        for (const n of managed) if (n.parentNode === parent) parent.removeChild(n);
        managed = [];
        const ref = anchor.nextSibling;
        for (const item of list) {
          const itemScope = Object.assign({}, scope, { [asName]: item });
          for (const tc of templateChildren) {
            const b = makeBinder(tc, itemScope, ctx);
            if (!b) continue;
            b.patch(vals);
            parent.insertBefore(b.node, ref);
            managed.push(b.node);
          }
        }
      },
    };
  }

  // -- Mount entry point -------------------------------------------------------
  function mount(ComponentClass, templateRoot, container) {
    const inst = new ComponentClass();
    const ctx = { vals: {} };
    const rootBinder = makeBinder(templateRoot, null, ctx);
    rootBinder.mount(container);

    function render() {
      const vals = inst.renderVals ? inst.renderVals() : (inst.render ? inst.render() : {});
      ctx.vals = vals;
      rootBinder.patch(vals);
    }
    inst.__render = render;
    render();
    if (typeof inst.componentDidMount === 'function') inst.componentDidMount();
    window.addEventListener('beforeunload', () => {
      if (typeof inst.componentWillUnmount === 'function') inst.componentWillUnmount();
    });
    return inst;
  }

  window.DCRuntime = { mount, renderVNode };
})();
