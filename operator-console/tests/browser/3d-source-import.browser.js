'use strict';
// Focused, isolated end-to-end acceptance: raw image -> canonical Library ->
// exact 3D and World selection. Never contact a real inference engine.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const { startServer, makePng, launchBrowser, openStudio, installModelSnapshots, runCleanups, onCleanup } = require('./helpers');

(async () => {
  const srv = await startServer({
    seedCanonicalImages: [
      {id:'fixture-old-photo.png',width:64,height:48},
      {id:'fixture-second-photo.png',width:60,height:40}
    ]
  });
  const base=srv.base;
  const ownedRuns = new Set();
  const runsDir = path.resolve(__dirname,'../../../sdcpp-workflow/runs');
  onCleanup(() => {
    for (const id of ownedRuns) {
      if (/^20\d{6}-\d{6}-import-[0-9a-f]{10}$/.test(id)) {
        const target=path.join(runsDir,id);
        if (path.dirname(target)===runsDir) fs.rmSync(target,{recursive:true,force:true});
      }
    }
  });
  const originalLib = await (await fetch(base+'/api/library/images?limit=500')).json();
  assert.ok(originalLib.items.some(x=>x.id==='fixture-old-photo.png'));
  assert.ok(originalLib.items.some(x=>x.id==='fixture-second-photo.png'));
  const png=makePng(120,80);
  const imported=await fetch(base+'/api/library/images/import?name='+encodeURIComponent('outside photograph.png'),{
    method:'POST',headers:{'content-type':'image/png'},body:png
  });
  const doc=await imported.json();
  assert.equal(imported.status,201,JSON.stringify(doc));
  ownedRuns.add(doc.runId);
  assert.match(doc.id,/\.png$/);
  assert.notEqual(doc.id,'fixture-old-photo.png');
  assert.equal(doc.width,120); assert.equal(doc.height,80);
  const canonical=await fetch(base+'/api/images/'+encodeURIComponent(doc.id));
  assert.equal(canonical.status,200);
  assert.deepEqual(Buffer.from(await canonical.arrayBuffer()),png);
  const metadata=await (await fetch(base+'/api/images/'+encodeURIComponent(doc.id)+'/meta')).json();
  assert.equal(metadata.meta.operation,'import');
  assert.equal(metadata.meta.original_name,'outside photograph.png');
  const bad=await fetch(base+'/api/library/images/import?name=corrupted.png',{method:'POST',
    headers:{'content-type':'image/png'},body:Buffer.from('not a real image file, merely text')});
  assert.equal(bad.status,400);
  assert.equal((await bad.json()).gate,'source-import');

  const browser=process.env.DEX_3D_TEST_WEBKIT==='1' ? await webkit.launch({headless:true}) : await launchBrowser(chromium);
  if(process.env.DEX_3D_TEST_WEBKIT==='1') onCleanup(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:820}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const worldRequests=[];
  // Never allow a 3D render to leave this test.
  await page.route('**/api/world/projects', r=>{
    if (r.request().method()==='POST') {worldRequests.push(r.request().postDataJSON());
      return r.fulfill({status:202,json:{id:'wp-fixture',status:'QUEUED',job_id:'fake'}});}
    return r.fulfill({json:{projects:[]}});
  });
  await page.route('**/api/3d/jobs',r=>r.fulfill({status:403,json:{error:'render fixture only'}}));
  await installModelSnapshots(page,base);
  await openStudio(page,base+'/dexdiffusion/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>__dex.setScreen('3d'));
  await page.waitForFunction(()=>__dex.state.sourceImages.length>=3);
  const options=await page.getByRole('combobox',{name:'3D source image'}).locator('option').allTextContents();
  assert.ok(options.some(x=>x.includes('fixture-old-photo.png')),'3D includes library image missing from run list');
  assert.ok(options.some(x=>x.includes('fixture-second-photo.png')),'3D includes second library image');
  assert.ok(options.some(x=>x.includes('outside photograph.png')),'uploaded name survives in Library');
  assert.equal(await page.getByRole('combobox',{name:'3D source image'}).inputValue(),'','nothing preselected');
  assert.ok(await page.locator('[data-3d-add-image="3d"]').count(),'3D exposes Add image button');
  const p3=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/library/images/import'));
  const [chooser3] = await Promise.all([page.waitForEvent('filechooser'),page.locator('[data-3d-add-image="3d"]').click()]);
  await chooser3.setFiles({name:'uploaded-by-3d.png',mimeType:'image/png',buffer:makePng(112,88)});
  const post3=await p3;
  assert.equal(post3.status(),201);
  const upload3=await post3.json(); ownedRuns.add(upload3.runId);
  await page.waitForFunction(id=>__dex.state.asset3dSourceArtifact===id,upload3.id);
  assert.equal(await page.getByRole('combobox',{name:'3D source image'}).inputValue(),upload3.id);
  await page.waitForFunction(()=>__dex.state.sourceImporting===false);
  // Failed import never replaces an already selected source.
  const fail3=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/library/images/import'));
  await page.locator('[data-3d-image-input="3d"]').setInputFiles({name:'bad-file.png',mimeType:'image/png',buffer:Buffer.from('invalid image bytes and not PNG')});
  assert.equal((await fail3).status(),400);
  await page.waitForFunction(id=>__dex.state.asset3dSourceArtifact===id,upload3.id);
  await page.evaluate(()=>__dex.setScreen('world'));
  await page.getByRole('combobox',{name:'World source image'}).waitFor();
  assert.ok(await page.getByRole('combobox',{name:'World source image'}).locator('option[value="'+upload3.id+'"]').count());
  assert.ok(await page.locator('[data-3d-add-image="world"]').count(),'World exposes Add image button');
  const pw=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/library/images/import'));
  await page.locator('[data-3d-add-image="world"]').focus();
  const [chooserWorld] = await Promise.all([page.waitForEvent('filechooser'),page.keyboard.press('Enter')]);
  await chooserWorld.setFiles({name:'uploaded-by-world.png',mimeType:'image/png',buffer:makePng(70,60)});
  const postw=await pw;assert.equal(postw.status(),201);
  const world=await postw.json();ownedRuns.add(world.runId);
  await page.waitForFunction(id=>__dex.state.worldSourceArtifact===id,world.id);
  await page.getByRole('button',{name:'Make World'}).click();
  await page.waitForFunction(()=>__dex.state.worldLoading===false,{timeout:10000});
  assert.equal(worldRequests.length,1,'exactly one world job routed to fixture endpoint');
  assert.equal(worldRequests[0].sourceArtifactId,world.id,'World uses precisely uploaded source');
  assert.deepEqual(errors,[]);
  console.log('[3d-source-import] PASS',JSON.stringify({initialLibrary:originalLib.total,threeD:upload3.id,world:world.id,worldRequest:'exact',invalidBytes:'rejected'}));
})().catch(e=>{console.error('3D_SOURCE_IMPORT_FAIL',e.stack||e);process.exitCode=1}).finally(runCleanups);
