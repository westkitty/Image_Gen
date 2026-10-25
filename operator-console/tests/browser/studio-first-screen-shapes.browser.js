'use strict';
// A novice can see prompt, model, all shape choices and Generate before scrolling.
// Both the typical native MacBook content size and mobile must meet this contract.
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startServer,launchBrowser,runCleanups}=require('./helpers');
(async()=>{
 const {base}=await startServer();const browser=await launchBrowser(chromium);
 for(const [width,height] of [[1348,735],[390,844]]){
  const page=await browser.newPage({viewport:{width,height}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/dexdiffusion/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__dex?.state?.version===2,{timeout:15000});
  const result=await page.evaluate(()=>{
   const pane=document.querySelector('[data-screen-header="create"]').closest('[data-scroll-pane]');
   const footer=document.querySelector('[data-studio-primary-action]');
   const rect=el=>{const r=el?.getBoundingClientRect();return r?{y:r.y,bottom:r.bottom,height:r.height}:null};
   return {pane:rect(pane),footer:rect(footer),quality:rect(pane.querySelector('select[aria-label="Quality preset"]')),prompt:rect(pane.querySelector('textarea[aria-label="Describe your image"]')),model:rect(pane.querySelector('[data-model-picker="create"] > button')),shapes:[...pane.querySelectorAll('[data-studio-shape]')].map(el=>({id:el.dataset.studioShape,box:rect(el)})),generate:rect(footer.querySelector('[aria-label="Generate image"]')),guide:rect(pane.querySelector('[data-screen-header="create"] > div:nth-child(2)'))};
  });
  assert.equal(result.shapes.length,4,'all four shape choices exist');
  for(const [name,box] of [['prompt',result.prompt],['model',result.model],['quality',result.quality],...result.shapes.map(x=>[x.id,x.box])]){
   assert.ok(box&&box.y>=result.pane.y-1&&box.bottom<=result.pane.bottom+1,
    `${name} is fully visible without inspector scrolling at ${width}x${height}: ${JSON.stringify(result)}`);
  }
  assert.ok(result.generate&&result.generate.y>=result.footer.y&&result.generate.bottom<=height,
   'Generate remains in a visible, separate footer');
  const modelBtn=page.locator('[data-model-picker="create"] > button');
  assert.equal(await modelBtn.isVisible(),true);
  await page.locator('[data-studio-shape="portrait"]').click({timeout:4500});
  await page.waitForFunction(()=>document.querySelector('[data-studio-shape="portrait"]')?.getAttribute('aria-pressed')==='true',null,{timeout:5000});
  assert.equal(await page.getByRole('combobox',{name:'Quality preset'}).isVisible(),true,'Quality is a visible first-use control');
  await page.locator('details[data-studio-advanced] > summary').click();
  assert.equal(await page.locator('details[data-studio-advanced]').evaluate(x=>x.open),true,'Advanced settings opened');
  const negBox = page.getByRole('textbox',{name:'Negative prompt'});
  await page.getByText('Negative prompt (what to avoid)',{exact:false}).click();
  await negBox.waitFor({state:'visible',timeout:5000});
  assert.equal(await negBox.isVisible(),true,'Create composer exposes negative prompt');
  assert.deepEqual(errors,[]);
  console.log('[studio-first-screen-shapes.browser] PASS FIRST_SCREEN_SHAPES_PASS',JSON.stringify({size:`${width}x${height}`,shapes:result.shapes.length,prompt:Math.round(result.prompt.bottom),model:Math.round(result.model.bottom),lastShape:Math.round(Math.max(...result.shapes.map(x=>x.box.bottom))),paneBottom:Math.round(result.pane.bottom)}));
  await page.close();
 }
})().catch(e=>{console.error('FIRST_SCREEN_SHAPES_FAIL',e.stack);process.exitCode=1}).finally(runCleanups);
