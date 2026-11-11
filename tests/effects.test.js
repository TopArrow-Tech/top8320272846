'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {frame,names}=require('../public/effects');const {layout}=require('../server/validation');
test('scroll directions traverse the entire region including long text',()=>{
 const m={width:200,height:100,contentWidth:800,contentHeight:400};
 assert.equal(frame({type:'left',duration:10},0,m).transform,'translateX(200px)');
 assert.equal(frame({type:'left',duration:10},5,m).transform,'translateX(-300px)');
 assert.equal(frame({type:'right',duration:10},0,m).transform,'translateX(-800px)');
 assert.equal(frame({type:'up',duration:10},0,m).transform,'translateY(100px)');
 assert.equal(frame({type:'down',duration:10},0,m).transform,'translateY(-400px)');
 assert.deepEqual(frame({type:'left',duration:10},10,m),frame({type:'left',duration:10},0,m));
});
test('effects are deterministic so paused and reconnected displays retain their timeline',()=>{
 for(const type of names){const effect={type,duration:8};assert.deepEqual(frame(effect,3),frame(effect,3));assert.deepEqual(frame(effect,3),frame(effect,11));}
 assert.equal(frame({type:'fade',duration:8},4).opacity,1);
 assert.equal(frame(null,0).transform,'none');
});
test('scene validation preserves effects, supports old scenes and rejects invalid settings',()=>{
 const config={s:{background:'#000000',layers:[{id:'l',type:'text',text:'Hello',fontSize:5,color:'#ffffff',x:0,y:0,w:100,h:100}]}};
 assert.deepEqual(layout(config,[{id:'s'}],[]).s.layers[0].effect,{type:'none',duration:10});
 config.s.layers[0].effect={type:'left',duration:12};assert.deepEqual(layout(config,[{id:'s'}],[]).s.layers[0].effect,{type:'left',duration:12});
 config.s.layers[0].effect.duration=0;assert.throws(()=>layout(config,[{id:'s'}],[]),/invalidLayout/);
 config.s.layers[0].effect={type:'execute-script',duration:10};assert.throws(()=>layout(config,[{id:'s'}],[]),/invalidEffect/);
});
