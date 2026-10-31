'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { makePng, startServer, installModelSnapshots, openStudio, launchBrowser, runCleanups } = require('./helpers');

const ID = 'wp-a1b2c3d4';
const PANO = makePng(512, 256); // 2:1 ERP with nonuniform RGB and recognizable edges.
function ply() {
  const count = 80;
  const header = Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex '+count+
    '\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n');
  const rows = Buffer.alloc(count * 15);
  for (let i=0;i<count;i++) {
    rows.writeFloatLE(Math.sin(i)*0.8,i*15);
    rows.writeFloatLE(Math.cos(i)*0.8,i*15+4);
    rows.writeFloatLE(0,i*15+8);
    rows[i*15+12]=220; rows[i*15+13]=130; rows[i*15+14]=80;
  }
  return Buffer.concat([header,rows]);
}
const PLY=ply();
const project = {
  id:ID, mode:'complete360',status:'PARTIAL',currentStage:'quality',
  sourceArtifactId:'fixture-src.png',
  progress:{kind:'verified-milestones',done:9,total:9,segments:Array.from({length:9},(_,i)=>({id:i===8?'quality':'s'+i,label:i===8?'Quality report':'Stage '+i,status:'READY'})),result:'PARTIAL'},
  viewerArtifact:{artifact_id:'fixture-fused.ply',url:'/api/media/fixture-fused.ply',bytes:PLY.length},
  artifacts:{
    panorama:[{artifact_id:'fixture-panorama.png',url:'/api/media/fixture-panorama.png',mime:'image/png',bytes:PANO.length}],
    finalPly:{artifact_id:'fixture-fused.ply',url:'/api/media/fixture-fused.ply',bytes:PLY.length},
    perViewSplats:[{artifact_id:'fixture-sharp.ply',url:'/api/media/fixture-sharp.ply'}]
  }
};

(async()=>{
  const srv=await startServer();
  const browser=await launchBrowser(chromium);
  const page=await browser.newPage({viewport:{width:1050,height:690}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const json=(r,v)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(v)});
  const capture=async()=>{
    return page.frameLocator('iframe[data-focus-frame="world"]').locator('#panorama-canvas').evaluate(canvas=>{
      const gl=canvas.getContext('webgl'); const px=new Uint8Array(4);
      gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
      return Array.from(px);
    });
  };
  try {
    await installModelSnapshots(page,srv.base);
    await page.route('**/api/world/workers',r=>json(r,{workers:[{id:'sharp-reconstruct',label:'Apple SHARP',status:'PROVEN'}],assets:{reachable:true}}));
    await page.route(/\/api\/world\/projects$/,r=>json(r,{projects:[project]}));
    await page.route('**/api/world/projects/'+ID,r=>r.request().method()==='PATCH'?json(r,{ok:true}):json(r,project));
    await page.route('**/api/media/fixture-panorama.png',r=>r.fulfill({status:200,contentType:'image/png',body:PANO}));
    await page.route('**/api/media/fixture-fused.ply',r=>r.fulfill({status:200,contentType:'application/vnd.ply',body:PLY}));
    await openStudio(page,srv.base+'/dexdiffusion/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.__dex && window.__dex.state.version === 2);
    await page.evaluate(()=>__dex.setScreen('world'));
    await page.getByText(ID).waitFor();
    await page.locator('[data-world-progress="'+ID+'"]').getByText('9 of 9 processing stages complete').waitFor();
    assert.match(await page.locator('[data-world-quality-warning="'+ID+'"]').innerText(),/Quality NOT verified/);
    assert.equal(await page.locator('[data-world-progress="'+ID+'"] [data-stage-id="quality"]').getAttribute('aria-label'),'Quality report recorded; quality not verified');
    assert.equal(await page.locator('[data-world-progress="'+ID+'"] [data-stage-id="quality"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(228, 170, 66)','partial quality gate appears amber, never fully teal');
    await page.locator('[data-world-open-focus="'+ID+'"]').click();
    const frame=page.frameLocator('iframe[data-focus-frame="world"]');
    assert.match(await page.locator('iframe[data-focus-frame="world"]').getAttribute('src'),/world-panorama-viewer\.html/);
    await frame.locator('#world-state').getByText(/Generated panorama ready/).waitFor({timeout:18000});
    assert.match(await frame.locator('#world-note').innerText(),/not a navigable 3D reconstruction/);
    assert.ok(await frame.locator('#world-points').isVisible());
    assert.ok(await frame.locator('#world-gaussian').isVisible());
    await page.waitForTimeout(250); // status fires on texture upload; the first WebGL frame is scheduled asynchronously.
    const initial=await capture();
    assert.ok(initial[3]===255 && Math.max(...initial.slice(0,3))>10,'WebGL panorama must draw actual opaque pixels: '+JSON.stringify(initial));
    const c=frame.locator('#panorama-canvas');
    await c.focus();
    for(let i=0;i<8;i++)await c.press('ArrowRight');
    await page.waitForTimeout(180);
    const rotated=await capture();
    assert.ok(Math.abs(rotated[0]-initial[0])+Math.abs(rotated[1]-initial[1])+Math.abs(rotated[2]-initial[2])>4,
      'keyboard orbit changes rendered panorama pixels: '+JSON.stringify({initial,rotated}));
    const canvasBox=await c.boundingBox();
    assert.ok(canvasBox && canvasBox.width>300 && canvasBox.height>300);
    const moveX=canvasBox.x+canvasBox.width*0.5, moveY=canvasBox.y+canvasBox.height*0.5;
    await page.mouse.move(moveX,moveY);await page.mouse.down();await page.mouse.move(moveX+165,moveY+38,{steps:7});await page.mouse.up();
    await page.waitForTimeout(150);
    const dragged=await capture();
    assert.ok(Math.abs(dragged[0]-rotated[0])+Math.abs(dragged[1]-rotated[1])+Math.abs(dragged[2]-rotated[2])>4,
      'pointer drag changes panorama direction: '+JSON.stringify({rotated,dragged}));
    await page.evaluate(()=>{window.__originalWorldFocusFrame=document.querySelector('[data-focus-frame="world"]');__dex.setState({worldLoading:true});});
    await page.waitForTimeout(220);
    assert.equal(await page.evaluate(()=>window.__originalWorldFocusFrame===document.querySelector('[data-focus-frame="world"]')),true,'Studio polling preserves running panorama iframe');
    await frame.locator('#world-points').click();
    await frame.locator('#world-status').getByText(/80 vertices/).waitFor({timeout:15000});
    assert.ok(await frame.locator('#world-panorama').isVisible(),'diagnostic cloud links back to immersive panorama');
    await frame.locator('#world-panorama').click();
    await frame.locator('#world-state').getByText(/Generated panorama ready/).waitFor({timeout:15000});
    await page.locator('[data-focus-close]').click();
    await page.locator('[data-focus-viewer]').waitFor({state:'detached',timeout:6000});
    assert.deepEqual(errors,[],'zero Studio / iframe page errors');
    console.log('PASS world panorama focus: honest 9/9 status, 2:1 WebGL, keyboard orbit pixel change, diagnostic switch/back, stable iframe, close');
    // No panorama: deliberately refuse unsupported 3D claim and expose fallback.
    const missing=await browser.newPage({viewport:{width:650,height:440}});
    await missing.route('**/api/world/projects/'+ID,r=>json(r,{...project,artifacts:{finalPly:project.artifacts.finalPly},viewerArtifact:project.viewerArtifact}));
    await missing.goto(srv.base+'/dexdiffusion/world-panorama-viewer.html?project='+ID,{waitUntil:'domcontentloaded'});
    await missing.waitForFunction(()=>document.querySelector('#world-state')?.textContent?.includes('Panorama preview unavailable'));
    assert.ok(await missing.locator('#world-points').isVisible(),'diagnostic fallback without panorama');
    console.log('PASS missing panorama fails visibly without inventing imagery');
    await missing.close();
  }finally{await page.close();await browser.close();await srv.stop();await runCleanups();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
