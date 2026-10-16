import { spawnSync,spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const [major,minor]=process.versions.node.split('.').map(Number);
if(major!==24||minor<15){console.error('请安装 Node.js 24.15 或更新的 24.x 版本：https://nodejs.org/');process.exit(1);}
const pm=process.platform==='win32'?'pnpm.cmd':'pnpm';
function run(args){const r=spawnSync(pm,args,{stdio:'inherit',shell:process.platform==='win32'});if(r.error||r.status!==0){console.error('启动准备失败。请先安装 pnpm：npm install -g pnpm@10.30.3');process.exit(r.status||1);}}
run(['install','--frozen-lockfile']);
run(['build']);
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{stdio:'inherit',env:{...process.env,STUDY_OPEN_BROWSER:'1'}});
child.on('exit',code=>process.exit(code||0));
