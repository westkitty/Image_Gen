'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, launchBrowser, runCleanups } = require('./helpers');
(async () => {
  const {base} = await startServer();
  const browser = await launchBrowser(chromium);
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => ['GET','HEAD'].includes(route.request().method()) ? route.continue() : route.fulfill({status:409,json:{error:'novice test is read-only'}}));
  await page.goto(base + '/dexdiffusion/',{timeout:25000});
  await page.waitForFunction(()=>window.__dex && __dex.state.version===2,{timeout:15000});
  const labels = await page.locator('[data-studio-nav] [data-studio-category]').allTextContents();
  assert.deepEqual(labels.map(s=>s.trim()),['Create','Batch','Swap','Voice','Drama','Music','Video','World','3D','Library','Edit','Enhance','Models','System']);
  for (const id of ['create','batch','swap','voice','drama','music','video','world','3d','library','edit','enhance','models','system']) {
    await page.locator('[data-studio-category=\"'+id+'\"]').click();
    await page.waitForTimeout(70);
    const current=await page.evaluate(()=>__dex.state.screens[2]);
    assert.equal(current,id,'clicked '+id+' must route correctly');
  }
  await page.locator('[data-studio-category=\"create\"]').click();
  const prompt=page.getByRole('textbox',{name:'Describe your image'});
  assert.equal(await prompt.isVisible(),true,'prompt must be visible on entry');
  assert.match(await page.title(),/DexDiffusion Studio/);
  assert.equal(await page.getByText('Your image will appear here').isVisible(),true);
  const quality=page.getByRole('combobox',{name:'Quality preset'});
  assert.equal(await quality.isVisible(),true,'quality preset must have an accessible name');
  const shape=page.locator('[data-studio-shape]');
  assert.equal(await shape.count(),4,'four named image shapes');
  assert.equal(await shape.filter({hasText:'Square'}).first().getAttribute('aria-pressed'),'true');
  await page.locator('[data-studio-shape="landscape"]').click();
  await page.waitForFunction(() => document.querySelector('[data-studio-shape=\"landscape\"]')?.getAttribute('aria-pressed')==='true',null,{timeout:5000});
  assert.equal(await page.locator('[data-studio-shape="landscape"]').getAttribute('aria-pressed'),'true','selected shape announced');
  assert.equal(await page.locator('[data-studio-shape="square"]').getAttribute('aria-pressed'),'false','old shape deselected');
  assert.equal(await page.getByRole('textbox',{name:'Negative prompt'}).isVisible(),false,'advanced negative prompt starts hidden');
  const advanced=page.locator('details[data-studio-advanced]');
  assert.equal(await advanced.evaluate(x=>x.open),false,'advanced settings closed by default');
  await page.getByText('Advanced settings',{exact:true}).click();
  assert.equal(await advanced.evaluate(x=>x.open),true);
  assert.equal(await page.getByRole('textbox',{name:'Negative prompt'}).isVisible(),true,'negative prompt revealed on demand');
  await prompt.fill('A copper observatory on a snowy hill');
  assert.equal(await prompt.inputValue(),'A copper observatory on a snowy hill');
  await page.evaluate(()=>__dex.setState({backendOnline:false}));
  const offline=page.locator('[data-studio-offline]');
  await offline.waitFor({state:'visible'});
  assert.match(await offline.innerText(),/Connection lost/);
  let draftGuard='';
  page.once('dialog',d=>{draftGuard=d.message(); d.accept();});
  await offline.getByRole('button',{name:'Open System details'}).click();
  await page.waitForFunction(()=>__dex.state.screens[2]==='system',null,{timeout:5000});
  assert.match(draftGuard,/Create prompt/,'unsaved prompt guard explains why navigation needs confirmation');
  await page.locator('[data-studio-category="create"]').click();
  await page.evaluate(()=>__dex.setState({backendOnline:false}));
  await offline.waitFor({state:'visible'});
  await offline.getByRole('button',{name:'Retry connection'}).click();
  await page.waitForFunction(()=>__dex.state.backendOnline===true,null,{timeout:4000});
  await offline.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('textbox',{name:'Describe your image'}).inputValue(),'A copper observatory on a snowy hill','switching to System does not lose prompt');

  const jobs=page.locator('[data-studio-jobs]');
  assert.equal(await jobs.count(),1,'exactly one Studio Jobs button');
  await jobs.click();
  assert.equal(await page.locator('#v12-job-center-drawer').getAttribute('aria-hidden'),'false');
  await page.locator('#v12-jc-close-btn').click();
  assert.equal(await page.locator('#v12-job-center-drawer').getAttribute('aria-hidden'),'true');
  assert.equal(await page.locator('#v12-hud-bar').isVisible(),false,'no duplicate HUD');
  // J02: a queued job must have an obvious, functioning Cancel queued job button.
  // The HTTP mutation is intercepted. No real job is touched.
  const queuedJob={id:'fixture-queued-1',operation:'txt2img',label:'Sample queued job',
    worker:'mflux',mediaKind:'image',status:'QUEUED',canCancel:true,cancelCapability:'queued_only',createdAt:new Date().toISOString()};
  await page.route('**/api/operations/snapshot',r=>r.fulfill({json:{active:[],queue:[queuedJob],recent:[],resources:{}}}));
  await page.route('**/api/jobs/fixture-queued-1/cancel',r=>r.fulfill({json:{ok:true,accepted:true,neverStarted:true,terminationVerified:true,cancelState:'not_started'}}));
  await page.evaluate(j=>{__DEX_V12.snapshot={active:[],queue:[j],recent:[],resources:{}};},queuedJob);
  let queuedPrompt=''; page.on('dialog',async d=>{queuedPrompt=d.message();await d.accept();});
  await jobs.click();
  const queuedButton=page.getByRole('button',{name:'Cancel queued job',exact:true});
  await queuedButton.waitFor({state:'visible'});
  await page.waitForFunction(() => document.querySelector('[data-studio-jobs]')?.textContent.includes('1'),null,{timeout:3000});
  const cancelRequest=page.waitForRequest(r=>r.url().endsWith('/api/jobs/fixture-queued-1/cancel')&&r.method()==='POST');
  await queuedButton.click();
  const req=await cancelRequest;
  assert.match(queuedPrompt,/before it starts/,'queued confirmation accurately explains timing');
  assert.equal(req.postDataJSON().reason,'User cancelled via Job Center');
  await page.locator('#v12-jc-close-btn').click();

  await page.setViewportSize({width:390,height:844});
  const promptBox=await page.getByRole('textbox',{name:'Describe your image'}).boundingBox();
  const generateBox=await page.getByRole('button',{name:'Generate image',exact:true}).boundingBox();
  assert.ok(generateBox.y>promptBox.y+promptBox.height, 'on mobile, Generate follows prompt rather than preceding it');
  await page.setViewportSize({width:1440,height:900});

  // Fixture renders the actual result component without dispatching a real job.
  await page.evaluate(() => {
    __dex.wsSet({results:[{status:'QUEUED',imageId:'fixture-studio.png',imageUrl:'/api/images/fixture-studio.png',target:'sd15',seed:42,width:512,height:512}],activeIndex:0});
    __dex.setState({jobStatus:'generating'});
  });
  assert.equal(await page.getByText('Saved to Library',{exact:true}).count(),0,'queued image must not be called saved');
  await page.evaluate(() => {
    __dex.wsSet({results:[{status:'DONE',imageId:'fixture-studio.png',imageUrl:'/api/images/fixture-studio.png',target:'sd15',seed:42,width:512,height:512}],activeIndex:0});
    __dex.setState({jobStatus:'complete'});
  });
  await page.getByText('Saved to Library',{exact:true}).waitFor({state:'visible'});
  const actions=page.locator('[data-results-anchor]');
  for (const label of ['Open in Library','Enhance']) assert.equal(await actions.getByRole('button',{name:label,exact:true}).isVisible(),true,label+' result action visible');
  const download=actions.getByRole('link',{name:'Download',exact:true});
  assert.equal(await download.isVisible(),true,'result download link visible');
  assert.match(await download.getAttribute('href'),/\/api\/images\/fixture-studio\.png$/);
  assert.equal(await download.getAttribute('download'),'fixture-studio.png');

  assert.equal(errors.length,0,'browser page errors: '+JSON.stringify(errors));
  console.log('NOVICE_BROWSER_PASS',JSON.stringify({chips:labels.length,visiblePrompt:true,advanced:true,jobs:true,errors:0}));
})().catch(e=>{console.error('NOVICE_BROWSER_FAIL',e.stack);process.exitCode=1}).finally(runCleanups);
