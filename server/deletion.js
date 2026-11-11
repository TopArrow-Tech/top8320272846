'use strict';
const {createHash}=require('node:crypto');
const {fail}=require('./validation');
const tables={activities:'activities',screens:'screens',scenes:'scenes',assets:'assets'};
function affectedScreens(runtime,kind,id){
  return Object.keys(runtime.layout).filter(screen=>kind==='activities'?runtime.activity===id:kind==='screens'?screen===id:kind==='scenes'?runtime.screenStates?.[screen]?.scene===id||!runtime.screenStates&&runtime.scene===id:runtime.layout[screen].layers.some(layer=>layer.asset===id));
}
function inspect(store,runtime,kind,id){
  if(!Object.hasOwn(tables,kind)||typeof id!=='string')fail('invalidRequest');
  const target=store.get(`SELECT * FROM ${tables[kind]} WHERE id=?`,id);if(!target)fail('notFound',404);
  const scenes=store.all('SELECT id,name,activity,layout FROM scenes ORDER BY id').filter(scene=>kind==='activities'?scene.activity===id:kind==='screens'?Object.hasOwn(JSON.parse(scene.layout),id):kind==='assets'?Object.values(JSON.parse(scene.layout)).some(cfg=>cfg.layers.some(layer=>layer.asset===id)):false);
  const active=affectedScreens(runtime,kind,id),screens=store.all('SELECT id,name FROM screens');
  const devices=kind==='screens'?store.all('SELECT id,name FROM devices WHERE screen=?',id):kind==='activities'?store.all('SELECT d.id,d.name FROM devices d JOIN screens s ON s.id=d.screen WHERE s.activity=?',id):[];
  const children=kind==='activities'?{screens:store.all('SELECT id,name FROM screens WHERE activity=? ORDER BY id',id),assets:store.all('SELECT id,name,size FROM assets WHERE activity=? ORDER BY id',id)}:null;
  const details={kind,id,name:target.name,scenes:scenes.map(({id,name})=>({id,name})),activeScreens:active.map(id=>({id,name:screens.find(s=>s.id===id)?.name||id})),devices,requiresConfirmation:scenes.length>0||active.length>0||devices.length>0};
  details.fingerprint=createHash('sha256').update(JSON.stringify({kind,target,children,scenes,devices,active:active.map(id=>({id,state:runtime.screenStates?.[id],config:runtime.layout[id]}))})).digest('hex');return details;
}
function trimSaved(saved,kind,id){
  if(!saved)return null;if(kind==='activities'&&saved.activity===id)return null;
  if(!saved.outputs)return kind==='scenes'&&saved.scene===id?null:kind==='screens'||kind==='assets'?null:saved;
  const outputs=Object.fromEntries(Object.entries(saved.outputs).filter(([screen,entry])=>kind==='screens'?screen!==id:kind==='scenes'?entry.scene!==id:kind==='assets'?!entry.config.layers.some(layer=>layer.asset===id):true));
  if(!Object.keys(outputs).length)return null;
  return {...saved,outputs,scene:Object.values(outputs).some(x=>x.scene===saved.scene)?saved.scene:Object.values(outputs).at(-1).scene};
}
function trimRuntime(runtime,kind,id){
  const affected=affectedScreens(runtime,kind,id);if(!affected.length)return runtime;
  const remove=new Set(affected),layout=Object.fromEntries(Object.entries(runtime.layout).filter(([key])=>!remove.has(key))),screenStates=Object.fromEntries(Object.entries(runtime.screenStates||{}).filter(([key])=>!remove.has(key))),version=runtime.version+1;
  if(!Object.keys(layout).length)return {version,activity:null,scene:null,layout:{},screenStates:{},assets:[],startAt:0,paused:false,blackout:true};
  const outputs=Object.values(screenStates),scene=outputs.some(x=>x.scene===runtime.scene)?runtime.scene:outputs.at(-1)?.scene||null;
  return {...runtime,version,layout,screenStates,scene,paused:outputs.every(x=>x.paused),assets:kind==='assets'?runtime.assets.filter(a=>a.id!==id):runtime.assets};
}
function execute(store,runtime,kind,id,confirmation){
  const impact=inspect(store,runtime,kind,id);
  if(confirmation&&confirmation!==impact.fingerprint)return {conflict:'deleteChanged',impact};
  if(impact.requiresConfirmation&&confirmation!==impact.fingerprint)return {conflict:'deleteNeedsConfirmation',impact};
  const files=kind==='assets'?[store.get('SELECT file FROM assets WHERE id=?',id).file]:kind==='activities'?store.all('SELECT file FROM assets WHERE activity=?',id).map(a=>a.file):[];
  const next=trimRuntime(runtime,kind,id);
  store.transaction(()=>{
    if(kind==='screens'||kind==='assets')for(const scene of store.all('SELECT id,layout FROM scenes')){
      const config=JSON.parse(scene.layout);if(kind==='screens')delete config[id];else for(const cfg of Object.values(config))cfg.layers=cfg.layers.filter(layer=>layer.asset!==id);
      if(JSON.stringify(config)!==scene.layout)store.run('UPDATE scenes SET layout=? WHERE id=?',JSON.stringify(config),scene.id);
    }
    store.run(`DELETE FROM ${tables[kind]} WHERE id=?`,id);
    store.setting('lastScene',trimSaved(store.setting('lastScene'),kind,id));
  });
  return {runtime:next,files};
}
module.exports={inspect,execute};
