'use strict';
// J04: a worker whose live contract refuses cancellation must disclose that before launch.
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startServer,launchBrowser,runCleanups}=require('./helpers');
(async()=>{
 const {base}=await startServer();const browser=await launchBrowser(chromium);
 const page=await browser.newPage({viewport:{width:1340,height:870}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/dexdiffusion/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__dex?.state?.version===2,{timeout:15000});
 await page.locator('[data-studio-category="voice"]').click();
 await page.locator('[data-voice-tab="quick"]').click();
 await page.evaluate(()=>__dex.mSet({voiceMode:'speech',workers:[{id:'kokoro',label:'Kokoro',enabled:true,proven:true,state:'PROVEN',capabilities:{generate:true,cancel_supported:false,cancel_reason:'Job runs to completion'}}]}));
 const warning=page.locator('[data-worker-cancel-warning="kokoro"]');
 await warning.waitFor({state:'visible',timeout:4500});
 assert.match(await warning.innerText(),/cannot be stopped (after|once) (it )?starts/i);
 const generate=warning.locator('..').getByRole('button',{name:/Generate/}).first();
 assert.equal(await generate.isEnabled(),true,'prelaunch warning appears on an enabled worker');
 await page.evaluate(()=>__dex.mSet({workers:[{id:'kokoro',label:'Kokoro',enabled:true,proven:true,state:'PROVEN',capabilities:{generate:true,cancel_supported:true}}]}));
 await warning.waitFor({state:'hidden',timeout:4500});
 await page.locator('[data-studio-category="music"]').click();
 await page.evaluate(()=>__dex.mSet({musicWorker:'ace-step',workers:[{id:'ace-step',label:'ACE-Step',enabled:true,proven:true,state:'PROVEN',capabilities:{generate:true,cancel_supported:false}}]}));
 const musicWarn=page.locator('[data-worker-cancel-warning="ace-step"]');
 await musicWarn.waitFor({state:'visible',timeout:4500});
 assert.deepEqual(errors,[]);
 console.log('UNSUPPORTED_CANCEL_WARNING_PASS',{voice:true,music:true,capabilityDriven:true});
})().catch(e=>{console.error('UNSUPPORTED_CANCEL_WARNING_FAIL',e.stack);process.exitCode=1}).finally(runCleanups);
