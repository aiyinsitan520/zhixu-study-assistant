import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const documentPath = join(root, '工作记录.md');
const marker = '\n## 内置源码快照';
const notes = readFileSync(documentPath, 'utf8').split(marker)[0].trimEnd() + '\n';
const excluded = new Set(['node_modules', 'dist', '.git', '.local', '.playwright-cli', 'output', 'data', 'attachments', 'backups', 'secrets.json', 'test-results', '.DS_Store']);
const files = {};
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith('.env') || /\.(zip|sqlite(?:-shm|-wal)?|log)$/.test(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile()) {
      const name = 'study-assistant/' + relative(root, path).split('\\').join('/');
      files[name] = path === documentPath ? Buffer.from(notes, 'utf8') : readFileSync(path);
    }
  }
}
collect(root);
const archive = Buffer.from(zipSync(files, { level: 9 }));
const digest = createHash('sha256').update(archive).digest('hex');
const base64 = archive.toString('base64').match(/.{1,100}/g).join('\n');
const suffix = `${marker}\n\n生成时间：${new Date().toISOString()}\n\n包含 ${Object.keys(files).length} 个源码及配置文件，ZIP 大小 ${archive.length} 字节。\n\nZIP SHA-256：\`${digest}\`\n\n下面的隐藏区保存 Base64 编码的源码 ZIP。必须传输原始 Markdown 文件，不能只复制渲染后的正文。源码不包含题库、密钥、node_modules 或 dist。\n\n<!-- SOURCE_ZIP_BASE64_BEGIN\n${base64}\nSOURCE_ZIP_BASE64_END -->\n`;
writeFileSync(join(root, 'study-assistant-source.zip'), archive);
writeFileSync(documentPath, notes + suffix);
console.log(JSON.stringify({ document: documentPath, files: Object.keys(files).length, bytes: archive.length, sha256: digest }, null, 2));
