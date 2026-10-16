# 知序接续索引

最后更新2026-10-16，版本0.3.0内测。完整上下文见工作记录.md，读到“内置源码快照”前停止；已有源码不重新解压，不使用旧ZIP覆盖。

## 最新功能与确认
用户选择继续本机、暂无域名/Cloudflare账号；额度每账号每日固定次数、管理员可调。已取消邀请码、开放注册、24小时签名游客（本地练习，AI/上传/服务器写需注册）。用户看板为默认首页，包含通知/概况/每日余量/模型及个人API配置；新手指南、内测提示。

普通成员可创建个人文件夹、上传PDF/Word/TXT/照片并校对入库，ownerId隔离题目、任务及附件。管理员新上传确认入库后排队生成共享答案与解析，所有用户免费查看；标AI待核对、不覆盖原文及并发修改。既有1078题不自动批量调用。看板可重试失败任务。

默认每账号30次/北京时间日，ai_usage持久化、并发预占失败返还；管理员调整默认与逐人覆盖，所有AI途径共用额度。CN实测glm-5.3-flash/kimi-k2.8-preview/kimi-k2.7可用；kimi-k3-1/kimi-k2.6/glm-5v-turbo503，UI标状态。原DeepSeek文字/视觉保留默认。用户个人API允许官方服务商列表，Key在data/user-ai-keys.json，后端不回传，不打源码/题库备份；自有API不扣内测次数。

已发布正式置顶通知 eebf6e3e-b2dc-4180-9f3d-458a06fce737，文案见内测公告.md，用户看板及登录弹窗可见。36测试/TS/构建、独立4319三角色浏览器/手机深色通过；原2617条生产records哈希不变，只新增通知=2618。活动单题1078，questions总1206含归档。

## 部署与迁移
项目E:/AAAcodex/AAA刷题助手/study-assistant，无Git远程。生产E:/AAA数据库/知序服务器/data；端口4317，原资料同级题目资料。登录任务Zhixu Study Server启动pythonw守护Node/cloudflared，每5秒重启异常子进程；只在用户登录后运行。当前公网读public-origin.txt，临时Quick Tunnel仍会变。最新Node PID43072仅作记录，用前核对命令行/端口。

固定隧道支持及scripts/configure-fixed-tunnel.ps1已就绪，详见固定网址与本机部署.md；暂无fixed-tunnel.json，未切换/购买/注册/DNS。Token保存在部署目录外部文件，以--token-file启动，不放源码。当前守护未重启，保持原临时网址；配置固定域名后重启守护才生效。

WorkBuddy127.0.0.1:7863/v1，默认global:deepseek-v4.1-flash，Key在生产secrets.json，勿输出。守护不启动WorkBuddy。设备记录绑定账号/网址，换网址前导出；游客记录不自动转注册账号。个人题库资料保存在服务器，设备导出主要含作答。

每账号1GB压缩存储；站点ZIP不含accounts/Key/AI控制表，恢复不清额度。完整迁移停守护后复制整个data（包括WAL/附件/新user-ai-keys.json），不要只复制运行中的sqlite主文件。MD仅恢复源码和上下文，不含题库/真实账号/Key。

## 维护
新增模块server/ai-access.ts、personal-ai.ts、shared-solutions.ts、shared/ai-models.ts、src/Dashboard.tsx、dashboard.css、tests/beta.test.ts。保留Zod4 PATCH仅应用提供字段、同步updatedAt、公式回调转换、dark变量修复。先更新正文，再node scripts/package-handoff.mjs。运行本地tsc/vite/tsx，避免pnpm fallback自动安装确认。真实Word及旧题图全量人工验收待后续。

## 对外 API 文案调整（2026-10-16）

按站长最新要求，看板、个人调用方式、新手指南、导入提示和正式公告的对外称呼统一使用“站长购买的官方 API”，保留内测每日免费额度及自有 API 计费说明。技术接入配置与原有额度逻辑未改变。该要求是对外文案要求，开发维护仍以真实配置为准。正式公告更新原有条目，不重复发布。

## GitHub 上传与合并后复核（2026-10-16 下午）

项目已初始化为 Git 仓库并推送到 GitHub：`https://github.com/aiyinsitan520/zhixu-study-assistant`（公开，默认分支 `master`）。首次提交 `b531103` 含金币商店/皮肤、同学排行榜与侧栏底部按钮修复。仓库内不含 secrets.json、账号库、附件与素材；`.gitignore` 已覆盖 `secrets.json`、`backups/`、`user-ai-keys.json`、`cloudflare-token.txt`、`fixed-tunnel.json`、`__pycache__/`。提交身份用仓库级配置（`aiyinsitan520` 及其 GitHub noreply 邮箱），未改全局 git 配置。

`.github/workflows/ci.yml`（macOS/Windows 双平台 pnpm build+test）**尚未推送**：`gh` 令牌只有 `gist, read:org, repo` 权限，缺少 `workflow` 作用域，GitHub 拒绝写入 workflow 文件。文件仍在工作区。补齐方式：`gh auth refresh -h github.com -s workflow`（需浏览器交互授权）后 `git add .github && git commit && git push`。

本轮在 Codex 内测改动全部落地后重新复核（同一工作区，两轮改动已合并）：tsc 无错误、生产构建通过、**36/36 测试通过**。独立 QA 起在 4331（数据目录 `.local/qa2-data`，与生产 4317 完全隔离），浏览器实测：

- 侧栏 14 项导航全部可点击并各自跳转到正确页面（含「账号与同学」）；窗口高度 1000/900/820/768/660/600/520/460 下底部控件均在视口内且 `elementFromPoint` 可达，h=520 真实点击成功进入账号页。侧栏底部固定、仅中段滚动的修复在导航从 11 项增至 14 项后依然成立。
- 商店：6 张皮肤卡价格正确，余额 1000 时买「樱花雾」→ 820 且 `data-skin=sakura`、`localStorage['study-skin']` 同步、刷新后保持；切回免费「森林原野」不扣金币。余额 5 时高价皮肤按钮禁用并显示「还差 235」。
- 排行榜：渲染名次/同学/答对题数/正确率/练习次数五列；匿名开启后**他人视角**看到 `匿名同学 0111`（同用户 ID 派生、两次请求一致），本人仍看到真实姓名，接口不返回 answer。
- 皮肤 × 浅/深色共 12 组：活动导航项对比度 5.47–7.42，非绿色皮肤无残留墨绿；pageerror 与 console error 均为空。移动端 390×780 无横向溢出。

复核期间页面 CSP 已含 `script-src 'self'`，QA 脚本不能注入内联脚本，探针改为在 `page.evaluate` 内联定义辅助函数。注意 `getComputedStyle` 对 `color-mix()` 返回 `color(srgb r g b)`（0–1 量程），按 0–255 解析会得出错误的对比度结论。
