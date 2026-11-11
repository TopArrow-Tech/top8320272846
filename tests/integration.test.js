'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const {startApp}=require('../server');
const {layout}=require('../server/validation');
const WebSocket=require('../vendor/ws');
const root=path.resolve(process.env.TOPARROW_DATA_DIR||path.join(__dirname,'..','data'));
test('reject unsafe startup configuration',()=>{assert.throws(()=>startApp({dataDir:'relative',port:0}),/absolute/);assert.throws(()=>startApp({dataDir:root,port:NaN}),/PORT/);});
test('validate layer ownership, geometry and references',()=>{const base={s:{background:'#000000',layers:[{id:'l',type:'image',asset:'a',x:90,y:0,w:20,h:100}]}};assert.throws(()=>layout(base,[{id:'s'}],[{id:'a',type:'image'}]),/invalidLayout/);base.s.layers[0].x=0;assert.throws(()=>layout(base,[{id:'s'}],[]),/missingAsset/);assert.throws(()=>layout(base,[{id:'other'}],[{id:'a',type:'image'}]),/invalidLayout/);});
test('complete local show lifecycle, security and show recovery',async t=>{
 fs.mkdirSync(path.join(root,'tmp'),{recursive:true});const data=fs.mkdtempSync(path.join(root,'tmp','integration-'));let app=startApp({dataDir:data,port:0});let addr=await app.ready;let base='http://127.0.0.1:'+addr.port;
 t.after(async()=>{await app.close();fs.rmSync(data,{recursive:true,force:true});});
 const boot=await (await fetch(base+'/api/bootstrap')).json();let csrf=boot.csrf;
 async function call(route,value){const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-StagePilot-CSRF':csrf},body:JSON.stringify(value)});const d=await r.json();return {status:r.status,...d};}
 assert.equal((await fetch(base+'/__health')).status,200);assert.equal(boot.network.enabled,false);
 await t.test('management rejects CSRF, foreign origin and forged host',async()=>{
  assert.equal((await fetch(base+'/api/activities',{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/bootstrap',{headers:{Origin:'http://evil.invalid'}})).status,403);
  const forged=await new Promise((resolve,reject)=>{const req=require('node:http').get(base+'/api/bootstrap',{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(forged,403);
  assert.equal((await fetch(base+'/server/index.js')).status,404);
 });
 const activity=(await call('activities',{name:'Test show'})).id;assert.ok(activity);
 const screen=(await call('screens',{activity,name:'Main'})).id;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=','base64');
 let upload=await fetch(base+'/api/upload?activity='+activity+'&name=dot.png',{method:'POST',headers:{'X-StagePilot-CSRF':csrf},body:png});assert.equal(upload.status,201);const asset=(await upload.json()).id;
 await t.test('uploads reject executable and fake media',async()=>{
  for(const filename of ['bad.svg','fake.png','fake.mov']){const r=await fetch(base+'/api/upload?activity='+activity+'&name='+filename,{method:'POST',headers:{'X-StagePilot-CSRF':csrf},body:'<script>bad</script>'});assert.equal(r.status,415);}
  const mov=Buffer.alloc(24);mov.writeUInt32BE(24,0);mov.write('ftypqt  ',4);mov.write('qt  ',16);
  const accepted=await fetch(base+'/api/upload?activity='+activity+'&name=recording.mov',{method:'POST',headers:{'X-StagePilot-CSRF':csrf},body:mov});assert.equal(accepted.status,201);const movId=(await accepted.json()).id;
  assert.equal(app.snapshot().assets.find(a=>a.id===movId).mime,'video/quicktime');assert.equal((await call('assets/delete',{id:movId})).status,200);
  assert.deepEqual(fs.readdirSync(path.join(data,'tmp')),[]);
 });
 const config={[screen]:{background:'#001122',layers:[{id:'image',type:'image',asset,x:0,y:0,w:100,h:100,fit:'contain',opacity:1},{id:'text',type:'text',text:'Welcome',x:0,y:75,w:100,h:25,fontSize:8,color:'#ffffff',align:'center',transparent:true,effect:{type:'left',duration:12}}]}};
 const scene=(await call('scenes',{activity,name:'Opening',layout:config})).id;assert.ok(scene);
 assert.equal((await call('assets/delete',{id:asset})).status,409);
 await t.test('activity duplication remaps screens and copies independent assets',async()=>{const duplicate=(await call('activities/duplicate',{id:activity})).id;assert.ok(duplicate);const copied=app.snapshot();const a=copied.assets.find(x=>x.activity===duplicate),sc=copied.scenes.find(x=>x.activity===duplicate),scr=copied.screens.find(x=>x.activity===duplicate);assert.ok(a&&sc&&scr);assert.notEqual(a.id,asset);assert.ok(sc.layout[scr.id]);assert.equal(sc.layout[scr.id].layers[0].asset,a.id);const impact=await call('deletion/preview',{kind:'activities',id:duplicate});assert.equal((await call('activities/delete',{id:duplicate,confirmation:impact.fingerprint})).status,200);assert.equal((await fetch(base+'/media/'+asset)).status,200);});
 for(const route of ['backups','migration/export','migration/apply'])assert.equal((await call(route,{})).status,404);
 assert.equal(Object.hasOwn(app.snapshot(),'backups'),false);
 let secondScreen,secondScene;
 await t.test('paired display receives state and only assigned media',async t=>{
   const ifaces=app.snapshot().network.interfaces;if(!ifaces.length){t.skip('No LAN interface');return;}
   assert.equal((await call('lan',{enabled:true,address:ifaces[0].address,acceptHttp:false})).status,400);
   const net=await call('lan',{enabled:true,address:ifaces[0].address,acceptHttp:true});assert.equal(net.status,200);const remote='http://'+net.address+':'+net.port;
   const post=async(route,value)=>{const r=await fetch(remote+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,data:await r.json(),headers:r.headers};};
   assert.equal((await fetch(remote+'/api/bootstrap')).status,404);
   assert.equal((await fetch(remote+'/media/'+asset)).status,401);
   assert.equal((await post('/pair',{name:'TV',code:'000000'})).status,403);
   const request=(await post('/pair',{name:'TV',code:net.code})).data;
   const device=(await call('pair/approve',{id:request.id,name:'TV',screen})).id;assert.ok(device);
   assert.equal((await call('pair/approve',{id:request.id,name:'TV',screen})).status,409);
   const auth=(await post('/pair/status',request)).data;assert.ok(auth.token);
   const session=await post('/session',{token:auth.token});assert.match(session.headers.get('set-cookie'),/HttpOnly/);
   const ws=new WebSocket('ws://'+net.address+':'+net.port+'/socket',{origin:remote});await once(ws,'open');
   const initial=once(ws,'message');ws.send(JSON.stringify({type:'auth',token:auth.token}));assert.equal(JSON.parse((await initial)[0]).blackout,true);
   const next=once(ws,'message');await call('control',{action:'take',scene});const frame=JSON.parse((await next)[0]);assert.equal(frame.screen,screen);assert.ok(frame.startAt>Date.now()+2000);assert.equal(frame.config.layers.length,2);assert.deepEqual(frame.config.layers[1].effect,{type:'left',duration:12});
   const media=await fetch(remote+'/media/'+asset,{headers:{Cookie:session.headers.get('set-cookie').split(';')[0],Range:'bytes=0-7'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,8);
   assert.equal((await fetch(remote+'/media/'+asset,{headers:{Authorization:'Bearer wrong'}})).status,401);
   await t.test('taking screen two preserves screen one content and video timeline',async()=>{
     secondScreen=(await call('screens',{activity,name:'Second'})).id;
     secondScene=(await call('scenes',{activity,name:'Second only',layout:{[secondScreen]:{background:'#223344',layers:[{id:'label',type:'text',text:'Screen two',x:0,y:0,w:100,h:100,fontSize:8,color:'#ffffff'}]}}})).id;
     const request2=(await post('/pair',{name:'TV two',code:net.code})).data;
     await call('pair/approve',{id:request2.id,name:'TV two',screen:secondScreen});
     const auth2=(await post('/pair/status',request2)).data;
     const ws2=new WebSocket('ws://'+net.address+':'+net.port+'/socket',{origin:remote});await once(ws2,'open');
     try{
       const initial2=once(ws2,'message');ws2.send(JSON.stringify({type:'auth',token:auth2.token}));await initial2;
       const firstNext=once(ws,'message'),secondNext=once(ws2,'message');
       assert.equal((await call('control',{action:'take',scene:secondScene})).status,200);
       const first=JSON.parse((await firstNext)[0]),second=JSON.parse((await secondNext)[0]);
       assert.deepEqual(first.config,frame.config);assert.equal(first.cue,frame.cue);assert.equal(first.startAt,frame.startAt);assert.equal(first.version,frame.version);
       assert.equal(first.blackout,false);assert.equal(second.config.layers[0].text,'Screen two');
       assert.equal((await fetch(remote+'/media/'+asset,{headers:{Authorization:'Bearer '+auth.token}})).status,200);
       assert.equal((await call('scenes/delete',{id:scene})).status,409);
       const empty=(await call('scenes',{activity,name:'No configured screens',layout:{}})).id;
       assert.equal((await call('control',{action:'take',scene:empty})).status,400);
       const restoreFirst=once(ws,'message'),keepSecond=once(ws2,'message');await call('control',{action:'take',scene});await restoreFirst;
       const secondUnchanged=JSON.parse((await keepSecond)[0]);assert.equal(secondUnchanged.cue,second.cue);assert.equal(secondUnchanged.startAt,second.startAt);
     }finally{ws2.terminate();}
   });
   await call('control',{action:'pause'});assert.equal(app.snapshot().runtime.paused,true);await call('control',{action:'pause'});assert.equal(app.snapshot().runtime.paused,false);
   const closed=once(ws,'close');await call('devices/revoke',{id:device});assert.equal((await closed)[0],1008);
   assert.equal((await post('/session',{token:auth.token})).status,401);
   await call('lan',{enabled:false});assert.equal(app.snapshot().network.enabled,false);
 });
 await call('control',{action:'take',scene});await app.close();app=startApp({dataDir:data,port:0});addr=await app.ready;base='http://127.0.0.1:'+addr.port;csrf=(await (await fetch(base+'/api/bootstrap')).json()).csrf;
 assert.equal(app.snapshot().network.enabled,false);assert.equal(app.snapshot().runtime.scene,null);assert.equal(app.snapshot().recovery.scene,scene);
 assert.equal((await call('control',{action:'restore'})).status,200);assert.equal(app.snapshot().runtime.scene,scene);if(secondScreen){assert.equal(app.snapshot().runtime.screenStates[secondScreen].scene,secondScene);assert.equal(app.snapshot().runtime.layout[secondScreen].layers[0].text,'Screen two');}
 await call('control',{action:'stop'});assert.equal((await call('scenes/delete',{id:scene})).status,200);assert.equal((await call('assets/delete',{id:asset})).status,200);
});
