'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('child_process');
const PY=process.env.DEX_IMAGE_VALIDATION_PYTHON || 'python3';
function writePly(file, withColor=true) {
  const cols=withColor?['property float f_dc_0','property float f_dc_1','property float f_dc_2']:[];
  const header=['ply','format binary_little_endian 1.0','element vertex 2','property float x','property float y','property float z',...cols,'end_header',''].join('\n');
  const b=Buffer.alloc(withColor?48:24);
  const rows=withColor?[[0,0,0,0.65,-0.3,-0.2],[0.3,0.1,0.2,-0.45,0.3,0.6]]:[[0,0,0],[0.3,0.1,0.2]];
  rows.forEach((r,i)=>r.forEach((x,j)=>b.writeFloatLE(x, i*r.length*4+j*4)));
  fs.writeFileSync(file,Buffer.concat([Buffer.from(header),b]));
}

test('World fusion reads real Gaussian SH DC color, never fabricates gray',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-sharp-color-'));
 try{
  const source=path.join(dir,'sharp.ply');writePly(source);
  const inputs=path.join(dir,'inputs.json');fs.writeFileSync(inputs,JSON.stringify([{path:source,yaw:0,pitch:0}]));
  const output=path.join(dir,'fused.ply'),manifest=path.join(dir,'fused.json');
  const run=spawnSync(PY,[path.join(__dirname,'..','world-compiler.py'),'fuse','--inputs',inputs,'--output',output,'--manifest',manifest,'--voxel-size','0.02'],{encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);
  const metrics=JSON.parse(fs.readFileSync(manifest,'utf8'));
  assert.equal(metrics.colorEncoding,'rgb-from-source-or-sh-dc');assert.equal(metrics.gaussianParametersPreserved,false);
  const out=fs.readFileSync(output);const offset=out.indexOf(Buffer.from('end_header\n'))+11;
  const r1=[out[offset+12],out[offset+13],out[offset+14]],r2=[out[offset+27],out[offset+28],out[offset+29]];
  assert.notDeepEqual(r1,[180,180,180]);assert.notDeepEqual(r2,[180,180,180]);
  assert.notDeepEqual(r1,r2);assert.ok(metrics.colorRange.r[0]<metrics.colorRange.r[1]);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('World fusion rejects source missing color instead of silently whitening all points',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-no-color-'));
 try{
  const source=path.join(dir,'unknown.ply');writePly(source,false);
  const inputs=path.join(dir,'inputs.json');fs.writeFileSync(inputs,JSON.stringify([{path:source,yaw:0,pitch:0}]));
  const run=spawnSync(PY,[path.join(__dirname,'..','world-compiler.py'),'fuse','--inputs',inputs,'--output',path.join(dir,'out.ply'),'--manifest',path.join(dir,'out.json')],{encoding:'utf8',timeout:15000});
  assert.notEqual(run.status,0);assert.match(run.stderr,/no RGB or Gaussian SH DC colors/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
