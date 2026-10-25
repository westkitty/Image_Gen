'use strict';
// Regression: V2 Studio inspector scroll/focus survive local state and background refresh.
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startServer,launchBrowser,runCleanups, openStudio }=require('./helpers');
(async()=>{
 const {base}=await startServer();const browser=await launchBrowser(chromium);
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.fulfill({status:409,json:{error:'read only'}}));
 // The startup Ollama status response relabels the Enhance button and can wrap the prompt-tools row above the pane;
 // take the scroll baseline only after that network-dependent re-render has landed (register before navigation).
 const ollamaSettled=page.waitForResponse(r=>r.url().includes('/api/ollama/status'),{timeout:20000});
 await openStudio(page, base+'/dexdiffusion/',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__dex && __dex.state.version===2,{timeout:14000});
 await page.locator('details[data-studio-advanced] > summary').click();
 const prompt=page.getByRole('textbox',{name:'Describe your image'});
 await prompt.fill('A sapphire glass city under sunrise');
 await ollamaSettled;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const sample=()=>page.evaluate(()=>{
   const header=document.querySelector('[data-screen-header="create"]');const pane=header?.closest('[data-scroll-pane]');
   return {pane,scroll:pane?.scrollTop||0,height:pane?.scrollHeight||0,client:pane?.clientHeight||0,advanced:document.querySelector('[data-studio-advanced]')?.open,prompt:document.querySelector('textarea[aria-label="Describe your image"]')?.value||''};
 });
 const baseline=await page.evaluate(()=>{const pane=document.querySelector('[data-screen-header="create"]').closest('[data-scroll-pane]');pane.scrollTop=300;window.__studioScrollProbe=pane;return{scroll:pane.scrollTop,possible:pane.scrollHeight-pane.clientHeight};});
 assert.ok(baseline.possible>200,'inspector is scrollable');assert.ok(baseline.scroll>=200,'the intended scroll reached the pane');
 await page.evaluate(()=>__dex.setState({seed:7654321}));
 await page.waitForTimeout(3900);
 const final=await page.evaluate(()=>({oldConnected:window.__studioScrollProbe.isConnected,scroll:window.__studioScrollProbe.scrollTop,advanced:document.querySelector('[data-studio-advanced]')?.open,prompt:document.querySelector('textarea[aria-label="Describe your image"]')?.value}));
 assert.equal(final.oldConnected,true,'inspector DOM is not detached');
 assert.ok(Math.abs(final.scroll-baseline.scroll)<=1,'scroll remains stable through state updates and polling');
 assert.equal(final.advanced,true,'Advanced remains open');
 assert.equal(final.prompt,'A sapphire glass city under sunrise');
 assert.deepEqual(errors,[]);
 console.log('[studio-scroll-preservation.browser] PASS SCROLL_PRESERVATION_PASS',JSON.stringify({before:baseline.scroll,after:final.scroll,domPreserved:final.oldConnected,advanced:final.advanced}));
})().catch(e=>{console.error('SCROLL_PRESERVATION_FAIL',e.stack);process.exitCode=1}).finally(runCleanups);
