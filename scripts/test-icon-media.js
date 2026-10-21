/* npm-free smoke test for the NAS media API. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const createMediaHandler=require('../icon-media');

(async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'zenchak-media-test-'));
 const handler=createMediaHandler({dataDir,verifySession:req=>req.headers.cookie==='session=ok'?{user:'Bogdan'}:null});
 const server=http.createServer(async(req,res)=>{try{
  const ok=await handler(req,res,new URL(req.url,'http://localhost'));
  if(!ok){res.writeHead(404);res.end()}
 }catch(e){res.writeHead(500);res.end(String(e))}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
 const auth={Cookie:'session=ok'};
 try{
  const noAuth=await fetch(base+'/api/media/');
  assert.equal(noAuth.status,401);
  const init=await fetch(base+'/api/media/',{headers:auth}).then(x=>x.json());
  assert.deepEqual(init.items,{});
  const forbidden=await fetch(base+'/api/media/home-auto',{method:'POST',headers:{...auth,'Content-Type':'image/gif','X-Zenchak-Media':'1',Origin:'https://attacker.example'},body:gif});
  assert.equal(forbidden.status,403);
  const upload=await fetch(base+'/api/media/home-auto',{method:'POST',headers:{...auth,'Content-Type':'image/gif','X-Zenchak-Media':'1',Origin:base},body:gif});
  assert.equal(upload.status,200);
  const info=await upload.json();
  assert.equal(info.item.type,'image/gif');
  assert.equal(info.item.size,gif.length);
  const file=await fetch(base+info.item.url,{headers:auth});
  assert.equal(file.status,200);
  assert.equal(file.headers.get('content-type'),'image/gif');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),gif);
  const list=await fetch(base+'/api/media/',{headers:auth}).then(x=>x.json());
  assert.ok(list.items['home-auto']);
  const reset=await fetch(base+'/api/media/home-auto',{method:'DELETE',headers:{...auth,'X-Zenchak-Media':'1',Origin:base}});
  assert.equal(reset.status,200);
  const gone=await fetch(base+'/media-file/home-auto',{headers:auth});
  assert.equal(gone.status,404);
  process.stdout.write('ZENCHAK_MEDIA_SELFTEST_OK\n');
 }finally{
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(dataDir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
