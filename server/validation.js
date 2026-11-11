'use strict';
function fail(code,status=400) { const e=new Error(code);e.status=status;throw e; }
function name(v,max=100) {if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail('invalidName');return v.trim();}
function number(v,min,max){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('invalidLayout');return v;}
function color(v) { if(typeof v!=='string'||!/^#[a-f\d]{6}$/i.test(v))fail('invalidLayout');return v; }
function layout(input,screens,assets) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('invalidLayout');
  const output={};
  for(const [id,cfg] of Object.entries(input)) {
    if(!screens.some(s=>s.id===id)||!cfg||!Array.isArray(cfg.layers)||cfg.layers.length>24)fail('invalidLayout');
    output[id]={background:color(cfg.background),layers:cfg.layers.map(layer=>{
      if(!['text','image','video'].includes(layer.type))fail('invalidLayout');
      const item={id:name(layer.id),type:layer.type,x:number(layer.x,0,100),y:number(layer.y,0,100),w:number(layer.w,1,100),h:number(layer.h,1,100),opacity:number(layer.opacity??1,0,1),fit:layer.fit==='cover'?'cover':'contain'};
      if(item.x+item.w>100.1||item.y+item.h>100.1)fail('invalidLayout');
      if(item.type==='text')Object.assign(item,{text:typeof layer.text==='string'?layer.text.slice(0,4000):'',fontSize:number(layer.fontSize,1,25),color:color(layer.color),align:['left','center','right'].includes(layer.align)?layer.align:'center',background:color(layer.background||'#000000'),transparent:layer.transparent!==false});
      else {const asset=assets.find(a=>a.id===layer.asset&&a.type===layer.type);if(!asset)fail('missingAsset');Object.assign(item,{asset:asset.id,muted:layer.muted!==false,loop:layer.loop!==false,volume:number(layer.volume??1,0,1)});}
      const effect=layer.effect||{type:'none',duration:10};
      if(!effect||!require('../public/effects').names.includes(effect.type))fail('invalidEffect');
      item.effect={type:effect.type,duration:number(effect.duration??10,1,120)};
      return item;
    })};
  }
  return output;
}
module.exports={fail,name,layout};
