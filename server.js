// Boomerang backend v3: permanent storage in Supabase (falls back to a local file if not configured)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,ADMIN=process.env.ADMIN_PASS||'boomerang',DB=path.join(process.env.DATA_DIR||__dirname,'data.json');
const SB=(process.env.SUPABASE_URL||'').replace(/\/$/,''),SK=process.env.SUPABASE_KEY||'';
const sbh={apikey:SK,'Content-Type':'application/json',...(SK.startsWith('eyJ')?{Authorization:'Bearer '+SK}:{})};
const must=async r=>{if(!r.ok)throw new Error('db '+r.status+' '+await r.text());return r};
let mem={};if(!SB){try{mem=JSON.parse(fs.readFileSync(DB))}catch{}}
const saveMem=()=>fs.writeFileSync(DB,JSON.stringify(mem));
const store=SB?{
 get:async c=>{const j=await(await must(await fetch(`${SB}/rest/v1/stickers?code=eq.${c}&select=data`,{headers:sbh}))).json();return j[0]?j[0].data:null},
 put:async(c,d)=>{await must(await fetch(`${SB}/rest/v1/stickers`,{method:'POST',headers:{...sbh,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({code:c,data:d})}))},
 byKeys:async ks=>{ks=ks.filter(k=>/^[a-f0-9]{32}$/.test(k));if(!ks.length)return[];const j=await(await must(await fetch(`${SB}/rest/v1/stickers?select=code,data&data->>key=in.(${ks.join(',')})`,{headers:sbh}))).json();return j.map(x=>[x.code,x.data])},
 create:async codes=>{const r=await fetch(`${SB}/rest/v1/stickers`,{method:'POST',headers:{...sbh,Prefer:'return=minimal'},body:JSON.stringify(codes.map(code=>({code,data:{msgs:[]}})))});if(r.status===409)return false;await must(r);return true}
}:{
 get:async c=>mem[c]||null,
 put:async(c,d)=>{mem[c]=d;saveMem()},
 byKeys:async ks=>Object.entries(mem).filter(([,s])=>s.key&&ks.includes(s.key)),
 create:async codes=>{if(codes.some(c=>mem[c]))return false;codes.forEach(c=>mem[c]={msgs:[]});saveMem();return true}
};
const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genCode=()=>'BMR-'+Array.from({length:5},()=>A[crypto.randomInt(A.length)]).join('');
const hits={},limited=ip=>{const n=Date.now(),a=hits[ip]=(hits[ip]||[]).filter(t=>n-t<6e4);a.push(n);return a.length>40};
const send=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
const body=q=>new Promise(r=>{let b='';q.on('data',d=>{b+=d;if(b.length>5e3)q.destroy()});q.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch{r({})}})});
const clip=(s,n)=>String(s||'').trim().slice(0,n);
const pub=s=>({state:s.key?'active':'unclaimed',item:s.item||'',msgs:s.msgs||[]});
const notify=(s,text)=>{
 if(process.env.NOTIFY_WEBHOOK)fetch(process.env.NOTIFY_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:s.contact,item:s.item,text})}).catch(()=>{});
 const key=process.env.BREVO_API_KEY,from=process.env.MAIL_FROM;
 if(!key||!from||!/^\S+@\S+\.\S+$/.test(s.contact)||Date.now()-(s.lastMail||0)<12e4)return;
 s.lastMail=Date.now();
 const site=process.env.SITE_URL||process.env.RENDER_EXTERNAL_URL||'';
 fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:'Boomerang',email:from},to:[{email:s.contact}],subject:'Someone found your '+s.item+'!',textContent:'Good news! Someone found your '+s.item+' and sent you a message:\n\n"'+text+'"\n\nReply here: '+site+'\n(Open it in the same browser you used to claim the sticker.)'})}).then(r=>{if(!r.ok)console.log('mail failed',r.status)}).catch(e=>console.log('mail error',e.message));
};
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://x'),p=u.pathname;
 if(p.startsWith('/api/')){
  if(limited(req.socket.remoteAddress))return send(res,429,{error:'Too many requests, wait a minute.'});
  let m;
  if(req.method==='POST'&&p==='/api/issue'){const b=await body(req);if(b.pass!==ADMIN)return send(res,403,{error:'Wrong admin password'});
   const n=Math.min(Math.max(+b.n||12,1),100);
   for(let t=0;t<4;t++){const codes=Array.from({length:n},genCode);if(new Set(codes).size===n&&await store.create(codes))return send(res,200,{codes})}
   return send(res,500,{error:'Could not make codes, try again'})}
  if(req.method==='GET'&&p==='/api/inbox'){const keys=(u.searchParams.get('keys')||'').split(',').filter(Boolean);
   return send(res,200,{items:(await store.byKeys(keys)).map(([code,s])=>({code,key:s.key,item:s.item,contact:s.contact,msgs:s.msgs||[]}))})}
  if(m=p.match(/^\/api\/sticker\/(BMR-[A-Z0-9]{5})(?:\/(claim|message|reply))?$/)){
   const code=m[1],s=await store.get(code);if(!s)return send(res,404,{state:'unknown'});
   if(!m[2])return send(res,200,pub(s));
   if(req.method!=='POST')return send(res,405,{});
   const b=await body(req);s.msgs=s.msgs||[];
   if(m[2]==='claim'){if(s.key)return send(res,409,{error:'Already claimed'});
    const item=clip(b.item,60),contact=clip(b.contact,80);if(!item||!contact)return send(res,400,{error:'Item and contact needed'});
    s.item=item;s.contact=contact;s.key=crypto.randomBytes(16).toString('hex');await store.put(code,s);return send(res,200,{key:s.key})}
   if(!s.key)return send(res,400,{error:'Sticker not claimed yet'});
   if(s.msgs.length>=200)return send(res,429,{error:'Chat is full'});
   const text=clip(b.text,300);if(!text)return send(res,400,{error:'Empty message'});
   if(m[2]==='message'){s.msgs.push({from:'finder',text,t:Date.now()});notify(s,text);await store.put(code,s);return send(res,200,{ok:true})}
   if(b.key!==s.key)return send(res,403,{error:'Not the owner'});
   s.msgs.push({from:'owner',text,t:Date.now()});await store.put(code,s);return send(res,200,{ok:true})}
  return send(res,404,{error:'Not found'})}
 const f=p==='/print'?'print.html':'app.html';
 fs.readFile(path.join(__dirname,'public',f),(e,d)=>{if(e){res.writeHead(500);return res.end('error')}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(d)});
}catch(e){console.log(e.message);send(res,500,{error:'Server problem, try again'})}}).listen(PORT,()=>console.log('Boomerang on '+PORT+(SB?' (Supabase)':' (local file)')));
