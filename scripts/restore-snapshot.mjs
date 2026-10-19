import {existsSync,mkdirSync,readFileSync,copyFileSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

// Always restore into a new directory; never replace the running server's files.
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
if(!args.includes('--backup-dir')||!args.includes('--output-dir'))throw new Error('用法：node scripts/restore-snapshot.mjs --backup-dir "自动备份目录" --output-dir "不存在的新目录"');
const source=resolve(value('--backup-dir')),target=resolve(value('--output-dir')),rel=relative(source,target);
if(!rel||!rel.startsWith('..')&&!isAbsolute(rel))throw new Error('恢复目录必须位于自动备份目录之外');
if(existsSync(target))throw new Error('恢复目录已经存在，请指定新的空目录；现有数据未修改');
const manifest=JSON.parse(readFileSync(join(source,'latest.json'),'utf8'));
if(manifest.version!==1||!/^[0-9TZ-]+-[a-f0-9]{8}$/.test(manifest.id)||manifest.database!==manifest.id+'.study.sqlite'||manifest.accounts&&manifest.accounts!==manifest.id+'.accounts.sqlite')throw new Error('备份清单无效');
for(const name of [manifest.database,manifest.accounts].filter(Boolean)){
 const db=new DatabaseSync(join(source,'snapshots',name),{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('数据库校验失败');}finally{db.close();}
}
for(const file of manifest.files){
 if(!/^[a-zA-Z0-9-]+$/.test(file.id)||!/^[a-f0-9]{64}$/.test(file.sha256))throw new Error('附件索引无效');
 const bytes=readFileSync(join(source,'objects',file.sha256));if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('备份附件校验失败：'+file.id);
}
mkdirSync(join(target,'attachments'),{recursive:true});
copyFileSync(join(source,'snapshots',manifest.database),join(target,'study.sqlite'));
if(manifest.accounts)copyFileSync(join(source,'snapshots',manifest.accounts),join(target,'accounts.sqlite'));
for(const file of manifest.files)copyFileSync(join(source,'objects',file.sha256),join(target,'attachments',file.id));
writeFileSync(join(target,'恢复说明.txt'),'题库、个人记录、AI归档和附件已校验恢复。账号数据库含登录资料，请妥善保管。API Key 未包含；请在新环境重新配置。切换服务数据目录前请先停止原服务。\n');
console.log(JSON.stringify({restored:true,directory:target,files:manifest.files.length,apiKeysIncluded:false}));
