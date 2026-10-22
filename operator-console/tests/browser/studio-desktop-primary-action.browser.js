'use strict';
// At a normal MacBook Dock window height, first-use Generate must be on-screen.
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startServer,launchBrowser,runCleanups, openStudio }=require('./helpers');
(async()=>{
 const {base}=await startServer();const browser=await launchBrowser(chromium);
 const page=await browser.newPage({viewport:{width:1348,height:735}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openStudio(page, base+'/dexdiffusion/',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__dex && __dex.state.version===2,{timeout:14000});
 const button=page.getByRole('button',{name:'Generate image',exact:true});
 await button.waitFor({state:'attached'});
 const measure=async()=>{
   const r=await button.boundingBox();
   const vp=page.viewportSize();
   return {rect:r,width:vp.width,height:vp.height};
 };
 const inspectorStructure=await page.evaluate(()=>{const footer=document.querySelector('[data-studio-primary-action]');return {footerOutsideScrollPane:!footer.closest('[data-scroll-pane]'),inspectorScrollPaneCount:document.querySelectorAll('[data-screen-header=\"create\"]').length};});
 assert.equal(inspectorStructure.footerOutsideScrollPane,true,'Generate belongs in a fixed inspector footer outside the settings scroller; never overlay Model or Image shape controls');
 const geometry=await page.evaluate(()=>{const pane=document.querySelector('[data-screen-header=\"create\"]').closest('[data-scroll-pane]');const footer=document.querySelector('[data-studio-primary-action]');return {scrollPaneBottom:pane.getBoundingClientRect().bottom,footerTop:footer.getBoundingClientRect().top};});
 assert.ok(geometry.footerTop>=geometry.scrollPaneBottom-1,'Create footer must not overlap model or image-shape settings: '+JSON.stringify(geometry));
 const before=await measure();
 assert.ok(before.rect && before.rect.y>=0 && before.rect.y+before.rect.height<=before.height,
   'Generate image must be visible without scrolling a desktop Dock window: '+JSON.stringify(before));
 await page.locator('details[data-studio-advanced] > summary').click();
 const expanded=await measure();
 assert.ok(expanded.rect && expanded.rect.y>=0 && expanded.rect.y+expanded.rect.height<=expanded.height,
   'Generate must remain visible with Advanced settings expanded: '+JSON.stringify(expanded));
 await page.locator('[data-studio-shape=\"landscape\"]').click();
 const afterShape=await measure();
 assert.ok(afterShape.rect&&afterShape.rect.y>=0&&afterShape.rect.y+afterShape.rect.height<=afterShape.height,
   'Generate footer remains in view when shape controls are accessed');
 assert.deepEqual(errors,[]);
 console.log('[studio-desktop-primary-action.browser] PASS STUDIO_DESKTOP_PRIMARY_PASS',JSON.stringify({normal:before.rect.y,advanced:expanded.rect.y,viewport:before.height}));
})().catch(e=>{console.error('STUDIO_DESKTOP_PRIMARY_FAIL',e.stack);process.exitCode=1}).finally(runCleanups);
