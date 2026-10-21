'use strict';
// At a normal MacBook Dock window height, first-use Generate must be on-screen.
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startServer,launchBrowser,runCleanups}=require('./helpers');
(async()=>{
 const {base}=await startServer();const browser=await launchBrowser(chromium);
 const page=await browser.newPage({viewport:{width:1348,height:735}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/dexdiffusion/',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__dex && __dex.state.version===2,{timeout:14000});
 const button=page.getByRole('button',{name:'Generate image',exact:true});
 await button.waitFor({state:'attached'});
 const measure=async()=>{
   const r=await button.boundingBox();
   const vp=page.viewportSize();
   return {rect:r,width:vp.width,height:vp.height};
 };
 const before=await measure();
 assert.ok(before.rect && before.rect.y>=0 && before.rect.y+before.rect.height<=before.height,
   'Generate image must be visible without scrolling a desktop Dock window: '+JSON.stringify(before));
 await page.locator('details[data-studio-advanced] summary').click();
 const expanded=await measure();
 assert.ok(expanded.rect && expanded.rect.y>=0 && expanded.rect.y+expanded.rect.height<=expanded.height,
   'Generate must remain visible with Advanced settings expanded: '+JSON.stringify(expanded));
 assert.deepEqual(errors,[]);
 console.log('STUDIO_DESKTOP_PRIMARY_PASS',JSON.stringify({normal:before.rect.y,advanced:expanded.rect.y,viewport:before.height}));
})().catch(e=>{console.error('STUDIO_DESKTOP_PRIMARY_FAIL',e.stack);process.exitCode=1}).finally(runCleanups);
