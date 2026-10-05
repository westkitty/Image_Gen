'use strict';
// One executable, measured 12 x 5 x 3 acceptance specification. No screenshots by default.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { startServer, launchBrowser, installImageFixtures, runCleanups } = require('./helpers');
const spec = require('./interaction-matrix.spec.json');
const out = process.env.DEX_MATRIX_OUTPUT_DIR || path.join(__dirname, '../../../output/rev19');
const select = (process.env.DEX_MATRIX_SLICE || '').split(',').filter(Boolean);
const cells = [];
const apiSnapshots = new Map();
const network = new WeakMap();
const check = (checks, name, applicable, failures, measures) => checks.push({ contract: name, status: applicable ? (failures.length ? 'FAIL' : 'PASS') : 'N/A', failures, measures });
const fixture = 'rev19-matrix-owned.png';
async function settle(page){
  const pending=network.get(page),deadline=Date.now()+30000;
  await new Promise(r=>setTimeout(r,100));
  while(pending.count || Date.now()-pending.last<500){if(Date.now()>deadline)throw new Error('Screen requests did not settle');await new Promise(r=>setTimeout(r,100));}
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}

async function configure(page, base, screen, shell) {
  const initial=page.url()==='about:blank';
  if(initial){
  const pending={count:0,last:Date.now()};network.set(page,pending);
  const isEventStream = request => { try { return new URL(request.url()).pathname === '/api/events'; } catch (_) { return false; } };
  page.on('request',request=>{if(isEventStream(request))return;pending.count++;pending.last=Date.now();});
  const finish=request=>{if(isEventStream(request))return;pending.count=Math.max(0,pending.count-1);pending.last=Date.now();};
  page.on('requestfinished',finish);page.on('requestfailed',finish);
  await installImageFixtures(page, { [fixture]: { w: 640, h: 384, meta: { target: 'sd15', seed: 42, steps: 20, operation: 'txt2img', prompt_saved: false } } });
  await page.route('**/api/library/images**', r => r.fulfill({ json: { total: 1, items: [{ id: fixture, url: '/api/images/' + fixture, width: 640, height: 384, keeper: false, meta: { target: 'sd15', seed: 42 }, children: [], ancestors: [] }] } }));
  await page.route('**/api/media/library**', r => r.fulfill({ json: { total: 0, items: [] } }));
  await page.route(/\/api\/library(?:\?.*)?$/,r=>r.fulfill({json:{items:[],counts:{image:0,voice:0,music:0,video:0}}}));
  await page.route(/\/api\/runs(?:\?.*)?$/, r => r.fulfill({json:{runs:[],total:0}}));
  await page.route('**/api/run-index**', r => r.fulfill({json:{items:[],total:0,hasMore:false}}));
  // Blocks accidental write/generation from any keyboard probe; read-only endpoints remain real.
  await page.route('**/api/**', async r => {
    if(r.request().method()==='POST' && new URL(r.request().url()).pathname==='/api/models/secondary/activate')return r.fulfill({json:{ok:true,activeSecondaryModel:r.request().postDataJSON().target,modelState:{activeSecondaryModel:r.request().postDataJSON().target}}});
    if (!['GET', 'HEAD'].includes(r.request().method())) return r.fulfill({ status: 409, json: { error: 'Matrix is read-only', stage: 'test-read-only' } });
    const url=new URL(r.request().url()),key=url.pathname+url.search;
    if(/^\/api\/(images|library|run-index|runs|media\/library)/.test(url.pathname))return r.fallback();
    if(url.pathname === '/api/events')return r.fallback();
    // Snapshot unchanged read-only capability/worker/config endpoints once,
    // avoiding 180 duplicate remote status probes. Every cell renders real UI.
    if(!apiSnapshots.has(key))apiSnapshots.set(key,(async()=>{const response=await r.fetch({timeout:20000});return{status:response.status(),headers:response.headers(),body:await response.body()};})());
    await r.fulfill(await apiSnapshots.get(key));
  });
  await page.addInitScript(v => localStorage.setItem('dex_version', String(v)), shell);
  await page.goto(base + '/dexdiffusion/', {timeout:30000});
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  }
  const key = screen.startsWith('Edit') ? 'edit' : screen.toLowerCase();
  if (key === 'edit') {
    await page.evaluate(async ([id, layout]) => { await __dex.openImageInEdit(id, 'inpaint'); __dex.edSet({ layout }); }, [fixture, screen === 'Edit Studio' ? 'studio' : 'compact']);
    await page.waitForSelector('[data-edit-workbench]');
  } else {
    await page.evaluate(k => __dex.setScreen(k), key);
    if (key === 'library') await page.evaluate(async id => { await __dex.loadLibraryImages(); await __dex.selectLibraryImage(id); }, fixture);
    if (key === 'enhance') await page.evaluate(id => __dex.sendToEnhance(id), fixture);
    if (key === 'create') await page.evaluate(id => { __dex.wsSet({results:[{index:0,status:'DONE',imageId:id,imageUrl:'/api/images/'+id,width:640,height:384,target:'sd15',seed:42}],activeIndex:0}); __dex.setState({currentImageSrc:'/api/images/'+id,lastSeed:42}); }, fixture);
  }
  await page.waitForFunction(v => document.querySelector('[data-v]')?.getAttribute('data-v') === String(v), shell);
  // A reused page's lifecycle networkidle refers to its old navigation. Await
  // actual outstanding requests after each screen's lazy capability loads.
  await settle(page);
  await page.waitForFunction(()=>__dex.state.toasts.length===0,{timeout:10000});
  await page.evaluate(() => { clearInterval(__dex._pingTimer); clearInterval(__dex._resTimer); });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.DexA11y?.sweep());
  const presets=page.getByRole('button',{name:/^[▸▾] Presets$/});
  if(await presets.count() && await presets.isVisible())await presets.click();
  await page.evaluate(()=>document.querySelectorAll('details').forEach(n=>n.open=true));
  if(process.env.DEX_MATRIX_DEBUG==='1')await page.evaluate(()=>{window.__matrixRenders=[];if(!__dex.__matrixOriginalSetState){__dex.__matrixOriginalSetState=__dex.setState;__dex.setState=function(p){window.__matrixRenders.push({keys:typeof p==='function'?['function']:Object.keys(p),stack:new Error().stack.split('\n').slice(1,4)});return this.__matrixOriginalSetState(p);};}});
}

async function measure(page) {
  return page.evaluate(({ mobile, tol }) => {
    const rendered=n=>{for(let p=n;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||p.hidden||p.inert)return false;if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope > summary')?.contains(n))return false;}return true;};
    const visible = n => { const b = n.getBoundingClientRect(); return rendered(n) && b.width > 0 && b.height > 0; };
    const name = n => n.getAttribute('aria-label') || (n.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || (n.labels ? [...n.labels].map(l => l.textContent).join(' ').trim() : '') || n.getAttribute('title') || n.getAttribute('placeholder') || (n.matches('button,a,summary,[role="button"]') ? n.textContent.trim() : '');
    const candidates=[...document.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],summary,[role="button"]')];
    const zeroSized=candidates.filter(rendered).filter(n=>{const b=n.getBoundingClientRect();return b.width===0||b.height===0;}).map(n=>name(n)||n.tagName);
    const nodes = candidates.filter(visible);
    nodes.forEach((n, i) => n.setAttribute('data-matrix-control', String(i)));
    const controls = nodes.map((n, i) => { const b = n.getBoundingClientRect(), s = getComputedStyle(n); let left=Math.max(0,b.left),right=Math.min(innerWidth,b.right),top=Math.max(0,b.top),bottom=Math.min(innerHeight,b.bottom); for(let p=n.parentElement;p;p=p.parentElement){const ps=getComputedStyle(p),pb=p.getBoundingClientRect();if(['auto','scroll','hidden','clip'].includes(ps.overflowX)){left=Math.max(left,pb.left);right=Math.min(right,pb.right);}if(['auto','scroll','hidden','clip'].includes(ps.overflowY)){top=Math.max(top,pb.top);bottom=Math.min(bottom,pb.bottom);}} return { i, tag: n.tagName, type: n.type || '', name: name(n).slice(0,110), disabled: n.matches(':disabled') || n.getAttribute('aria-disabled') === 'true', visuallyDisabled:!!n.closest('[data-ctl-off="true"]'), tabIndex: n.tabIndex, width: b.width, height: b.height, x: b.x, y: b.y, visibleRect:{left,right,top,bottom}, minHeight: parseFloat(s.minHeight) || 0, overflowX: s.overflowX, clipped: n.scrollWidth > n.clientWidth + tol && s.textOverflow !== 'ellipsis', text: n.textContent.trim().slice(0,90), viewport: right>left && bottom>top }; });
    const intersections = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].contains(nodes[j]) || nodes[j].contains(nodes[i])) continue;
      // Library intentionally overlays its separately named details button on a
      // thumbnail's image hit area. This is not text/control intersection.
      if(nodes[i].closest('[data-lib-thumb]')===nodes[j].closest('[data-lib-thumb]') && nodes[i].closest('[data-lib-thumb]') && (nodes[i].tagName==='IMG'||nodes[j].tagName==='IMG'))continue;
      const a = controls[i], b = controls[j]; if (!a.viewport || !b.viewport) continue;
      const w = Math.min(a.visibleRect.right,b.visibleRect.right)-Math.max(a.visibleRect.left,b.visibleRect.left), h = Math.min(a.visibleRect.bottom,b.visibleRect.bottom)-Math.max(a.visibleRect.top,b.visibleRect.top);
      if (w > 2 && h > 2) intersections.push([a.name,b.name,Math.round(w),Math.round(h)]);
    }
    const panes = [...document.querySelectorAll('[data-scroll-pane],[data-edit-workbench]')].filter(rendered).map(n => {const b=n.getBoundingClientRect();return {width:b.width,height:b.height,left:b.left,right:b.right,overflow:n.scrollWidth-n.clientWidth};});
    const fields = nodes.filter(n=>n.matches('input,select,textarea'));
    const constraintFields = fields.filter(n=>n.matches('input:not(:disabled)') && !['range','checkbox','radio'].includes(n.type) && (n.required || n.hasAttribute('min') || n.hasAttribute('max') || n.hasAttribute('pattern'))).map(n=>({i:Number(n.getAttribute('data-matrix-control')),type:n.type,required:n.required,min:n.min,max:n.max}));
    return { documentOverflow: Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)-innerWidth, panes, zeroSized, intersections, controls, unnamed: controls.filter(c=>!c.name), fieldCount:fields.length, unnamedFields:fields.filter(n=>!name(n)).map(n=>n.outerHTML.slice(0,180)), constraints:constraintFields, minimumHeight:mobile?44:32 };
  }, { mobile: page.viewportSize().width <= 600, tol: spec.tolerancePixels });
}

async function keyboard(page, m) {
  const failures = [], seen = new Set(), focusedStyles = [];
  const expected = m.controls.filter(c => !c.disabled && c.tabIndex >= 0);
  // Real browser Tab traversal, including offscreen controls in scroll panes.
  await page.evaluate(() => { document.activeElement?.blur(); document.body.setAttribute('tabindex','-1'); document.body.focus(); });
  for (let i=0; i<m.controls.length+8; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const n=document.activeElement,s=getComputedStyle(n); return {id:n.getAttribute('data-matrix-control'),outline:s.outlineStyle,width:s.outlineWidth,shadow:s.boxShadow}; });
    if (f.id !== null) { seen.add(Number(f.id)); focusedStyles.push(f); }
  }
  for (const c of expected) if (!seen.has(c.i)) failures.push('Tab unreachable: '+c.name);
  for (const f of focusedStyles) if ((f.outline==='none'||parseFloat(f.width)===0) && f.shadow==='none') failures.push('Focus uninspectable: '+m.controls[f.id]?.name);
  return {failures:[...new Set(failures)], measures:{expected:expected.length,reached:seen.size,focusSamples:focusedStyles.length,unreached:expected.filter(c=>!seen.has(c.i)).map(c=>({i:c.i,name:c.name})),firstFocusSamples:focusedStyles.slice(0,8),...(process.env.DEX_MATRIX_DEBUG==='1'?{renders:await page.evaluate(()=>window.__matrixRenders.slice(-12))}:{})}};
}

async function forms(page, m) {
  const failures = [...m.unnamedFields.map(x=>'Unlabelled field: '+x)], measures={fields:m.fieldCount,toggles:0,validation:0,selects:0,details:0};
  for (const c of m.controls.filter(c=>!c.disabled && ['checkbox','radio'].includes(c.type))) {
    await measure(page);
    const named=page.getByRole(c.type,{name:c.name,exact:true});
    const loc=await named.count()===1?named:page.locator(`[data-matrix-control="${c.i}"]`); await loc.focus();
    const before=await loc.isChecked(); await page.keyboard.press('Space');
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const after=await loc.isChecked(); if (c.type==='checkbox' && before===after) failures.push('Space did not toggle: '+c.name);
    if (c.type==='radio' && !after) failures.push('Space did not select: '+c.name);
    if (c.type==='checkbox') {await loc.focus();await page.keyboard.press('Space');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));} measures.toggles++;
  }
  for (const c of m.constraints) {
    await measure(page);
    const result=await page.locator(`[data-matrix-control="${c.i}"]`).evaluate(n=>{const old=n.value;n.value=n.required?'':(n.max?String(Number(n.max)+1):String(Number(n.min)-1));const r={valid:n.validity.valid,message:n.validationMessage};n.value=old;return r;});
    if (result.valid || !result.message) failures.push('Constraint has no inspectable native error: '+m.controls[c.i].name); measures.validation++;
  }
  const selects=page.locator('select:visible:not(:disabled)');
  for (let i=0;i<await selects.count();i++){ const loc=selects.nth(i),s=await loc.evaluate(n=>({index:n.selectedIndex,count:n.options.length}));if(s.count<2)continue;const keys=s.index===s.count-1?['ArrowUp','ArrowDown']:['ArrowDown','ArrowUp'];for(const key of keys){await loc.focus();await page.keyboard.press(key);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}await page.keyboard.press('Escape');measures.selects++;if(!await loc.evaluate(n=>document.activeElement===n))failures.push('Select loses coherent focus');if(await loc.evaluate(n=>n.selectedIndex)!==s.index)failures.push('Native selection round trip changed field'); }
  const details=page.locator('summary:visible');
  for(let i=0;i<await details.count();i++){const l=details.nth(i);await l.focus();const before=await l.evaluate(n=>n.parentElement.open);await page.keyboard.press('Enter');const after=await l.evaluate(n=>n.parentElement.open);if(before===after)failures.push('Summary Enter failed');await page.keyboard.press('Enter');measures.details++;}
  return {failures,measures};
}

async function dialogs(page) {
  const failures=[], measures={exercised:0};
  for(const [openerSelector,dialogSelector]of [['[data-fullscreen]:not([data-no-fullscreen] *):visible','[data-lightbox]'],['[data-detailer-open]:visible','[data-detailer-dialog]']]){
    const trigger=page.locator(openerSelector).first();if(!await trigger.count())continue;
    await trigger.focus();await trigger.evaluate(n=>window.__matrixDialogReturn=n);
    const detailerId=await trigger.getAttribute('data-detailer-open');
    await page.keyboard.press('Enter');const dialog=page.locator(dialogSelector);
    try{await dialog.waitFor({timeout:5000});}catch(e){throw new Error(dialogSelector+' did not open: '+e.message.split('\n')[0]);}
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(await dialog.getAttribute('role')!=='dialog'||await dialog.getAttribute('aria-modal')!=='true')failures.push(dialogSelector+' modal semantics missing');
    const fields=await dialog.evaluate(n=>[...n.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({name:e.getAttribute('aria-label')||e.getAttribute('placeholder')||(e.labels?[...e.labels].map(l=>l.textContent).join(' ').trim():''),disabled:e.matches(':disabled'),type:e.type,height:e.getBoundingClientRect().height})));
    for(const field of fields){if(!field.name)failures.push(dialogSelector+' unlabelled field');if(!['range','checkbox','radio'].includes(field.type)&&field.height+1.5<(page.viewportSize().width<=600?44:32))failures.push(dialogSelector+' undersized field '+field.name);}
    measures.fields=(measures.fields||0)+fields.length;
    if(!await dialog.evaluate(n=>n.contains(document.activeElement)))failures.push(dialogSelector+' initial focus outside dialog');
    const count=await dialog.locator('button:visible:not(:disabled),input:visible:not(:disabled),select:visible:not(:disabled),textarea:visible:not(:disabled)').count();
    for(const key of ['Tab','Shift+Tab'])for(let i=0;i<count+1;i++){
      await page.keyboard.press(key);
      const focus=await dialog.evaluate(n=>{const a=document.activeElement,s=getComputedStyle(a),b=a.getBoundingClientRect();return{inside:n.contains(a),outline:s.outlineStyle,outlineWidth:s.outlineWidth,shadow:s.boxShadow,name:a.getAttribute('aria-label')||a.getAttribute('placeholder')||(a.labels?[...a.labels].map(l=>l.textContent).join(' ').trim():'')||a.textContent.trim(),width:b.width,height:b.height};});
      if(!focus.inside)failures.push(dialogSelector+' '+key+' escaped dialog');
      else {if((focus.outline==='none'||parseFloat(focus.outlineWidth)===0)&&focus.shadow==='none')failures.push(dialogSelector+' focus uninspectable');if(!focus.name)failures.push(dialogSelector+' focused control unnamed');if(focus.width===0||focus.height===0)failures.push(dialogSelector+' zero-sized focused control');}
      measures.focusSamples=(measures.focusSamples||0)+1;
    }
    await page.keyboard.press('Escape');
    try{await dialog.waitFor({state:'detached',timeout:3000});}catch(_){failures.push(dialogSelector+' Escape did not close');}
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
    const restored=detailerId?await page.locator(`[data-detailer-open="${detailerId}"]`).first().evaluate(n=>n===document.activeElement):await page.evaluate(()=>document.activeElement===window.__matrixDialogReturn);
    if(!restored)failures.push(dialogSelector+' focus did not return');measures.exercised++;
  }
  return {failures:[...new Set(failures)],measures};
}

async function popovers(page) {
  const failures=[],measures={exercised:0,options:0};
  const pickers=page.locator('[data-model-picker]:visible');
  for(let i=0;i<await pickers.count();i++){
    const p=pickers.nth(i),trigger=p.locator(':scope > button');await trigger.focus();await page.keyboard.press('Enter');
    const panel=p.locator('[role="listbox"]');if(!await panel.isVisible()){failures.push('Model picker did not open');continue;}
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(!await panel.evaluate(n=>n.contains(document.activeElement)))failures.push('Picker initial focus outside panel');
    const opts=panel.locator('[role="option"]:not(:disabled)');measures.options+=await opts.count();
    if(await opts.count()){await page.keyboard.press('ArrowDown');if(!await opts.first().evaluate(n=>document.activeElement===n))failures.push('ArrowDown did not reach first model');await page.keyboard.press('End');if(!await opts.last().evaluate(n=>document.activeElement===n))failures.push('End did not reach last model');await page.keyboard.press('Home');await page.keyboard.press('Escape');if(await panel.isVisible())failures.push('Escape from option did not close model picker');}
    if(await panel.isVisible()){await panel.locator('input').focus();await page.keyboard.press('Escape');}
    if(!await trigger.evaluate(n=>document.activeElement===n))failures.push('Picker focus return incoherent');
    measures.exercised++;
  }
  return{failures,measures};
}

async function modelDisabledContract(page){
  const failures=[], original=await page.evaluate(()=>__dex.state.target),picker=page.locator('[data-model-picker="create"]'),trigger=picker.locator(':scope > button');
  for(const target of ['sd15',original]){
    await trigger.focus();await page.keyboard.press('Enter');const option=picker.locator(`[data-model-id="${target}"]`);await option.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(t=>__dex.state.target===t,target);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const state=await page.locator('[data-ctl-off]').evaluateAll(nodes=>nodes.filter(n=>['INPUT','SELECT','TEXTAREA'].includes(n.tagName)).map(n=>({off:n.getAttribute('data-ctl-off')==='true',disabled:n.disabled})));
    if(state.some(n=>n.off!==n.disabled))failures.push('Model disabled state mismatch after '+target);
    if(!await trigger.evaluate(n=>document.activeElement===n))failures.push('Keyboard model selection loses focus '+target);
  }
  const preserved=await page.evaluate(()=>{const n=document.createElement('input');n.type='hidden';n.disabled=true;n.setAttribute('data-ctl-off','true');document.body.append(n);DexA11y.sweep();n.setAttribute('data-ctl-off','false');DexA11y.sweep();const yes=n.disabled;n.remove();return yes;});
  if(!preserved)failures.push('Model synchronization enabled independently disabled field');
  return{failures,measures:{targets:['sd15',original],preservesIndependentDisabled:preserved,keyboardSelections:2}};
}

async function navigationLabelContract(page){
  const sample=()=>page.locator('[data-v="2"] header nav [data-tab]').evaluateAll(nodes=>nodes.map(n=>({label:n.textContent.trim(),width:n.getBoundingClientRect().width,content:n.clientWidth,text:n.scrollWidth,clipped:n.scrollWidth>n.clientWidth+1.5})));
  const oldRule=await page.addStyleTag({content:'[data-v="2"] header nav [data-tab]{flex:0 1 auto!important;white-space:normal!important}'});
  const before=await sample();await oldRule.evaluate(n=>n.remove());const after=await sample();
  const failures=after.filter(n=>n.clipped).map(n=>'Navigation label clipped '+n.label);
  if(page.viewportSize().width<=600&&!before.some(n=>n.clipped))failures.push('Pre-repair mobile clipping reproduction did not trigger');
  return{failures,measures:{before,after}};
}

async function studioGeometryContract(page){
  const sample=async()=>({strength:await page.getByRole('slider',{name:'Strength',exact:true}).boundingBox(),run:await page.getByRole('button',{name:'Run Inpaint',exact:true}).boundingBox(),position:await page.locator('.dex-ed-studio .dex-ed-run').evaluate(n=>getComputedStyle(n).position)});
  const before=await sample(),a=before.strength,b=before.run,w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
  const failures=w>2&&h>2?['Strength/Run overlap '+w+'x'+h]:[];
  let staticProbe;
  if(process.env.DEX_MATRIX_STUDIO_PROBE==='1'){const style=await page.addStyleTag({content:'.dex-ed-studio .dex-ed-run{position:static!important}'});staticProbe=await sample();await style.evaluate(n=>n.remove());}
  return{failures,measures:{...before,overlap:{width:Math.max(0,w),height:Math.max(0,h)},...(staticProbe?{staticProbe}:{})}};
}

(async()=>{
  fs.mkdirSync(out,{recursive:true});const started=new Date().toISOString();
  const srv=process.env.DEX_TEST_BASE?{base:process.env.DEX_TEST_BASE}:await startServer();
  const browser=await launchBrowser({launch:opts=>chromium.launch({...opts,timeout:60000,...(process.env.DEX_MATRIX_DISABLE_GPU==='1'?{args:['--disable-gpu']}:{} )})});
  try{
    for(const shell of spec.shells)for(const [width,height]of spec.viewports){
      if(select.length&&!spec.screens.some(screen=>select.some(s=>`V${shell}/${width}x${height}/${screen}`.includes(s))))continue;
      const ctx=await browser.newContext({viewport:{width,height}}),page=await ctx.newPage();page.setDefaultTimeout(5000);
      for(const screen of spec.screens){
      const id=`V${shell}/${width}x${height}/${screen}`;if(select.length&&!select.some(s=>id.includes(s)))continue;
      const checks=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
      try{
        await configure(page,srv.base,screen,shell);const m=await measure(page);
        check(checks,'layout',true,[...(m.documentOverflow>1.5?['Document overflow '+m.documentOverflow]:[]),...m.zeroSized.map(n=>'Zero-sized rendered control '+n),...m.panes.filter(p=>p.left< -1.5||p.right>width+1.5||p.height<=0||p.width<=0).map(p=>'Primary pane clipping '+JSON.stringify(p)),...m.intersections.map(x=>'Control intersection '+JSON.stringify(x))],{documentOverflow:m.documentOverflow,panes:m.panes,zeroSized:m.zeroSized.length});
        check(checks,'controls',true,[...m.unnamed.map(c=>'No accessible name '+c.tag+' '+c.type),...m.controls.filter(c=>c.visuallyDisabled&&!c.disabled).map(c=>'Disabled styling lacks disabled state '+c.name)],{visible:m.controls.length,disabled:m.controls.filter(c=>c.disabled).length});
        if(screen==='Edit Studio'){const studio=await studioGeometryContract(page);check(checks,'studio-rail-geometry',true,studio.failures,studio.measures);}
        const k=await keyboard(page,m);check(checks,'keyboard',k.measures.expected>0,k.failures,k.measures);
        const f=await forms(page,m);check(checks,'forms',m.fieldCount>0||f.measures.details>0,f.failures,f.measures);
        await settle(page);
        const d=await dialogs(page);check(checks,'dialogs',d.measures.exercised>0,d.failures,d.measures);
        const p=await popovers(page);check(checks,'popovers',p.measures.exercised>0,p.failures,p.measures);
        if(screen==='Create'){const model=await modelDisabledContract(page);check(checks,'model-disabled-state',true,model.failures,model.measures);}
        if(screen==='Create'&&shell===2){const nav=await navigationLabelContract(page);check(checks,'navigation-label-regression',true,nav.failures,nav.measures);}
        const sized=m.controls.filter(c=>['BUTTON','SELECT','TEXTAREA'].includes(c.tag)||c.tag==='INPUT'&&!['range','checkbox','radio','file'].includes(c.type));
        check(checks,'typography',sized.length>0,sized.flatMap(c=>[...(c.height+1.5<m.minimumHeight?['Undersized '+c.name+' '+c.height]:[]),...(c.tag==='BUTTON'&&c.width+1.5<m.minimumHeight?['Narrow target '+c.name+' '+c.width]:[]),...(c.tag==='BUTTON'&&c.clipped&&c.overflowX!=='auto'?['Clipped '+c.name]:[])]),{minimumHeight:m.minimumHeight,minObservedHeight:Math.min(...sized.map(c=>c.height)),minObservedButtonWidth:Math.min(...sized.filter(c=>c.tag==='BUTTON').map(c=>c.width)),controls:sized.length});
        if(errors.length)check(checks,'runtime',true,errors,{});
      }catch(e){checks.push({contract:'execution',status:'BLOCKED',failures:[e.message.split('\n')[0]]});}
      const status=checks.some(c=>c.status==='BLOCKED')?'BLOCKED':checks.some(c=>c.status==='FAIL')?'FAIL':'PASS';cells.push({id,screen,shell,viewport:[width,height],status,checks});
      console.log(id+' '+status+' '+checks.filter(c=>c.status==='FAIL'||c.status==='BLOCKED').map(c=>c.contract+': '+c.failures.slice(0,3).join('; ')).join(' | '));
      fs.writeFileSync(path.join(out,'interaction-matrix.json'),JSON.stringify({specVersion:spec.version,started,requiredBaseCells:180,partial:!!select.length,cells},null,2)+'\n');
      }
      await ctx.close();
    }
  }finally{await runCleanups();}
  const counts=Object.fromEntries(['PASS','FAIL','N/A','BLOCKED'].map(s=>[s,cells.filter(c=>c.status===s).length]));
  const summary=['# Executable interaction matrix',`Specification version ${spec.version}. Required base cells: 180. Measured cells: ${cells.length}.`,JSON.stringify(counts),`Scope: ${spec.scope}`,'','| Cell | Status | Failed contracts |','|---|---|---|',...cells.map(c=>`| ${c.id} | ${c.status} | ${c.checks.filter(k=>['FAIL','BLOCKED'].includes(k.status)).map(k=>k.contract+': '+k.failures.join('; ')).join(' / ').replaceAll('|','/')} |`)];
  fs.writeFileSync(path.join(out,'interaction-matrix-summary.md'),summary.join('\n')+'\n');process.exitCode=counts.FAIL||counts.BLOCKED?1:0;
})().catch(async e=>{console.error(e);await runCleanups();process.exitCode=2;});
