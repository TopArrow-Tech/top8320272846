'use strict';
const http=require('node:http');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Transform}=require('node:stream');
const {WebSocketServer,WebSocket}=require('../vendor/ws');
const {openStore}=require('./store');
const deletion=require('./deletion');
const backupFile=require('./backup-file');
const {WorkBackups}=require('./work-backups');
const {fail,name,layout}=require('./validation');
const ROOT=path.resolve(__dirname,'..');
const appInfo=require('./app-info.json');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const secret=()=>crypto.randomBytes(32).toString('hex');
function interfaces(){return Object.entries(os.networkInterfaces()).flatMap(([label,list])=>list.filter(x=>x.family==='IPv4'&&!x.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address)).map(x=>({label,address:x.address})));}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req,max=1024*1024){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>max)fail('tooLarge',413);chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('invalidRequest');}}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm'};
async function sendFile(req,res,file,mime){
  const stat=await fsp.stat(file);let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
    if(!m[1])start=Math.max(0,stat.size-Number(m[2]));else {start=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),end);}
    if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}status=206;
  }
  const headers={'Content-Type':mime||types[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'no-cache'};
  if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
  res.writeHead(status,headers);if(req.method==='HEAD')return res.end();
  await pipeline(fs.createReadStream(file,{start,end}),res);
}
function startApp({dataDir=process.env.TOPARROW_DATA_DIR,port=Number(process.env.TOPARROW_APP_PORT)}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid TOPARROW_APP_PORT');
  const store=openStore(dataDir),{db,root}=store;
  const backups=new WorkBackups(store),imports=new Map();let maintenance=false;
  const csrf=secret();let admin,lan=null,lanAddress='',lanPort=0,code='',codeExpires=0,lanTouched=0,closing=false;
  let runtime={version:1,activity:null,scene:null,layout:{},assets:[],cue:null,startAt:0,paused:false,blackout:true};
  let recovery=store.setting('lastScene');
  const pending=new Map(),sockets=new Map(),stats=new Map(),attempts=new Map();
  function log(type,detail){try{const file=path.join(root,'logs','stagepilot.log');if(fs.existsSync(file)&&fs.statSync(file).size>1024*1024)fs.renameSync(file,file+'.1');fs.appendFileSync(file,JSON.stringify({at:Date.now(),type,detail})+'\n');}catch{}}
  function netState(){return {enabled:!!lan,address:lanAddress,port:lanPort,url:lan?`http://${lanAddress}:${lanPort}/display`:'',code:lan?code:'',codeExpires,interfaces:interfaces()};}
  function snapshot(){return {appInfo,activities:store.all('SELECT * FROM activities ORDER BY created DESC'),screens:store.all('SELECT * FROM screens'),assets:store.all('SELECT id,activity,name,type,mime,size,created FROM assets ORDER BY created DESC'),scenes:store.all('SELECT * FROM scenes ORDER BY position,rowid').map(x=>({...x,layout:JSON.parse(x.layout)})),devices:store.all('SELECT id,name,screen,created FROM devices').map(x=>({...x,online:sockets.has(x.id),...(stats.get(x.id)||{})})),pending:[...pending.values()].map(({id,name,created})=>({id,name,created})),network:netState(),runtime,recovery};}
  function deviceState(id){const d=store.get('SELECT screen FROM devices WHERE id=?',id),playback=runtime.screenStates?.[d?.screen]||runtime;return {type:'state',version:playback.version,cue:playback.cue,startAt:playback.startAt,paused:playback.paused,position:playback.position||0,blackout:runtime.blackout,screen:d?.screen||null,config:runtime.layout[d?.screen]||{background:'#000000',layers:[]},assets:runtime.assets.filter(a=>(runtime.layout[d?.screen]?.layers||[]).some(l=>l.asset===a.id))};}
  function broadcast(){for(const [id,ws]of sockets)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(deviceState(id)));}
  function stopLan(){if(!lan)return;for(const ws of sockets.values())ws.close(1001,'LAN closed');sockets.clear();pending.clear();const server=lan;lan=null;lanAddress='';lanPort=0;code='';server.close();server.closeAllConnections();log('lanClosed','');}
  function authorize(req){const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('stagepilot_device='));const token=(req.headers.authorization||'').replace(/^Bearer /,'')||(cookie?cookie.slice('stagepilot_device='.length):'');return token&&store.get('SELECT id,screen FROM devices WHERE token=?',hash(token));}
  function originOK(req,local){if(req.headers['sec-fetch-site']==='cross-site')return false;const port=local?admin.address()?.port:lanPort;const hosts=local?[`127.0.0.1:${port}`,`localhost:${port}`]:[`${lanAddress}:${port}`];if(!hosts.includes(req.headers.host))return false;return !req.headers.origin||hosts.some(h=>req.headers.origin===`http://${h}`);}
  function assertActivity(id){if(!store.get('SELECT id FROM activities WHERE id=?',id))fail('notFound',404);}
  function rememberPlayback(){
    const outputs=Object.fromEntries(Object.entries(runtime.screenStates).map(([screen,state])=>[screen,{scene:state.scene,config:runtime.layout[screen]}]));
    store.setting('lastScene',{scene:runtime.scene,activity:runtime.activity,outputs});
    recovery=null;
  }
  function applyScreens(activity,sceneId,configs,sceneIds={}){
    const keep=runtime.activity===activity,version=runtime.version+1,startAt=Date.now()+3000;
    const screenStates=keep?{...runtime.screenStates}:{};
    for(const screen of Object.keys(configs))screenStates[screen]={scene:sceneIds[screen]||sceneId,version,cue:store.id(),startAt,paused:false,position:0};
    runtime={version,activity,scene:sceneId,layout:{...(keep?runtime.layout:{}),...configs},screenStates,
      assets:store.all('SELECT id,type,mime,name FROM assets WHERE activity=?',activity),startAt,paused:false,blackout:false};
    rememberPlayback();broadcast();
  }
  function activate(sceneId){
    const scene=store.get('SELECT * FROM scenes WHERE id=?',sceneId);if(!scene)fail('notFound',404);
    const parsed=layout(JSON.parse(scene.layout),store.all('SELECT * FROM screens WHERE activity=?',scene.activity),store.all('SELECT * FROM assets WHERE activity=?',scene.activity));
    if(!Object.keys(parsed).length)fail('emptyScene',400);
    applyScreens(scene.activity,scene.id,parsed);log('sceneActivated',scene.id);
  }
  function restorePlayback(sceneId){
    if(!recovery?.outputs||sceneId&&sceneId!==recovery.scene)return activate(sceneId||recovery?.scene);
    const saved=recovery;assertActivity(saved.activity);
    const configs=Object.fromEntries(Object.entries(saved.outputs).map(([screen,value])=>[screen,value.config]));
    const validated=layout(configs,store.all('SELECT * FROM screens WHERE activity=?',saved.activity),store.all('SELECT * FROM assets WHERE activity=?',saved.activity));
    if(!Object.keys(validated).length)fail('emptyScene',400);
    const sceneIds=Object.fromEntries(Object.entries(saved.outputs).map(([screen,value])=>[screen,value.scene]));
    applyScreens(saved.activity,saved.scene,validated,sceneIds);log('playbackRestored',saved.activity);
  }
  const wsServer=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
  wsServer.on('connection',ws=>{
    const authTimer=setTimeout(()=>ws.close(1008,'Authenticate'),5000);let device=null;
    ws.on('message',raw=>{try{const m=JSON.parse(raw.toString());if(!device){if(m.type!=='auth'||typeof m.token!=='string')return ws.close(1008);device=store.get('SELECT id FROM devices WHERE token=?',hash(m.token));if(!device)return ws.close(1008);clearTimeout(authTimer);sockets.get(device.id)?.close(1000,'Replaced');sockets.set(device.id,ws);stats.set(device.id,{lastSeen:Date.now(),status:'connected'});ws.send(JSON.stringify(deviceState(device.id)));return;}
      lanTouched=Date.now();if(m.type==='clock')ws.send(JSON.stringify({type:'clock',client:m.client,server:Date.now()}));
      if(m.type==='status')stats.set(device.id,{lastSeen:Date.now(),status:String(m.status||'').slice(0,100),drift:typeof m.drift==='number'&&Number.isFinite(m.drift)?m.drift:null,version:Number(m.version)||0,ready:!!m.ready});
    }catch{ws.close(1008);}});
    ws.on('close',()=>{clearTimeout(authTimer);if(device&&sockets.get(device.id)===ws)sockets.delete(device.id);});ws.on('error',()=>{});
  });
  function attachUpgrade(server){server.on('upgrade',(req,socket,head)=>{if(!originOK(req,false)||req.url!=='/socket'||wsServer.clients.size>=64){socket.destroy();return;}wsServer.handleUpgrade(req,socket,head,ws=>wsServer.emit('connection',ws,req));});}
  async function handler(req,res,local){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    try{
      if(!originOK(req,local))fail('forbidden',403);
      const url=new URL(req.url,'http://local'),p=url.pathname,method=req.method;
      if(local&&p==='/__health')return json(res,200,{status:'ok'});
      if(local&&p==='/api/bootstrap'&&method==='GET')return json(res,200,{csrf,...snapshot()});
      if(local&&p.startsWith('/api/')){
        if(req.headers['x-stagepilot-csrf']!==csrf)fail('forbidden',403);if(maintenance&&method!=='GET'&&p!=='/api/backups/list')fail('backupBusy',409);
        if(p==='/api/state'&&method==='GET')return json(res,200,snapshot());
        if(p==='/api/backups/upload'&&method==='POST')return await receiveBackup(req,res);
        if(p==='/api/upload'&&method==='POST')return await upload(req,res,url);
        const b=method==='GET'?{}:await body(req);
        if(p==='/api/backups/list'&&method==='POST')return json(res,200,{entries:backups.list(),directory:backups.directory});
        if(p==='/api/backups/create'&&method==='POST'){if(lan||runtime.scene)fail('stopFirst',409);maintenance=true;try{return json(res,201,await backups.create(b.name||'',b.language));}finally{maintenance=false;}}
        if(p==='/api/backups/open'&&method==='POST'){await backups.open(b.id);return json(res,200,{ok:true});}
        if(p==='/api/backups/delete'&&method==='POST'){if(b.confirm!==true)fail('backupDeleteConsent');await backups.remove(b.id);return json(res,200,{ok:true});}
        if(p==='/api/backups/preview'&&method==='POST'){
          if(imports.size>=3)fail('backupBusy',409);if(lan||runtime.scene)fail('stopFirst',409);maintenance=true;let entry;try{entry=await stageBackup(backups.locate(b.id),false);return json(res,200,backupFile.preview(store,entry));}finally{maintenance=false;}}
        if(p==='/api/backups/cancel'&&method==='POST'){const entry=imports.get(b.token);if(entry){imports.delete(b.token);await fsp.rm(entry.folder,{recursive:true,force:true});}return json(res,200,{ok:true});}
        if(p==='/api/backups/restore'&&method==='POST'){
          if(lan||runtime.scene)fail('stopFirst',409);if(b.confirm!==true)fail('backupRestoreConsent');const entry=imports.get(b.token);if(!entry||Date.now()-entry.created>15*60000)fail('backupExpired',410);if(b.fingerprint!==backupFile.fingerprint(store))fail('backupStale',409);
          maintenance=true;try{const safety=await backups.create(b.safetyName||'',b.language);if(entry.external)await backups.retain(entry.input);const result=await backupFile.apply(store,entry,'replace');recovery=null;imports.delete(b.token);await fsp.rm(entry.folder,{recursive:true,force:true});return json(res,200,{...result,safetyBackup:safety.id});}finally{maintenance=false;}}
        if(p==='/api/deletion/preview'&&method==='POST')return json(res,200,deletion.inspect(store,runtime,b.kind,b.id));
        const deleting=/^\/api\/(activities|screens|scenes|assets)\/delete$/.exec(p);
        if(deleting&&method==='POST'){
          const result=deletion.execute(store,runtime,deleting[1],b.id,b.confirmation);
          if(result.conflict)return json(res,409,{error:result.conflict,impact:result.impact});
          runtime=result.runtime;if(recovery)recovery=store.setting('lastScene');broadcast();
          for(const file of result.files)await fsp.unlink(path.join(root,'media',file)).catch(e=>{if(e.code!=='ENOENT')log('fileCleanup',e.code);});
          return json(res,200,{ok:true});
        }
        if(p==='/api/activities'&&method==='POST'){const id=store.id();store.run('INSERT INTO activities(id,name,notes,created) VALUES(?,?,?,?)',id,name(b.name),String(b.notes||'').slice(0,2000),Date.now());return json(res,201,{id});}
        if(p==='/api/activities/duplicate'&&method==='POST'){
          assertActivity(b.id);const source=store.get('SELECT * FROM activities WHERE id=?',b.id),id=store.id(),screenMap=new Map(),assetMap=new Map(),copied=[];
          const oldScreens=store.all('SELECT * FROM screens WHERE activity=?',b.id),oldAssets=store.all('SELECT * FROM assets WHERE activity=?',b.id),oldScenes=store.all('SELECT * FROM scenes WHERE activity=?',b.id);
          try{for(const asset of oldAssets){const next=store.id(),file=next+path.extname(asset.file);assetMap.set(asset.id,{...asset,id:next,file});await fsp.copyFile(path.join(root,'media',asset.file),path.join(root,'media',file));copied.push(file);}
            store.transaction(()=>{store.run('INSERT INTO activities VALUES(?,?,?,?,?)',id,(source.name.slice(0,96)+' (2)'),source.notes,0,Date.now());for(const screen of oldScreens){const next=store.id();screenMap.set(screen.id,next);store.run('INSERT INTO screens VALUES(?,?,?)',next,id,screen.name);}for(const asset of assetMap.values())store.run('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)',asset.id,id,asset.name,asset.type,asset.mime,asset.file,asset.size,Date.now());for(const scene of oldScenes){const next={};for(const [screen,cfg]of Object.entries(JSON.parse(scene.layout))){next[screenMap.get(screen)]={...cfg,layers:cfg.layers.map(l=>l.asset?{...l,asset:assetMap.get(l.asset).id}:l)};}store.run('INSERT INTO scenes VALUES(?,?,?,?,?)',store.id(),id,scene.name,JSON.stringify(next),scene.position);}});
          }catch(e){for(const file of copied)await fsp.unlink(path.join(root,'media',file)).catch(()=>{});throw e;}return json(res,201,{id});
        }
        if(p==='/api/activities/update'&&method==='POST'){assertActivity(b.id);if(b.archived&&runtime.activity===b.id)fail('archiveActive',409);store.run('UPDATE activities SET name=?,notes=?,archived=? WHERE id=?',name(b.name),String(b.notes||'').slice(0,2000),b.archived?1:0,b.id);return json(res,200,{ok:true});}
        if(p==='/api/screens'&&method==='POST'){assertActivity(b.activity);const id=store.id();store.run('INSERT INTO screens VALUES(?,?,?)',id,b.activity,name(b.name));return json(res,201,{id});}
        if(p==='/api/screens/update'&&method==='POST'){store.run('UPDATE screens SET name=? WHERE id=?',name(b.name),b.id);return json(res,200,{ok:true});}
        if(p==='/api/scenes'&&method==='POST'){assertActivity(b.activity);const l=layout(b.layout,store.all('SELECT * FROM screens WHERE activity=?',b.activity),store.all('SELECT * FROM assets WHERE activity=?',b.activity));const id=b.id||store.id();if(b.id&&!store.get('SELECT id FROM scenes WHERE id=? AND activity=?',b.id,b.activity))fail('notFound',404);store.run('INSERT INTO scenes VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,layout=excluded.layout,position=excluded.position',id,b.activity,name(b.name),JSON.stringify(l),Number.isInteger(b.position)?b.position:0);return json(res,200,{id});}
        if(p==='/api/lan'&&method==='POST'){
          if(!b.enabled){stopLan();return json(res,200,netState());}
          if(lan)fail('alreadyEnabled',409);if(!interfaces().some(x=>x.address===b.address))fail('invalidInterface');
          if(b.acceptHttp!==true)fail('httpConsent');
          const candidate=http.createServer((q,s)=>handler(q,s,false));candidate.requestTimeout=30000;attachUpgrade(candidate);lanAddress=b.address;
          try{await new Promise((resolve,reject)=>{candidate.once('error',reject);candidate.listen({host:b.address,port:store.setting('lanPort')||0},resolve);});}catch(e){lanAddress='';throw e;}
          candidate.on('error',e=>log('lanError',e.code));lan=candidate;lanPort=lan.address().port;store.setting('lanPort',lanPort);code=String(crypto.randomInt(100000,1000000));codeExpires=Date.now()+10*60*1000;lanTouched=Date.now();return json(res,200,netState());
        }
        if(p==='/api/lan/reset'&&method==='POST'){if(lan)fail('stopFirst',409);store.setting('lanPort',null);return json(res,200,{ok:true});}
        if(p==='/api/lan/code'&&method==='POST'){if(!lan)fail('lanClosed',409);code=String(crypto.randomInt(100000,1000000));codeExpires=Date.now()+600000;return json(res,200,netState());}
        if(p==='/api/pair/approve'&&method==='POST'){const request=pending.get(b.id);if(!request)fail('notFound',404);if(request.token)fail('alreadyApproved',409);if(b.reject){pending.delete(b.id);return json(res,200,{ok:true});}if(b.screen&&!store.get('SELECT id FROM screens WHERE id=?',b.screen))fail('notFound',404);const id=store.id();request.token=secret();request.device=id;store.run('INSERT INTO devices VALUES(?,?,?,?,?)',id,name(b.name||request.name),hash(request.token),b.screen||null,Date.now());return json(res,200,{id});}
        if(p==='/api/devices/update'&&method==='POST'){if(b.screen&&!store.get('SELECT id FROM screens WHERE id=?',b.screen))fail('notFound',404);store.run('UPDATE devices SET name=?,screen=? WHERE id=?',name(b.name),b.screen||null,b.id);broadcast();return json(res,200,{ok:true});}
        if(p==='/api/devices/revoke'&&method==='POST'){sockets.get(b.id)?.close(1008,'Revoked');store.run('DELETE FROM devices WHERE id=?',b.id);return json(res,200,{ok:true});}
        if(p==='/api/control'&&method==='POST'){
          if(b.action==='take'){activate(b.scene);}else if(b.action==='restore'){restorePlayback(b.scene);}
          else if(b.action==='blackout'){runtime={...runtime,version:runtime.version+1,blackout:!runtime.blackout};broadcast();}
          else if(b.action==='stop'){runtime={version:runtime.version+1,activity:null,scene:null,layout:{},assets:[],startAt:0,paused:false,blackout:true};broadcast();}
          else if(b.action==='pause'){
            if(!runtime.scene)fail('notFound',404);const now=Date.now(),paused=!runtime.paused,version=runtime.version+1;
            const screenStates=Object.fromEntries(Object.entries(runtime.screenStates||{}).map(([screen,state])=>[screen,paused?{...state,version,paused:true,position:state.paused?state.position:Math.max(0,now-state.startAt)}:{...state,version,paused:false,startAt:state.paused?now-state.position:state.startAt}]));
            runtime={...runtime,version,paused,screenStates};broadcast();
          }
          else fail('invalidRequest');return json(res,200,{ok:true});
        }
        fail('notFound',404);
      }
      if(!local&&p==='/session'&&method==='POST'){const b=await body(req,4096);if(typeof b.token!=='string'||!store.get('SELECT id FROM devices WHERE token=?',hash(b.token)))fail('unauthorized',401);res.setHeader('Set-Cookie','stagepilot_device='+b.token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000');return json(res,200,{ok:true});}
      if(!local&&p==='/pair'&&method==='POST'){
        const ip=req.socket.remoteAddress,old=attempts.get(ip)||{at:Date.now(),n:0};if(Date.now()-old.at>60000){old.n=0;old.at=Date.now();}old.n++;attempts.set(ip,old);if(old.n>12)fail('rateLimited',429);
        const b=await body(req,4096);if(Date.now()>codeExpires||b.code!==code)fail('invalidCode',403);if(pending.size>=50)fail('tooManyDevices',429);
        const id=secret(),ticket=secret();pending.set(id,{id,ticket,name:name(b.name),created:Date.now()});lanTouched=Date.now();return json(res,201,{id,ticket});
      }
      if(!local&&p==='/pair/status'&&method==='POST'){const b=await body(req,4096),r=pending.get(b.id);if(!r||r.ticket!==b.ticket)fail('pairExpired',403);if(r.token){const result={token:r.token,device:r.device};pending.delete(b.id);return json(res,200,result);}return json(res,200,{pending:true});}
      if(p.startsWith('/media/')&&(method==='GET'||method==='HEAD')){
        let d;if(!local){d=authorize(req);if(!d)fail('unauthorized',401);}
        const id=p.slice(7),asset=store.get('SELECT * FROM assets WHERE id=?',id);if(!asset)fail('notFound',404);
        if(!local&&!runtime.layout[d.screen]?.layers.some(l=>l.asset===id))fail('forbidden',403);
        return await sendFile(req,res,path.join(root,'media',asset.file),asset.mime);
      }
      if(method!=='GET'&&method!=='HEAD')fail('notFound',404);
      const staticFiles={'/':'index.html','/display':'display.html','/number-input.js':'number-input.js','/effects.js':'effects.js','/app.js':'app.js','/display.js':'display.js','/styles.css':'styles.css','/vendor/react.js':'vendor/react.js','/vendor/react-dom.js':'vendor/react-dom.js'};
      if(!local&&['/','/app.js'].includes(p))fail('notFound',404);
      if(/^\/lang\/(zh|en)\.json$/.test(p))return await sendFile(req,res,path.join(ROOT,p.slice(1)));
      if(p==='/icon.png')return await sendFile(req,res,path.join(ROOT,'icon.png'));
      if(!staticFiles[p])fail('notFound',404);return await sendFile(req,res,path.join(ROOT,'public',staticFiles[p]));
    }catch(e){if(res.headersSent){res.destroy();return;}const status=e.status||(e.code==='ENOENT'?404:500);if(status===500)log('error',e.code||e.message);json(res,status,{error:status===500?'serverError':e.message});}
  }
  async function stageBackup(input,external,folder){
    const token=store.id();folder=folder||path.join(root,'tmp','work-backup-'+token);await fsp.mkdir(folder,{recursive:true});try{const stagedInput=path.join(folder,'source.spbackup');if(input!==stagedInput)await fsp.copyFile(input,stagedInput);const checked=await backupFile.inspect(stagedInput,folder);const entry={...checked,input:stagedInput,external,token,created:Date.now()};imports.set(token,entry);return entry;}catch(e){await fsp.rm(folder,{recursive:true,force:true});throw e;}
  }
  async function receiveBackup(req,res){
    if(lan||runtime.scene)fail('stopFirst',409);if(imports.size>=3)fail('backupBusy',409);maintenance=true;const folder=path.join(root,'tmp','work-backup-'+store.id());
    try{await fsp.mkdir(folder);const input=path.join(folder,'source.spbackup');let size=0;await pipeline(req,new Transform({transform(chunk,enc,cb){size+=chunk.length;cb(size>backupFile.MAX?Object.assign(Error('backupTooLarge'),{status:413}):null,chunk);}}),fs.createWriteStream(input,{flags:'wx'}));const entry=await stageBackup(input,true,folder);return json(res,200,backupFile.preview(store,entry));}catch(e){await fsp.rm(folder,{recursive:true,force:true});throw e;}finally{maintenance=false;}
  }
  async function upload(req,res,url){
    const activity=url.searchParams.get('activity');assertActivity(activity);const original=name(url.searchParams.get('name'),200),ext=path.extname(original).toLowerCase();
    const allowed={'.png':['image','image/png'],'.jpg':['image','image/jpeg'],'.jpeg':['image','image/jpeg'],'.gif':['image','image/gif'],'.webp':['image','image/webp'],'.mp4':['video','video/mp4'],'.webm':['video','video/webm'],'.mov':['video','video/quicktime']};if(!allowed[ext])fail('unsupportedMedia',415);
    const id=store.id(),file=id+ext,temp=path.join(root,'tmp',id);let bytes=0;
    try{await pipeline(req,new Transform({transform(chunk,enc,cb){bytes+=chunk.length;cb(bytes>256*1024*1024?Object.assign(Error('tooLarge'),{status:413}):null,chunk);}}),fs.createWriteStream(temp,{flags:'wx'}));
      const handle=await fsp.open(temp,'r'),header=Buffer.alloc(32);try{await handle.read(header,0,32,0);}finally{await handle.close();}
      const sig=ext==='.png'?header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['.jpg','.jpeg'].includes(ext)?header[0]===255&&header[1]===216&&header[2]===255:ext==='.gif'?/^GIF8[79]a/.test(header.toString('ascii',0,6)):ext==='.webp'?header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WEBP':ext==='.mp4'?header.toString('ascii',4,8)==='ftyp':ext==='.mov'?['ftyp','moov','mdat','wide','free','skip'].includes(header.toString('ascii',4,8)):header.readUInt32BE(0)===0x1a45dfa3;
      if(!sig||bytes<12)fail('unsupportedMedia',415);await fsp.rename(temp,path.join(root,'media',file));
      try{store.run('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)',id,activity,original,allowed[ext][0],allowed[ext][1],file,bytes,Date.now());}catch(e){await fsp.unlink(path.join(root,'media',file)).catch(()=>{});throw e;}json(res,201,{id});
    }finally{await fsp.unlink(temp).catch(()=>{});}
  }
  admin=http.createServer((q,s)=>handler(q,s,true));admin.requestTimeout=300000;
  admin.on('error',e=>log('adminError',e.code));
  const ready=(async()=>{for(const name of await fsp.readdir(path.join(root,'tmp')))if(/^work-backup-[a-f0-9-]{36}$/.test(name))await fsp.rm(path.join(root,'tmp',name),{recursive:true,force:true});return new Promise((resolve,reject)=>{admin.once('error',reject);admin.listen({host:'127.0.0.1',port},()=>{log('started','localOnly');resolve(admin.address());});});})();
  const timer=setInterval(()=>{const now=Date.now();for(const [id,entry]of imports)if(now-entry.created>15*60000&&!maintenance){imports.delete(id);fsp.rm(entry.folder,{recursive:true,force:true}).catch(()=>{});}for(const [id,p]of pending)if(now-p.created>120000)pending.delete(id);for(const [ip,a]of attempts)if(now-a.at>60000)attempts.delete(ip);for(const [id,s]of stats)if(now-s.lastSeen>20000)sockets.get(id)?.terminate();if(lan&&now-lanTouched>30*60000)stopLan();},5000);timer.unref();
  async function close(){if(closing)return;closing=true;clearInterval(timer);for(const entry of imports.values())await fsp.rm(entry.folder,{recursive:true,force:true});imports.clear();stopLan();wsServer.close();await new Promise(r=>{admin.close(r);admin.closeAllConnections();});db.close();}
  return {ready,close,store,snapshot};
}
if(require.main===module){try{const app=startApp();app.ready.catch(e=>{console.error('StagePilot startup failed:',e.message);process.exitCode=1;app.close();});for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>app.close().then(()=>process.exit(0)));}catch(e){console.error('StagePilot startup failed:',e.message);process.exitCode=1;}}
module.exports={startApp,interfaces};
