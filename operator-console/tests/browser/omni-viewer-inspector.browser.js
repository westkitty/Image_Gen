'use strict';
// New GLB coverage: multiple scene nodes/materials, inspector modes, animation
// playback/reduced-motion, idle frame economy, and honest unsupported extensions.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, launchBrowser, runCleanups, makePng } = require('./helpers');

function glb({ animated = false, unsupported = false, textured = false } = {}) {
  const positions = new Float32Array([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1]);
  const indices = new Uint16Array([0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,0,3,7,0,7,4,1,5,6,1,6,2]);
  const parts = [Buffer.from(positions.buffer), Buffer.from(indices.buffer)];
  const json = {
    asset: { version:'2.0' }, scene: 0, scenes: [{ nodes:[0,1] }],
    nodes:[{ mesh:0,name:'Left Body' },{mesh:1,translation:[4,0,0],name:'Right Detail'}],
    meshes: [
      { primitives:[{attributes:{POSITION:0},indices:1,material:0}] },
      { primitives:[{attributes:{POSITION:0},indices:1,material:1}] }
    ],
    materials:[
      {name:'Matte green',pbrMetallicRoughness:{baseColorFactor:[0.12,0.8,0.2,1],roughnessFactor:0.9}},
      {name:'Metal red',pbrMetallicRoughness:{baseColorFactor:[0.8,0.14,0.15,1],metallicFactor:0.75}}
    ],
    buffers:[{byteLength:0}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength}],
    accessors:[{bufferView:0,componentType:5126,count:8,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]},{bufferView:1,componentType:5123,count:indices.length,type:'SCALAR'}]
  };
  if (animated) {
    const times = new Float32Array([0,1]), moves = new Float32Array([0,0,0, 0.5,0,0]);
    json.bufferViews.push({ buffer:0,byteOffset:parts.reduce((n,b)=>n+b.length,0),byteLength:times.byteLength });
    parts.push(Buffer.from(times.buffer));
    json.bufferViews.push({ buffer:0,byteOffset:parts.reduce((n,b)=>n+b.length,0),byteLength:moves.byteLength });
    parts.push(Buffer.from(moves.buffer));
    json.accessors.push({bufferView:2,componentType:5126,count:2,type:'SCALAR',min:[0],max:[1]});
    json.accessors.push({bufferView:3,componentType:5126,count:2,type:'VEC3',min:[0,0,0],max:[0.5,0,0]});
    json.animations=[{name:'Translation test',samplers:[{input:2,output:3,interpolation:'LINEAR'}],
      channels:[{sampler:0,target:{node:0,path:'translation'}}]}];
  }
  if (textured) {
    const uvs = new Float32Array([0,0,1,0,1,1,0,1,0,0,1,0,1,1,0,1]);
    const uvBytes = Buffer.from(uvs.buffer);
    json.bufferViews.push({ buffer: 0, byteOffset: parts.reduce((n, b) => n + b.length, 0), byteLength: uvBytes.length });
    parts.push(uvBytes);
    json.accessors.push({ bufferView: json.bufferViews.length - 1,
      componentType: 5126, count: 8, type: 'VEC2' });
    json.meshes[0].primitives[0].attributes.TEXCOORD_0 = json.accessors.length - 1;
    const imageBytes = makePng(8, 8);
    json.bufferViews.push({ buffer: 0, byteOffset: parts.reduce((n,b) => n + b.length, 0),
      byteLength: imageBytes.length });
    parts.push(imageBytes);
    json.images = [{ bufferView: json.bufferViews.length - 1, mimeType: 'image/png' }];
    json.samplers = [{ magFilter: 9729, minFilter: 9729 }];
    json.textures = [{ source: 0, sampler: 0 }];
    json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  }
  if (unsupported) json.extensionsRequired=['EXT_unavailable_diagnostics'];
  const bin=Buffer.concat(parts);json.buffers[0].byteLength=bin.length;
  const jsonText=Buffer.from(JSON.stringify(json));
  const pad=n=>(n+3)&~3;
  const jb=Buffer.concat([jsonText,Buffer.alloc(pad(jsonText.length)-jsonText.length,' ')]);
  const bb=Buffer.concat([bin,Buffer.alloc(pad(bin.length)-bin.length)]);
  const h=Buffer.alloc(12);h.write('glTF',0,'latin1');h.writeUInt32LE(2,4);h.writeUInt32LE(12+8+jb.length+8+bb.length,8);
  const ch=(bytes,id)=>{const b=Buffer.alloc(8);b.writeUInt32LE(bytes.length,0);b.writeUInt32LE(id,4);return Buffer.concat([b,bytes]);};
  return Buffer.concat([h,ch(jb,0x4e4f534a),ch(bb,0x004e4942)]);
}
(async()=>{
  const srv=await startServer();
  const browser=await launchBrowser(chromium);
  try{
    for(const reducedMotion of ['reduce','no-preference']){
      const page=await browser.newPage({viewport:{width:900,height:640},reducedMotion});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/api/media/omni-inspector.glb',r=>r.fulfill({contentType:'model/gltf-binary',body:glb({animated:true})}));
      await page.goto(srv.base+'/dexdiffusion/asset3d-viewer.html?artifact=omni-inspector.glb');
      await page.waitForFunction(()=>/2 meshes/.test(document.querySelector('#asset-status').innerText),null,{timeout:15000});
      assert.match(await page.locator('#asset-status').innerText(),/16 vertices · 24 triangles · 1 animation clips/);
      await page.locator('#asset-inspector summary').click();
      assert.ok(await page.locator('#asset-structure button').count()>=2,'both GLB scene nodes appear');
      await page.locator('#asset-structure button').first().click();
      assert.match(await page.locator('#asset-selected').innerText(),/bounds/);
      await page.locator('#asset-wireframe').click();
      assert.equal(await page.locator('#asset-wireframe').getAttribute('aria-pressed'),'true');
      await page.locator('#asset-normals').click();
      assert.equal(await page.locator('#asset-normals').getAttribute('aria-pressed'),'true');
      await page.locator('#asset-shaded').click();
      assert.equal(await page.locator('#asset-shaded').getAttribute('aria-pressed'),'true');
      await page.locator('#asset-clip').selectOption('0');
      assert.match(await page.locator('#asset-clip').locator('option').first().innerText(),/Translation test/);
      if(reducedMotion==='reduce'){
        assert.equal(await page.locator('#asset-animation').innerText(),'Play animation');
        const before=await page.evaluate(()=>__dexAssetMetrics.renders);
        await page.waitForTimeout(300);
        const after=await page.evaluate(()=>__dexAssetMetrics.renders);
        assert.ok(after-before<=2,'animation paused for reduced motion / idle economy: '+(after-before));
        await page.locator('#asset-animation').click();
        await page.waitForTimeout(1000);
        const running=await page.evaluate(()=>__dexAssetMetrics.renders);
        assert.ok(running-after>2,'user-initiated animation resumes rendering');
      } else {
        await page.locator('#asset-animation').click();
        assert.equal(await page.locator('#asset-animation').innerText(),'Play animation');
      }
      const metrics=await page.evaluate(()=>__dexAssetMetrics);
      assert.ok(Number.isFinite(metrics.parse_ms) && metrics.renders>2 && metrics.vertices===16);
      assert.deepEqual(errors,[]);
      await page.close();
    }
    const texturePage = await browser.newPage({ viewport: { width: 900, height: 640 } });
    const textureErrors = [], outsideRequests = [];
    texturePage.on('pageerror', e => textureErrors.push(e.message));
    texturePage.on('request', req => {
      if (!req.url().startsWith(srv.base + '/')) outsideRequests.push(req.url());
    });
    await texturePage.route('**/api/media/omni-texture.glb',
      r => r.fulfill({ contentType: 'model/gltf-binary', body: glb({ textured: true }) }));
    await texturePage.goto(srv.base + '/dexdiffusion/asset3d-viewer.html?artifact=omni-texture.glb');
    await texturePage.waitForFunction(() => /2 meshes/.test(document.querySelector('#asset-status').innerText),
      null, { timeout: 15000 });
    await texturePage.waitForTimeout(250);
    assert.deepEqual(textureErrors, [], 'embedded PNG texture is decoded and uploaded without page errors');
    assert.deepEqual(outsideRequests, [], 'self-contained GLB never downloads external textures/decoders');
    assert.ok((await texturePage.locator('#asset-canvas').screenshot()).byteLength > 3000,
      'textured 3D produces non-empty raster output');
    await texturePage.close();
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.route('**/api/media/unsupported.glb',r=>r.fulfill({contentType:'model/gltf-binary',body:glb({unsupported:true})}));
    await page.goto(srv.base+'/dexdiffusion/asset3d-viewer.html?artifact=unsupported.glb');
    await page.waitForFunction(()=>/unavailable/.test(document.querySelector('#asset-status').innerText),null,{timeout:10000});
    assert.match(await page.locator('#asset-status').innerText(),/EXT_unavailable_diagnostics/);
    await page.close();
    console.log('OMNI_VIEWER_INSPECTOR_PASS');
  }finally{await runCleanups();}
})().catch(async e=>{console.error(e);await runCleanups();process.exitCode=1;});
