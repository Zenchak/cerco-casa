'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
module.exports=function createFamilyFinance({dataDir,verifySession}){
 const file=path.join(dataDir,'family-finances.json');
 const allowedCategories=['Affitto','Bollette','Spesa alimentare','Casa','Trasporti','Salute','Tempo libero','Viaggi','Altro','Versamento','Rimborso'];
 const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
 const read=()=>{try{const d=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(d)?d:[]}catch{return []}};
 const save=items=>{const tmp=file+'.'+crypto.randomBytes(5).toString('hex')+'.tmp';fs.writeFileSync(tmp,JSON.stringify(items,null,2),{mode:0o600});fs.renameSync(tmp,file)};
 const send=(res,status,data)=>{const b=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(b)});res.end(b)};
 const body=async req=>{let size=0,parts=[];for await(const part of req){size+=part.length;if(size>16000)throw Error('Richiesta troppo grande');parts.push(part)}return JSON.parse(Buffer.concat(parts).toString('utf8'))};
 const sameOrigin=req=>{const origin=req.headers.origin;if(!origin)return true;try{const o=new URL(origin);return (o.protocol==='https:'||o.protocol==='http:')&&o.host.toLowerCase()===String(req.headers.host||'').toLowerCase()}catch{return false}};
 return async(req,res,u)=>{
  if(!/^\/api\/family-finances(?:\/[^/]*)?$/.test(u.pathname))return false;
  const user=verifySession(req);
  if(!user||!['Bogdan','Camilla'].includes(user.user)){send(res,401,{error:'Accesso richiesto'});return true}
  if(req.method==='GET'&&u.pathname==='/api/family-finances'){send(res,200,{ok:true,items:read(),categories:allowedCategories});return true}
  if(!['POST','PUT','DELETE'].includes(req.method)){send(res,405,{error:'Metodo non consentito'});return true}
  if(req.headers['x-zenchak-family']!=='1'||!sameOrigin(req)){send(res,403,{error:'Richiesta non autorizzata'});return true}
  const items=read();
  const id=u.pathname.split('/')[3];
  if(req.method==='POST'&&id==='import'){
   try{
    if(user.user!=='Bogdan')return send(res,403,{error:'Importazione riservata a Bogdan'}),true;
    let size=0,parts=[];
    for await(const chunk of req){size+=chunk.length;if(size>500000)throw Error('Archivio troppo grande');parts.push(chunk)}
    const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
    if(data.format!=='zenchak-family-finances-v1'||!Array.isArray(data.items)||data.items.length>2000)throw Error('Formato archivio non valido');
    const existing=new Set(items.map(x=>x.id));
    let added=0;
    for(const x of data.items){
      const id=String(x.id||'');
      const date=String(x.date||'');
      const type=String(x.type||'');
      const amount=Number(x.amount);
      const description=String(x.description||'').trim().slice(0,180);
      const category=String(x.category||'');
      if(!/^ing-[a-f0-9]{24}$/.test(id)||!validDate(date)||!['expense','income'].includes(type)||!Number.isFinite(amount)||amount<=0||amount>1000000||!description||!allowedCategories.includes(category))throw Error('Movimento non valido nel file');
    }
    if(items.length+data.items.length>10000)throw Error('Archivio troppo grande');
    for(const x of data.items){if(existing.has(x.id))continue;items.push({id:x.id,date:x.date,type:x.type,amount:x.amount,description:x.description,category:x.category,source:x.source,createdBy:'Importazione ING',updatedBy:user.user,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});existing.add(x.id);added++}
    if(added)save(items);
    send(res,200,{ok:true,added,skipped:data.items.length-added,total:items.length});
   }catch(e){send(res,400,{error:e.message||'Importazione non riuscita'})}
   return true;
  }
  if(req.method==='DELETE'){
   if(!id||!items.some(x=>x.id===id)){send(res,404,{error:'Movimento non trovato'});return true}
   save(items.filter(x=>x.id!==id));send(res,200,{ok:true});return true;
  }
  if(req.method==='PUT'&&(!id||!items.some(x=>x.id===id))){send(res,404,{error:'Movimento non trovato'});return true}
  try{
   const input=await body(req);
   const date=String(input.date||'');
   const type=String(input.type||'');
   const amount=Number(input.amount);
   const description=String(input.description||'').trim().slice(0,180);
   const category=String(input.category||'');
   if(!validDate(date)||!['expense','income'].includes(type)||!Number.isFinite(amount)||amount<=0||amount>1000000||!description||!allowedCategories.includes(category))throw Error('Controlla data, importo, descrizione e categoria');
   const value={id:id||crypto.randomUUID(),date,type,amount:Math.round(amount*100)/100,description,category,createdBy:user.user,updatedBy:user.user,updatedAt:new Date().toISOString()};
   if(req.method==='POST'){if(items.length>=10000)throw Error('Archivio pieno');items.push({...value,createdAt:value.updatedAt})}
   else{const i=items.findIndex(x=>x.id===id);items[i]={...items[i],...value,createdBy:items[i].createdBy,createdAt:items[i].createdAt}}
   save(items);send(res,200,{ok:true,item:items.find(x=>x.id===value.id)});
  }catch(e){send(res,400,{error:e.message||'Dati non validi'})}
  return true;
 };
};
