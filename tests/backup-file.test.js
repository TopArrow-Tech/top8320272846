'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {openStore}=require('../server/store'),migration=require('../server/backup-file'),{startApp}=require('../server');
const base=path.resolve(__dirname,'../data/tmp');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=','base64');
function fixture(s){
 s.run('INSERT INTO activities VALUES(?,?,?,?,?)','a','Event','备注',1,1);s.run('INSERT INTO screens VALUES(?,?,?)','screen','a','Main');
 s.run('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)','asset','a','Image.png','image','image/png','asset.png',png.length,1);fs.writeFileSync(path.join(s.root,'media','asset.png'),png);
 s.run('INSERT INTO scenes VALUES(?,?,?,?,?)','scene','a','Opening',JSON.stringify({screen:{background:'#112233',layers:[{id:'l',type:'image',asset:'asset',x:0,y:0,w:100,h:100,opacity:1,fit:'contain',effect:{type:'left',duration:7}}]}}),0);
 s.run('INSERT INTO devices VALUES(?,?,?,?,?)','device','Old TV','PAIRING-MUST-NOT-EXPORT','screen',1);s.setting('lanPort',43210);
}
test('portable package preserves archived media and effects, remaps identities, excludes credentials and detects corruption',async t=>{
 fs.mkdirSync(base,{recursive:true});const folder=fs.mkdtempSync(path.join(base,'migration-')),source=openStore(path.join(folder,'source')),target=openStore(path.join(folder,'target'));t.after(()=>{source.db.close();target.db.close();fs.rmSync(folder,{recursive:true,force:true});});fixture(source);
 target.run('INSERT INTO activities VALUES(?,?,?,?,?)','existing','Event','keep',0,1);target.run('INSERT INTO devices VALUES(?,?,?,?,?)','existing-device','Target TV','keep-token',null,1);target.setting('lanPort',32100);
 const file=path.join(folder,'data.stagepilot');await migration.create(source,file,'en');const bytes=fs.readFileSync(file);assert.equal(bytes.includes(Buffer.from('PAIRING-MUST-NOT-EXPORT')),false);assert.equal(bytes.includes(Buffer.from('43210')),false);
 const entry=await migration.inspect(file,path.join(folder,'stage'));entry.token='test';const preview=migration.preview(target,entry);assert.equal(preview.counts.archived,1);assert.equal(preview.counts.assets,1);
 await migration.apply(target,entry,'merge');assert.equal(target.all('SELECT * FROM activities').length,2);const imported=target.get('SELECT * FROM activities WHERE id!=?','existing');assert.equal(imported.name,'Event (2)');assert.equal(imported.archived,1);assert.notEqual(imported.id,'a');
 const scene=target.get('SELECT * FROM scenes'),asset=target.get('SELECT * FROM assets'),screen=target.get('SELECT * FROM screens'),cfg=JSON.parse(scene.layout);assert.equal(cfg[screen.id].layers[0].asset,asset.id);assert.equal(cfg[screen.id].layers[0].effect.duration,7);assert.deepEqual(fs.readFileSync(path.join(target.root,'media',asset.file)),png);assert.equal(target.all('SELECT * FROM devices').length,1);assert.equal(target.setting('lanPort'),32100);
 const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;const bad=path.join(folder,'bad.stagepilot');fs.writeFileSync(bad,corrupt);await assert.rejects(migration.inspect(bad,path.join(folder,'bad-stage')),/invalidBackup/);assert.equal(target.all('SELECT * FROM activities').length,2);
 const future=Buffer.from(bytes);const index=future.indexOf(Buffer.from('"version":1'));future[index+10]=50;crypto.createHash('sha256').update(future.subarray(0,-32)).digest().copy(future,future.length-32);fs.writeFileSync(bad,future);await assert.rejects(migration.inspect(bad,path.join(folder,'future-stage')),/invalidBackup/);
 const retry=await migration.inspect(file,path.join(folder,'retry'));fs.unlinkSync(retry.files.get('asset'));await assert.rejects(migration.apply(target,retry,'replace'));assert.ok(target.get('SELECT id FROM activities WHERE id=?','existing'));
 const transactional=await migration.inspect(file,path.join(folder,'transaction-stage')),beforeFiles=fs.readdirSync(path.join(target.root,'media')).sort();target.db.exec("CREATE TRIGGER reject_import BEFORE INSERT ON activities BEGIN SELECT RAISE(ABORT,'test constraint'); END");await assert.rejects(migration.apply(target,transactional,'replace'));assert.ok(target.get('SELECT id FROM activities WHERE id=?','existing'));assert.deepEqual(fs.readdirSync(path.join(target.root,'media')).sort(),beforeFiles);
});
