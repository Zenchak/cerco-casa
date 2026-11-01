'use strict';
/**
 * Zenchak Hub: media personali su volume NAS persistente (/data).
 * I PNG/JPEG/SVG vengono convertiti dal browser in WebP; GIF animate conservate.
 * Nessun upload viene scritto nelle cartelle Git sincronizzate.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SLOTS = Object.freeze([
  'home-logo','home-impostazioni','home-viaggi','home-allenamenti','home-casa','home-finanze','home-auto','home-gare','home-salute','home-finanze-familiari',
  'auto-kia','auto-fiat','profile-bogdan','profile-camilla',
  'sport-running','sport-bike','sport-swim','sport-trail','sport-walk','sport-gym','viaggi-in-partenza','viaggi-mappa','viaggi-elenco','ui-home','ui-refresh'
]);
const SLOT_SET = new Set(SLOTS);
// Solo Bogdan gestisce le immagini associate alle proprie aree private.
const BOGDAN_SLOTS = new Set([
  'home-allenamenti','home-finanze','home-gare','home-salute',
  'sport-running','sport-bike','sport-swim','sport-trail','sport-walk','sport-gym'
]);
const mayAccess=(user,slot)=>user.user==='Bogdan'||(slot==='profile-bogdan'?false:slot==='profile-camilla'?user.user==='Camilla':!BOGDAN_SLOTS.has(slot));
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = {
  'image/png': {ext:'png', test:b=>b.length>8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))},
  'image/jpeg': {ext:'jpg', test:b=>b.length>4 && b[0]===255 && b[1]===216 && b[2]===255},
  'image/webp': {ext:'webp',test:b=>b.length>12 && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP'},
  'image/gif': {ext:'gif', test:b=>b.length>6 && ['GIF87a','GIF89a'].includes(b.toString('ascii',0,6))}
};
function send(res,status,obj){
 const body=JSON.stringify(obj);
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','content-length':Buffer.byteLength(body),'x-content-type-options':'nosniff'});
 res.end(body);
}
function validOrigin(req){
 const origin=req.headers.origin;
 if(!origin)return true;
 try{
   const u=new URL(origin);
   const host=String(req.headers.host||'').toLowerCase();
   return (u.protocol==='https:'||u.protocol==='http:') && u.host.toLowerCase()===host;
 }catch{return false}
}
async function readBinary(req){
 if(Number(req.headers['content-length']||0)>MAX_BYTES)throw Object.assign(new Error('File troppo grande (massimo 8 MB)'),{status:413});
 const chunks=[];let size=0;
 for await(const chunk of req){
   size+=chunk.length;
   if(size>MAX_BYTES)throw Object.assign(new Error('File troppo grande (massimo 8 MB)'),{status:413});
   chunks.push(chunk);
 }
 return Buffer.concat(chunks,size);
}
function writeJsonAtomic(file,data){
 const tmp=file+'.'+crypto.randomBytes(5).toString('hex')+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});
 fs.renameSync(tmp,file);
}
module.exports=function createMediaHandler({dataDir,verifySession}){
 const dir=path.join(dataDir,'hub-media');
 const indexFile=path.join(dir,'manifest.json');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 function manifest(){
   try{
     const json=JSON.parse(fs.readFileSync(indexFile,'utf8'));
     return json && typeof json==='object' && !Array.isArray(json)?json:{};
   }catch{return {}}
 }
 function active(entry,slot){
   if(!entry||!entry.file)return null;
   return {...entry,url:'/media-file/'+slot+'?v='+encodeURIComponent(entry.hash||'1')};
 }
 return async function handle(req,res,u){
   if(!u.pathname.startsWith('/api/media/')&&!u.pathname.startsWith('/media-file/'))return false;
   const user=verifySession(req);
   if(!user){send(res,401,{error:'Sessione non valida: accedi nuovamente all’Hub.'});return true}
   const m=manifest();
   if(u.pathname==='/api/media/' && req.method==='GET'){
     const items={};
     for(const slot of SLOTS)if(mayAccess(user,slot)&&m[slot])items[slot]=active(m[slot],slot);
     send(res,200,{ok:true,slots:SLOTS.filter(slot=>mayAccess(user,slot)),items});
     return true;
   }
   const fileMatch=/^\/media-file\/([a-z0-9-]+)$/.exec(u.pathname);
   if(fileMatch&&req.method==='GET'){
     const slot=fileMatch[1],entry=m[slot];
     if(!SLOT_SET.has(slot)||!entry||!entry.file){send(res,404,{error:'Immagine non trovata'});return true}
     if(!mayAccess(user,slot)){send(res,403,{error:'Immagine riservata a un altro profilo'});return true}
     const file=path.join(dir,path.basename(entry.file));
     try{
       const stat=fs.statSync(file);
       if(!stat.isFile())throw new Error('Non è un file');
       res.writeHead(200,{
         'content-type':entry.type,
         'content-length':stat.size,
         'cache-control':'private, max-age=604800',
         'x-content-type-options':'nosniff',
         'content-disposition':'inline',
         'cross-origin-resource-policy':'same-origin'
       });
       fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
     }catch{send(res,404,{error:'File non disponibile'})}
     return true;
   }
   const slotMatch=/^\/api\/media\/([a-z0-9-]+)$/.exec(u.pathname);
   if(!slotMatch||!SLOT_SET.has(slotMatch[1])){
     send(res,404,{error:'Risorsa media sconosciuta'});return true;
   }
   const slot=slotMatch[1];
   if(!mayAccess(user,slot)){send(res,403,{error:'Questo profilo non può modificare l’immagine'});return true}
   if(!['POST','DELETE'].includes(req.method)){send(res,405,{error:'Metodo non consentito'});return true}
   // L'intestazione custom impedisce richieste CSRF tramite form HTML cross-site.
   if(req.headers['x-zenchak-media']!=='1'||!validOrigin(req)){
     send(res,403,{error:'Richiesta non autorizzata'});return true;
   }
   if(req.method==='DELETE'){
     delete m[slot];
     writeJsonAtomic(indexFile,m);
     send(res,200,{ok:true,slot,reset:true});return true;
   }
   const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
   const allowed=ALLOWED_TYPES[type];
   if(!allowed){send(res,415,{error:'Formato non supportato: usa PNG, JPEG, WebP o GIF. Gli SVG si possono convertire in WebP dalla pagina.'});return true}
   let buffer;
   try{buffer=await readBinary(req)}catch(e){send(res,e.status||400,{error:e.message});return true}
   if(!allowed.test(buffer)){send(res,415,{error:'Il contenuto non corrisponde al formato dichiarato'});return true}
   const hash=crypto.createHash('sha256').update(buffer).digest('hex');
   const file=slot+'-'+hash.slice(0,16)+'.'+allowed.ext;
   const filename=path.join(dir,file);
   if(!fs.existsSync(filename))fs.writeFileSync(filename,buffer,{mode:0o600});
   const entry={file,hash,type,size:buffer.length,updatedAt:new Date().toISOString()};
   m[slot]=entry;
   writeJsonAtomic(indexFile,m);
   send(res,200,{ok:true,slot,item:active(entry,slot)});
   return true;
 };
};
