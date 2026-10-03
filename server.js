// Boomerang backend: zero dependencies. Run: node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,ADMIN=process.env.ADMIN_PASS||'boomerang',DB=path.join(process.env.DATA_DIR||__dirname,'data.json');
let db={stickers:{}};try{db=JSON.parse(fs.readFileSync(DB))}catch{}
const save=()=>fs.writeFileSync(DB,JSON.stringify(db));
const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode=()=>{let c;do{c='BMR-'+Array.from({length:5},()=>A[crypto.randomInt(A.length)]).join('')}while(db.stickers[c]);return c};
const hits={},limited=ip=>{const n=Date.now(),a=hits[ip]=(hits[ip]||[]).filter(t=>n-t<6e4);a.push(n);return a.length>40};
const send=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
const body=q=>new Promise(r=>{let b='';q.on('data',d=>{b+=d;if(b.length>5e3)q.destroy()});q.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch{r({})}})});
const clip=(s,n)=>String(s||'').trim().slice(0,n);
const pub=s=>({state:s.key?'active':'unclaimed',item:s.item||'',msgs:s.msgs});
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://x'),p=u.pathname;
 if(p.startsWith('/api/')){
  if(limited(req.socket.remoteAddress))return send(res,429,{error:'Too many requests, wait a minute.'});
  let m;
  if(req.method==='POST'&&p==='/api/issue'){const b=await body(req);if(b.pass!==ADMIN)return send(res,403,{error:'Wrong admin password'});
   const n=Math.min(Math.max(+b.n||12,1),100),codes=[];for(let i=0;i<n;i++){const c=newCode();db.stickers[c]={msgs:[]};codes.push(c)}save();return send(res,200,{codes})}
  if(req.method==='GET'&&p==='/api/inbox'){const keys=(u.searchParams.get('keys')||'').split(',').filter(Boolean);
   return send(res,200,{items:Object.entries(db.stickers).filter(([,s])=>s.key&&keys.includes(s.key)).map(([code,s])=>({code,key:s.key,item:s.item,contact:s.contact,msgs:s.msgs}))})}
  if(m=p.match(/^\/api\/sticker\/(BMR-[A-Z0-9]{5})(?:\/(claim|message|reply))?$/)){
   const code=m[1],s=db.stickers[code];if(!s)return send(res,404,{state:'unknown'});
   if(!m[2])return send(res,200,pub(s));
   if(req.method!=='POST')return send(res,405,{});
   const b=await body(req);
   if(m[2]==='claim'){if(s.key)return send(res,409,{error:'Already claimed'});
    const item=clip(b.item,60),contact=clip(b.contact,80);if(!item||!contact)return send(res,400,{error:'Item and contact needed'});
    s.item=item;s.contact=contact;s.key=crypto.randomBytes(16).toString('hex');save();return send(res,200,{key:s.key})}
   if(!s.key)return send(res,400,{error:'Sticker not claimed yet'});
   if(s.msgs.length>=200)return send(res,429,{error:'Chat is full'});
   const text=clip(b.text,300);if(!text)return send(res,400,{error:'Empty message'});
   if(m[2]==='message'){s.msgs.push({from:'finder',text,t:Date.now()});save();
    if(process.env.NOTIFY_WEBHOOK)fetch(process.env.NOTIFY_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:s.contact,item:s.item,text})}).catch(()=>{});
    return send(res,200,{ok:true})}
   if(b.key!==s.key)return send(res,403,{error:'Not the owner'});
   s.msgs.push({from:'owner',text,t:Date.now()});save();return send(res,200,{ok:true})}
  return send(res,404,{error:'Not found'})}
 const f=p==='/print'?'print.html':'app.html';
 fs.readFile(path.join(__dirname,'public',f),(e,d)=>{if(e){res.writeHead(500);return res.end('error')}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(d)});
}).listen(PORT,()=>console.log('Boomerang running on http://localhost:'+PORT));
