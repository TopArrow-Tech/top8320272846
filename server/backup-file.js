'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {layout,name,fail}=require('./validation');
const MAGIC=Buffer.from('STAGEPILOT-DATA-1\n'),MAX=4*1024**3,META_MAX=16*1024**2;
const formats={'.png':['image','image/png'],'.jpg':['image','image/jpeg'],'.jpeg':['image','image/jpeg'],'.gif':['image','image/gif'],'.webp':['image','image/webp'],'.mp4':['video','video/mp4'],'.webm':['video','video/webm'],'.mov':['video','video/quicktime']};
function snapshot(s){return {activities:s.all('SELECT * FROM activities ORDER BY id'),screens:s.all('SELECT * FROM screens ORDER BY id'),assets:s.all('SELECT * FROM assets ORDER BY id'),scenes:s.all('SELECT * FROM scenes ORDER BY id')};}
function fingerprint(s){return crypto.createHash('sha256').update(JSON.stringify({...snapshot(s),devices:s.all('SELECT id,name,screen FROM devices ORDER BY id')})).digest('hex');}
async function hashFile(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
async function writeAll(handle,bytes){let at=0;while(at<bytes.length){const {bytesWritten}=await handle.write(bytes,at,bytes.length-at);if(!bytesWritten)throw Error('Write failed');at+=bytesWritten;}}
async function exact(handle,size,at){const out=Buffer.alloc(size);let n=0;while(n<size){const {bytesRead}=await handle.read(out,n,size-n,at+n);if(!bytesRead)fail('invalidBackup');n+=bytesRead;}return out;}
function mediaPath(s,file){if(typeof file!=='string'||path.basename(file)!==file)fail('invalidBackup');return path.join(s.root,'media',file);}
async function create(s,target,language='zh',backupName=''){ 
 const data=snapshot(s),assets=[];let total=0;
 for(const asset of data.assets){const file=mediaPath(s,asset.file),stat=await fsp.stat(file);if(stat.size!==asset.size)fail('backupMissingMedia',409);total+=stat.size;if(total>MAX-META_MAX)fail('backupTooLarge',413);assets.push({...asset,file:undefined,ext:path.extname(asset.file).toLowerCase(),sha256:await hashFile(file)});}
 const metadata={backupName:typeof backupName==='string'?backupName.trim().slice(0,80):'',format:'stagepilot',version:1,createdAt:Date.now(),preferences:{language:language==='en'?'en':'zh'},activities:data.activities,screens:data.screens,assets,scenes:data.scenes.map(x=>({...x,layout:JSON.parse(x.layout)}))};
 validate(metadata);const bytes=Buffer.from(JSON.stringify(metadata));if(bytes.length>META_MAX||MAGIC.length+4+bytes.length+total+32>MAX)fail('backupTooLarge',413);
 const header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);const hash=crypto.createHash('sha256'),handle=await fsp.open(target,'wx');
 try{for(const chunk of [MAGIC,header,bytes]){hash.update(chunk);await writeAll(handle,chunk);}for(const asset of data.assets){const fileHash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(mediaPath(s,asset.file))){fileHash.update(chunk);hash.update(chunk);await writeAll(handle,chunk);}if(fileHash.digest('hex')!==assets.find(x=>x.id===asset.id).sha256)fail('backupMissingMedia',409);}await writeAll(handle,hash.digest());}catch(e){await handle.close();await fsp.unlink(target).catch(()=>{});throw e;}await handle.close();return metadata;
}
function validate(data){
 if(!data||data.format!=='stagepilot'||data.version!==1||!Number.isSafeInteger(data.createdAt)||data.createdAt<0)fail('invalidBackup');
 for(const key of ['activities','screens','assets','scenes'])if(!Array.isArray(data[key])||data[key].length>20000)fail('invalidBackup');
 if(['activities','screens','assets','scenes'].reduce((n,k)=>n+data[k].length,0)>20000)fail('invalidBackup');
 const sets={};for(const key of ['activities','screens','assets','scenes']){sets[key]=new Set();for(const row of data[key]){if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(row.id)||sets[key].has(row.id)||['__proto__','constructor','prototype'].includes(row.id))fail('invalidBackup');sets[key].add(row.id);}}
 const time=v=>Number.isSafeInteger(v)&&v>=0;
 data.activities=data.activities.map(x=>{if(![0,1].includes(x.archived)||typeof x.notes!=='string'||x.notes.length>2000||!time(x.created))fail('invalidBackup');return {id:x.id,name:name(x.name),notes:x.notes,archived:x.archived,created:x.created};});
 data.screens=data.screens.map(x=>{if(!sets.activities.has(x.activity))fail('invalidBackup');return {id:x.id,name:name(x.name),activity:x.activity};});
 data.assets=data.assets.map(x=>{const format=formats[x.ext];if(!format||x.type!==format[0]||x.mime!==format[1]||!sets.activities.has(x.activity)||!Number.isSafeInteger(x.size)||x.size<1||x.size>256*1024**2||!time(x.created)||typeof x.sha256!=='string'||!/^[a-f\d]{64}$/.test(x.sha256))fail('invalidBackup');return {id:x.id,activity:x.activity,name:name(x.name,200),type:x.type,mime:x.mime,ext:x.ext,size:x.size,created:x.created,sha256:x.sha256};});
 data.scenes=data.scenes.map(x=>{if(!sets.activities.has(x.activity)||!Number.isSafeInteger(x.position))fail('invalidBackup');return {id:x.id,activity:x.activity,name:name(x.name),position:x.position,layout:layout(x.layout,data.screens.filter(s=>s.activity===x.activity),data.assets.filter(a=>a.activity===x.activity))};});
 data.preferences={language:data.preferences?.language==='en'?'en':'zh'};return data;
}
async function inspect(file,folder){
 const handle=await fsp.open(file,'r'),hash=crypto.createHash('sha256');
 try{const stat=await handle.stat();if(stat.size>MAX||stat.size<MAGIC.length+4+32)fail('invalidBackup');const magic=await exact(handle,MAGIC.length,0);if(!magic.equals(MAGIC))fail('invalidBackup');hash.update(magic);
 const head=await exact(handle,4,MAGIC.length);hash.update(head);const length=head.readUInt32BE();if(length>META_MAX||length<2||length>stat.size-MAGIC.length-4-32)fail('invalidBackup');const meta=await exact(handle,length,MAGIC.length+4);hash.update(meta);let data;try{data=validate(JSON.parse(meta));}catch(e){if(e.code)throw e;fail('invalidBackup');}
 let offset=MAGIC.length+4+length;const total=data.assets.reduce((n,a)=>n+a.size,offset+32);if(total!==stat.size)fail('invalidBackup');const files=new Map();await fsp.mkdir(path.join(folder,'assets'),{recursive:true});
 for(const asset of data.assets){const destination=path.join(folder,'assets',crypto.randomUUID()+asset.ext),out=await fsp.open(destination,'wx'),assetHash=crypto.createHash('sha256');let remaining=asset.size;
  try{while(remaining){const size=Math.min(64*1024,remaining),chunk=await exact(handle,size,offset);offset+=size;remaining-=size;hash.update(chunk);assetHash.update(chunk);await writeAll(out,chunk);}}finally{await out.close();}
  if(assetHash.digest('hex')!==asset.sha256)fail('invalidBackup');files.set(asset.id,destination);
 }
 const digest=await exact(handle,32,offset);if(!hash.digest().equals(digest))fail('invalidBackup');return {data,files,folder};
 }finally{await handle.close();}
}
function preview(s,entry){return {token:entry.token,fingerprint:fingerprint(s),createdAt:entry.data.createdAt,activities:entry.data.activities.map(x=>({name:x.name,archived:x.archived})),counts:{activities:entry.data.activities.length,archived:entry.data.activities.filter(x=>x.archived).length,screens:entry.data.screens.length,scenes:entry.data.scenes.length,assets:entry.data.assets.length,bytes:entry.data.assets.reduce((n,a)=>n+a.size,0)},language:entry.data.preferences.language};}
async function apply(s,entry,mode){
 if(!['merge','replace'].includes(mode))fail('invalidRequest');const data=entry.data,maps={};for(const kind of ['activities','screens','assets','scenes'])maps[kind]=new Map(data[kind].map(x=>[x.id,s.id()]));
 const moved=[],oldFiles=mode==='replace'?s.all('SELECT file FROM assets').map(x=>x.file):[],names=new Set(mode==='merge'?s.all('SELECT name FROM activities').map(x=>x.name):[]),activityNames=new Map();
 for(const activity of data.activities){let label=activity.name,index=2;while(names.has(label))label=activity.name.slice(0,90)+' ('+(index++)+')';names.add(label);activityNames.set(activity.id,label);}
 try{
  for(const asset of data.assets){const file=maps.assets.get(asset.id)+asset.ext;await fsp.rename(entry.files.get(asset.id),mediaPath(s,file));moved.push(file);}
  s.transaction(()=>{
   if(mode==='replace'){for(const table of ['devices','scenes','assets','screens','activities'])s.db.exec('DELETE FROM '+table);s.setting('lastScene',null);}
   for(const a of data.activities)s.run('INSERT INTO activities VALUES(?,?,?,?,?)',maps.activities.get(a.id),activityNames.get(a.id),a.notes,a.archived,a.created);
   for(const a of data.screens)s.run('INSERT INTO screens VALUES(?,?,?)',maps.screens.get(a.id),maps.activities.get(a.activity),a.name);
   for(const a of data.assets)s.run('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)',maps.assets.get(a.id),maps.activities.get(a.activity),a.name,a.type,a.mime,maps.assets.get(a.id)+a.ext,a.size,a.created);
   for(const a of data.scenes){const config={};for(const [screen,cfg]of Object.entries(a.layout))config[maps.screens.get(screen)]={...cfg,layers:cfg.layers.map(l=>l.asset?{...l,asset:maps.assets.get(l.asset)}:l)};s.run('INSERT INTO scenes VALUES(?,?,?,?,?)',maps.scenes.get(a.id),maps.activities.get(a.activity),a.name,JSON.stringify(config),a.position);}
  });
 }catch(e){for(const file of moved)await fsp.unlink(mediaPath(s,file)).catch(()=>{});throw e;}
 for(const file of oldFiles)await fsp.unlink(mediaPath(s,file)).catch(()=>{});
 return {ok:true,counts:preview(s,entry).counts,language:data.preferences.language};
}
module.exports={create,inspect,preview,apply,fingerprint,MAX};
