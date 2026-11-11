'use strict';
// Portable ZIP writer; no platform tools or runtime downloads.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const icon=fs.readFileSync(path.join(root,'icon.png'));
if(icon.readUInt32BE(0)!==0x89504e47||icon.readUInt32BE(16)!==icon.readUInt32BE(20)||icon.readUInt32BE(16)>512||icon.length>200*1024)throw Error('Invalid icon.png');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
if(manifest.runtime.type!=='node'||!manifest.network.lan||!manifest.entry.main||!manifest.id||manifest.version)throw Error('Invalid manifest');
const entries=[];
function walk(rel){const abs=path.join(root,rel);if(fs.lstatSync(abs).isSymbolicLink())throw Error('Symlinks are not allowed');if(fs.statSync(abs).isDirectory()){for(const name of fs.readdirSync(abs).sort())walk(path.posix.join(rel,name));}else{if(rel.length>200)throw Error('Long path');const bytes=fs.readFileSync(abs);if(bytes.length>256*1024*1024)throw Error('File too large');entries.push({name:rel,bytes});}}
for(const rel of ['manifest.json','icon.png','server','public','lang','vendor'])walk(rel);
if(entries.length>20000||entries.reduce((n,e)=>n+e.bytes.length,0)>1024*1024*1024)throw Error('Package exceeds platform limits');
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
const local=[],central=[];let offset=0;
for(const e of entries){const name=Buffer.from(e.name),crc=crc32(e.bytes),header=Buffer.alloc(30),index=Buffer.alloc(46);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(e.bytes.length,18);header.writeUInt32LE(e.bytes.length,22);header.writeUInt16LE(name.length,26);local.push(header,name,e.bytes);
index.writeUInt32LE(0x02014b50,0);index.writeUInt16LE(20,4);index.writeUInt16LE(20,6);index.writeUInt16LE(0x800,8);index.writeUInt16LE(0x21,14);index.writeUInt32LE(crc,16);index.writeUInt32LE(e.bytes.length,20);index.writeUInt32LE(e.bytes.length,24);index.writeUInt16LE(name.length,28);index.writeUInt32LE(offset,42);central.push(index,name);offset+=header.length+name.length+e.bytes.length;}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const stage=path.join(root,'release','StagePilot');fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});for(const entry of entries){const target=path.join(stage,entry.name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,entry.bytes);}fs.mkdirSync(path.join(root,'release'),{recursive:true});const target=path.join(root,'release','StagePilot.zip');fs.writeFileSync(target,Buffer.concat([...local,directory,end]));console.log(JSON.stringify({target,files:entries.length,size:fs.statSync(target).size,icon:{width:icon.readUInt32BE(16),height:icon.readUInt32BE(20),bytes:icon.length}},null,2));
