/* Shared, deterministic animation math for preview and display timelines. */
(function(root){
  'use strict';
  var names=['none','left','right','up','down','fade','pulse'];
  function frame(effect,seconds,metrics){
    effect=effect||{};var duration=Number(effect.duration)||10;
    var phase=((Math.max(0,seconds)%duration)/duration),p=phase*2-1;
    if(metrics&&['left','right','up','down'].includes(effect.type)){var horizontal=effect.type==='left'||effect.type==='right',viewport=horizontal?metrics.width:metrics.height,content=horizontal?metrics.contentWidth:metrics.contentHeight;var distance=(effect.type==='left'||effect.type==='up')?viewport-phase*(viewport+content):-content+phase*(viewport+content);return {transform:(horizontal?'translateX(':'translateY(')+distance+'px)',opacity:1};}
    switch(effect.type){
      case 'left':return {transform:'translateX('+(-p*100)+'%)',opacity:1};
      case 'right':return {transform:'translateX('+(p*100)+'%)',opacity:1};
      case 'up':return {transform:'translateY('+(-p*100)+'%)',opacity:1};
      case 'down':return {transform:'translateY('+(p*100)+'%)',opacity:1};
      case 'fade':return {transform:'none',opacity:(1-Math.cos(phase*2*Math.PI))/2};
      case 'pulse':return {transform:'scale('+(1+.08*Math.sin(phase*2*Math.PI))+')',opacity:1};
      default:return {transform:'none',opacity:1};
    }
  }
  var api={names:names,frame:frame};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.StagePilotEffects=api;
})(typeof window==='object'?window:globalThis);
