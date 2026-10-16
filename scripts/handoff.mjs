import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));process.chdir(root);
const git=(...args)=>{try{return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{return '';}};
const remote=git('remote','get-url','origin').replace(/(https?:\/\/)[^/@]+:[^/@]+@/,'$1');
const branch=git('branch','--show-current'),head=git('rev-parse','HEAD'),upstream=git('rev-parse','@{upstream}');
const clean=git('status','--porcelain').split('\n').filter(x=>x&&!x.includes('工作记录.md')).length===0;
const fetch=remote?(()=>{try{execFileSync('git',['fetch','origin'],{stdio:'inherit'});return true;}catch{return false;}})():false;
const pushed=fetch?git('rev-parse','@{upstream}'):upstream;
const verified=!!remote&&fetch&&head===pushed&&clean;
const section=`\n## 自动交接快照\n- 时间：${new Date().toISOString()}\n- 仓库：${remote||'未配置'}\n- 分支：${branch||'未初始化'}\n- 本地提交：${head||'无'}\n- 已推送提交：${pushed||'未验证'}\n- Git 状态：${verified?'代码与远程一致；本工作记录仍需提交并推送。':'尚未验证远程同步；可使用本文末尾完整源码快照恢复。'}\n- 仓库恢复命令（已配置远程时）：git clone 仓库地址 → cd study-assistant → pnpm install --frozen-lockfile → pnpm build → pnpm start\n- 题库与 Key：不在 Git 中；备份包导入题库，重新填写 Key。\n`;
const file=join(root,'工作记录.md');const original=readFileSync(file,'utf8').split('\n## 内置源码快照')[0].split('\n## 自动交接快照')[0];writeFileSync(file,original.trimEnd()+'\n'+section);console.log(section);
// Keep the embedded ZIP last and regenerate it after the document changes.
execFileSync(process.execPath,[join(root,'scripts','package-handoff.mjs')],{stdio:'inherit'});
