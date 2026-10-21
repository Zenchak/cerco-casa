'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');

async function freePort(){
 const server=net.createServer();
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}
(async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'zenchak-profiles-'));
 fs.writeFileSync(path.join(dataDir,'notes.json'),'{}');
 const port=await freePort();
 const child=spawn(process.execPath,['server.js'],{
  cwd:path.resolve(__dirname,'..'),
  env:{...process.env,PORT:String(port),DATA_DIR:dataDir,GITHUB_TOKEN:'',CERCO_CASA_GITHUB_TOKEN:''},
  stdio:['ignore','pipe','pipe']
 });
 let output='';child.stdout.on('data',chunk=>{output+=chunk.toString()});
 child.stderr.on('data',chunk=>{output+=chunk.toString()});
 const base='http://127.0.0.1:'+port;
 const api=async(route,opts={})=>fetch(base+route,opts);
 const login=async(user,target,trusted=true)=>{
  const origin='https://127.0.0.1:'+port;
  const res=await api('/auth/password-login',{
   method:'POST',headers:{
    origin,'x-forwarded-proto':'https','x-auth-user':user,
    'x-auth-target':target,'x-auth-password-login':trusted?'1':'0',
    'x-zenchak-login':'1'
   }
  });
  return res;
 };
 try{
  let ready=false;
  for(let i=0;i<70;i++){
   if(child.exitCode!==null)throw Error('Backend terminated: '+output);
   try{const r=await api('/health');if(r.ok){ready=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready)throw Error('Server did not become ready: '+output);
  assert.equal((await api('/auth/check/bogdan')).status,401);
  assert.equal((await api('/auth/check/camilla')).status,401);
  const headers={'x-auth-fallback':'1','x-auth-user':'Bogdan'};
  assert.equal((await api('/auth/bootstrap',{headers})).status,404);
  assert.equal((await api('/auth/fallback',{headers})).status,404);
  assert.equal((await login('Bogdan','Bogdan',false)).status,403);
  assert.equal((await login('Camilla','Bogdan',true)).status,403);
  const bogdan=await login('Bogdan','Bogdan');
  assert.equal(bogdan.status,200);
  const bCookie=bogdan.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/auth/check/bogdan',{headers:{cookie:bCookie}})).status,204);
  assert.equal((await api('/auth/check/camilla',{headers:{cookie:bCookie}})).status,403);
  const who=await api('/auth/me',{headers:{cookie:bCookie}}).then(r=>r.json());
  assert.equal(who.user,'Bogdan');
  const camilla=await login('Camilla','Camilla');
  assert.equal(camilla.status,200);
  const cCookie=camilla.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/auth/check/camilla',{headers:{cookie:cCookie}})).status,204);
  assert.equal((await api('/auth/check/bogdan',{headers:{cookie:cCookie}})).status,403);
  assert.equal((await api('/api/notes')).status,401);
  const note=await api('/api/notes',{
   method:'POST',headers:{cookie:cCookie,'content-type':'application/json'},
   body:JSON.stringify({homeId:'test',author:'Bogdan',text:'Nota di prova'})
  });
  assert.equal(note.status,201);
  const notes=await api('/api/notes',{headers:{cookie:cCookie}}).then(r=>r.json());
  assert.equal(notes.test[0].author,'Camilla');
  console.log('ZENCHAK_PROFILE_AUTH_TEST_OK');
 }finally{
  child.kill('SIGTERM');
  await new Promise(resolve=>child.once('exit',resolve));
  fs.rmSync(dataDir,{recursive:true,force:true});
 }
})().catch(err=>{console.error(err);process.exitCode=1});
