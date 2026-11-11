/* Number editing keeps raw text separate from committed scene values. */
(function(root){
  'use strict';
  function normalize(raw){return String(raw).replace(/[０-９]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-65248);}).replace(/．/g,'.').replace(/−/g,'-');}
  function parse(raw){var text=normalize(raw).trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))return null;var value=Number(text);return Number.isFinite(value)?value:null;}
  function commit(raw,previous,min,max,step){var value=parse(raw);if(value===null)value=Number.isFinite(previous)?previous:0;if(Number.isFinite(min))value=Math.max(min,value);if(Number.isFinite(max))value=Math.min(max,value);if(Number.isFinite(step)&&step>0){var base=Number.isFinite(min)?min:0;value=Number((base+Math.round((value-base)/step)*step).toFixed(10));}if(Number.isFinite(min))value=Math.max(min,value);if(Number.isFinite(max))value=Math.min(max,value);return value===0?0:value;}
  var api={normalize:normalize,parse:parse,commit:commit};if(typeof module==='object'&&module.exports)module.exports=api;else root.StagePilotNumbers=api;
})(typeof window==='object'?window:globalThis);
