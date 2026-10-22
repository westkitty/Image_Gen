'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startServer,launchBrowser,runCleanups, openStudio }=require('./helpers');
(async()=>{
 const {base}=await startServer();const browser=await launchBrowser(chromium);
 const page=await browser.newPage({viewport:{width:1360,height:860}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const job={id:'fixture-drama-running',label:'Drama production',operation:'drama-production',mediaKind:'voice',worker:'drama-producer',status:'RUNNING',canCancel:true,cancelCapability:'stop_after_current',createdAt:new Date().toISOString()};
 // The live event stream would push the real (empty) snapshot over the fixture; refuse it so the page falls back to the routed snapshot.
 await page.route('**/api/events',r=>r.abort());
 await page.route('**/api/operations/snapshot',r=>r.fulfill({json:{active:[job],queue:[],recent:[],resources:{}}}));
 await page.route('**/api/jobs/fixture-drama-running/cancel',r=>r.fulfill({status:202,json:{ok:false,accepted:true,status:'RUNNING',terminationVerified:false,leaseReleased:false,cancelState:'stop_after_current'}}));
 await openStudio(page, base+'/dexdiffusion/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__dex?.state?.version===2,{timeout:15000});
 await page.evaluate(j=>{__DEX_V12.snapshot={active:[j],queue:[],recent:[],resources:{}};},job);
 await page.locator('[data-studio-jobs]').click();
 await page.waitForTimeout(1200);  // let the Job Center drawer finish sliding in before interacting with it
 const stop=page.getByRole('button',{name:'Stop after current',exact:true});
 await stop.waitFor({state:'visible',timeout:15000});
 const msgs=[];let finish;const dialogs=new Promise(r=>finish=r);
 page.on('dialog',async d=>{msgs.push(d.message());await d.accept();if(msgs.length===2)finish();});
 const req=page.waitForRequest(r=>r.url().endsWith('/api/jobs/fixture-drama-running/cancel')&&r.method()==='POST',{timeout:20000});
 await stop.hover({timeout:20000});await stop.click({timeout:20000});await req;  // hover first: the drawer is still sliding in; a bare click can stall on the first frame
 await Promise.race([dialogs,new Promise((_,reject)=>setTimeout(()=>reject(new Error('missing dialog')),20000))]);
 assert.match(msgs[0],/stop after current/i);
 assert.match(msgs[1],/current.*(finish|running)|not verified/i);
 assert.ok(!msgs.some(x=>/cancelled successfully|has been cancelled/i.test(x)));
 assert.deepEqual(errors,[]);
 console.log('[studio-drama-stop-after-current.browser] PASS DRAMA_STOP_AFTER_CURRENT_BROWSER_PASS',{dialogs:msgs.length,request:'job-scoped',prematureCancelled:false});
})().catch(e=>{console.error('DRAMA_STOP_AFTER_CURRENT_BROWSER_FAIL',e.stack);process.exitCode=1}).finally(runCleanups);
