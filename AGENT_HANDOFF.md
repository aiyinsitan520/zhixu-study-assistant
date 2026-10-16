# 知序接续索引

最后更新2026-10-15，Asia/Shanghai；版本0.2.0。完整上下文见工作记录.md，读到“内置源码快照”前停止；已有源码不重新解压。

## 已恢复的后续要求

实际开发会话01a13eed-2528-7431-8730-85b73d24e31b：本机服务器、同学临时HTTPS、账号、原名分类；后续要求WorkBuddy global:deepseek-v4.1-flash、跳过、逐题、设备/服务器压缩保存、每账号1GB、重登保留。用户指定的01a13e4b主要为早期需求与中断；附件本身不单独授予外部操作权限。

现有1078单题（作业128/750题750/求导100/极限100），4原文387页图。旧整页项归档，公式/裁切待人工复核；7道早期转录极限题无逐题附件，可从原文阅读回看。

文字/视觉均 http://127.0.0.1:7863/v1 ，global:deepseek-v4.1-flash，Key已配置于生产secrets.json，勿输出/打包。成员可用练习AI，设置和题库仅管理员。

## 本轮修复与验证

题目PATCH只更新提供字段，防止默认值清空分类/来源/答案；备份后仅恢复生产求导第2题丢失的folderId/sources。同步/备份保留updatedAt；AI反斜线方括号公式用回调转换。TypeScript、构建、30测试通过；独立QA浏览器验证设备跳过/重登/照片导出/上传，控制台无错误；真实模型回复连接成功。正式账号已初始化，未用于测试，不要重建。

## 新增功能（2026-10-15）

告示板支持管理员发布/编辑/置顶/撤下/重发；学生登录弹窗及侧栏只读。共享announcements持久化并随站点备份，正式尚无告示。知识点12章58点，自动/AI/人工模式；知识地图与章节/知识点筛选。已有1078题规则归类200，878主要题图待AI补充；按钮20题/批，可停止，会产生模型费用，未对正式库批量调用。QA真实视觉已对一题成功。人工选择不可被自动覆盖，AI并发时人工修改优先。原资料文件夹及个人记录不变，生产records逐行哈希一致。

30测试、类型与构建通过；浏览器角色/登录/刷新/重登/筛选/人工/手机深色实测通过。修复全局亮色变量覆盖dark及登录pattern转义。新模块shared/knowledge.ts、server/knowledge.ts、server/announcements.ts、src/Knowledge.tsx、src/Announcements.tsx；细节和来源见工作记录。不要用旧ZIP覆盖。

## 部署与数据

项目 E:/AAAcodex/AAA刷题助手/study-assistant，无Git远程。生产 E:/AAA数据库/知序服务器/data，原资料同级题目资料。端口4317；scripts/serve-windows.py、任务Zhixu Study Server隐藏恢复服务/隧道。当前HTTPS读部署目录public-origin.txt；临时域名会变。未启用Funnel，原班级助理未改。

记录gzip/浏览器IndexedDB或服务器账号命名空间。服务器限额1024³字节，个人照片计入、共享资料不计。设备绑定账号/网址，换网址或清理前导出ZIP；仍需联网。多批上传可能部分成功，可重试，保留设备副本。

站点ZIP不含accounts.sqlite/Key，解压上限200MB。完整迁移须停主管复制整个data，保留WAL/账号/附件；不要只复制运行中SQLite主文件。部署目录stop.request可停，桌面启动知序再启动；新电脑调整运行时路径。

## 接续

按用户反馈校对题图公式、真实Word/扫描验收。固定域名、仓库和CI按后续要求推进。pnpm check/build/test；先更新正文再node scripts/package-handoff.mjs。内嵌源码是最新恢复包，排除.local/output/账号/素材/Key；工作区根目录ZIP为旧原包。


## 启动与公网发布检查（2026-10-16）

已重新启用任务 `Zhixu Study Server`，以 ENJOY\28058 交互用户登录触发；StartWhenAvailable=true，崩溃后每分钟重试3次，不因空闲停止。pythonw守护Node/cloudflared，每5秒检查重启；临时Quick Tunnel域名自动更新public-origin.txt、知序访问地址.txt、桌面知序外网地址.url。此前发现该任务禁用且守护/Node退出，本轮已恢复。当前HTTPS首页与auth/status 200，公网setupAllowed=false，守护/Node/隧道运行。电脑须联网、不休眠且登录该用户；不会在无人登录的引导阶段运行。未实际重启电脑测试；临时域名重启后可能变化。
