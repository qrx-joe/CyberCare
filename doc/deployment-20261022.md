# 2026-10-22 阿里云部署记录

状态：已发布两次。Flow #13 成功（晨间，含公网浏览器闭环）；同日午后按分节点提交的源码再次发布，Flow 自动触发成功，公网闭环复验通过，见文末「午后增量发布」。

## 目标与授权

- 用户明确要求发布到 `https://acc.oozoo.cc/cybercare/`，并已完成云效登录。
- 用户另行授权：仅在阿里云镜像内安装 Playwright 官方 Chromium 及系统依赖。本机未安装浏览器。
- Codeup：`ai-store/m-9703-acc`；Flow：`5330393`；原基线为 `b36f787c8d000b53992d8d18820389287b9abbe3`（历史成功运行 #11）。
- 在忽略目录 `.local/deployment-20261022/m-9703-acc` 建立独立检出，保留主工作区原有未提交修改；未向主项目 GitHub 推送。

## 发布内容与结构影响

- 部署提交：`2842cc364c368e23b1c429fb5c5b2eb52d4ffab0`；云端浏览器安装授权提交：`158bd765c7a5d5768e39377b2163830351ef1a56`。已正常快进推送至 Codeup `master`。
- `server/entry.mjs` 在原 Node HTTP 底座内挂载 `/cybercare/`；旧页面增加入口，原业务 API 保留。新版使用独立命名空间、Cookie 路径和内存生命周期。
- `cybercare/` 是当前本地源码及测试快照；来源主提交 `d0070f34bbca1d67b0971eb6b042789a3b4a7fac`，包含工作区未提交实现，文件哈希记录在 `cybercare/source-snapshot.json`。
- 部署副本的引擎声明适配已验证的 Node.js 22.22.2；主项目 Node.js 24 约定未修改。部署包装脚本显式写入外层发布提交，健康接口可核对实际运行版本。
- 生产镜像排除 `.env`、本地参考图、衍生动画、SDK、截图、测试报告等；构建设置 `CYBERCARE_INCLUDE_LOCAL_MEDIA=0`。页面保留文字角色退路；公网 Xingyun 接口仍受本机限制。
- 未迁移数据库、未读写共享 MySQL、未搬运本地模型凭据；没有新增公开结果库或自动公开发布功能。

## 发布前验证与修复

- 主项目类型检查通过；业务测试 71/71 通过。
- 主项目浏览器全量第一次为 64/66，通过失败复现发现旁白同步回调状态覆盖及旧 UI 断言。局部修复后旁白定向测试 4/4 通过；没有声称再次完成全量 66 项。
- 另修复构建测试的合成源码清单，补齐 `avatar-stage.html`，避免构建测试 ENOENT。
- 独立部署副本在官方 Node.js 22.22.2 下：静态检查通过，原底座及接入单测 4/4，新版业务测试 71/71，真实 Chrome 网关浏览器闭环 1/1。
- 提交前检查差异、空白及密钥；没有将本地密钥和参考素材带入部署仓库。
- 本机 Docker 守护进程不可用，未在本机验证 Linux 镜像；镜像安装及浏览器自检在云效执行。

## 流水线记录

- Flow Node.js 构建命令已保存并重新打开核实：`npm ci --ignore-scripts --no-audit --no-fund` → `npm run cybercare:build` → `npm run check` → `npm test` → `npm run cybercare:test` → 重新写入发布版本。构建先设置 `set -eu` 和 `CYBERCARE_INCLUDE_LOCAL_MEDIA=0`。
- #12：提交 `158bd765` 自动触发，应用构建和测试通过。镜像中 Node 启动失败，报 `uv_thread_create` 断言、退出码 134；未进入 K8s 部署。实际日志显示 BuildKit v0.8.0，与编辑界面显示的 v0.11.6 不一致。
- 依据[阿里云官方构建排障](https://help.aliyun.com/zh/yunxiao/user-guide/issues-in-building)，将 BuildKit 先选择 v0.9.0 保存，再明确选择 v0.11.6 保存，重新启动 #13。新日志确认实际使用 v0.11.6，Node 启动故障消失，浏览器安装与自检完成。
- #13：2026-10-22 09:43:45（Asia/Shanghai）手动启动，4 分 6 秒后成功；镜像构建任务 2 分 49 秒，K8s 部署任务 1 分 15 秒。发布提交 `158bd765c7a5d5768e39377b2163830351ef1a56`。

## 公网验证结果

- `GET /cybercare/api/health` 返回 200；运行提交与发布提交相同，`restartRequired=false`，`localMediaIncluded=false`。
- 应用指纹：`fe56fbb361885db7d40fc8c7eb1445aa2d766e92a68ac5530789a4fd21e216d7`。健康记录中的 `sourceDirty=true`；未取得 CI 构建时变更清单，不能声称完全干净构建，保留该字段如实记录。
- 实际公网浏览器验证 1/1 通过（11.8 秒）：旧页面入口 → 新页面 → 合成草稿 → 人工编辑 → 服务端真实 axe → 四项与完整内容确认 → 导出下载 → 删除后 404。
- `axe-core 4.14.0` 对该次导出 HTML 检测：violations 0、incomplete 0、passes 31；导出 HTML SHA256 与检测回执相同。额外合成 PNG 图片实际解码通过；创建的测试任务均已删除；页面运行错误 0、模型请求 0。
- 公网 `/api/config` 明确返回 `provider.live=false`。当前使用内置合成样例或人工转录；未配置公网真实模型。公网虚拟人配置接口返回 403，保持本机验证边界。
- 证据放在忽略目录 `.local/validation/deployment-20261022/`：`health.json`、`receipt.json`、`verification.json`、`live-e2e.json`、`synthetic-export.html`、`live-home.png`、`live-completed.png`、`flow-success.png`，均不进入 Git。

## 验证边界

合成材料与自动化通过只证明相应部署和协议行为，不代表真实用户效果、真实模型质量、公益采用或完整 WCAG 符合性。公网模型配置、真实用户验收与公开结果持久化分别核实，不从页面可打开推定完成。

## 回滚

需回滚时，在云效使用既有成功基线 #11 的镜像恢复；不强制改写远端 Git 历史。回滚后仍须实际检查旧页面及健康接口，不能仅以流水线按钮成功判断恢复。

## 午后增量发布（第二次）

- 触发与授权：用户要求"分批次分节点提交并部署到云效"，并给出 ACC 2026 黑客松方案链接（作品提交截止 10/22 20:00，需公开可运行 Demo）。
- 主仓库分四节点提交（每个中间提交均通过 `tsc --noEmit`）：`07e6f19` docs（多模态/星云/导航/部署记录与规则更新）、`f0ead98` 星云播报网关 + 角色舞台帧 + 磕头动画、`60165d1` 语音转写与截图指导、`464af52` 工作台导航、服务端接入与口语化文案（含 3 处过时断言修复：fallback / rejected-evidence / task-read-recovery）。
- 发布前验证：typecheck 通过；业务测试 81/81；浏览器全量 73/73。首轮全量曾现 11 失败，其中 3 处为文案改写后未更新的确定性断言（已修复），其余 8 处源于当轮本地服务进程中断，干净复跑同一代码全量通过，未复现崩溃。
- 晨间快照（01:30 复制）不含当日午后实现的 assistance 文件与 narrator/xingyun 等修改；本次同步新增 7 个文件、更新 20 个，快照 `sourceCommit=464af52`、`sourceDirty=false`。`package.json`/锁文件未动，保留 Node 22.22.2 引擎适配；文本文件按既有约定 LF 规范化。
- 部署副本预检：外层 `npm run check` 通过；内层业务测试 81/81。推送 `a794147`（`158bd76..a794147`，master 快进）自动触发流水线，约 4 分钟后公网健康接口运行版本切换为新提交。
- 公网验证（真实 Chrome 闭环 9/9）：首页/语音转写/截图指导/工作台导航与标题正确；合成语音样例任务创建（模型请求 0）→ 确认 → 文字导出（含"非 WCAG"边界）→ 删除后 404；工作台样例海报回归；`provider.live=false`；页面错误 0。`/api/assistance/config` 可用（audio/guide 均未配置）；`avatar-stage.html` 公网仍 403。证据在 `.local/validation/deployment-20261022-2nd/`，不进 Git。
- 已知边界：健康接口 `sourceDirty=true` 由外层 stamp 脚本在 CI 时对部署仓库执行 `git status` 计算，晨间同样为 true；`cybercare/dist` 已在部署仓库 ignore 内、本地 status 干净，CI 侧具体变更清单未取得，沿用晨间口径如实保留，不声称完全干净构建。
- 主项目 GitHub 远端（qrx-joe/CyberCare）本轮未推送，等待用户确认。

## 第三次发布：角色与虚拟人上公网（10/22 用户授权）

- 用户核验部署后指出"右上角虚拟人物与虚拟人都没放上去"；经确认授权两项上公网。
- 主仓库 `03919a2`：`build.mjs` 帧图改为"存在即嵌入"（`CYBERCARE_INCLUDE_LOCAL_MEDIA=0` 仅继续排除含个人信息的参考图与只读示例）；`server.ts` 虚拟人主机门禁从仅本机改为完整域名白名单；`xingyun.ts` 会话预算本机默认 3 / 公网默认 100 / 上限 300。验证：typecheck、业务 81/81、浏览器 73/73。
- 部署仓库 `9eadb31`：两张帧图与哈希固定的星云 SDK 以精确 gitignore 例外进入 Codeup 私有仓库（不进公开 GitHub）；外层 stamp 守卫改为校验应用指纹并禁止参考图进产物（原 `localMediaIncluded===false` 断言随公网帧图过时）。本地预检：构建后 host.js 5,168,198 字节、SDK 通过哈希校验、业务测试通过。
- 公网验证（真实 Chrome）：`/api/avatar/config` 200（`limit:100`；密钥未配前如实显示"星云应用尚未配置"）；`avatar-stage.html`、`xmov-avatar.js` 200；host.js 5.17MB 含帧图；角色 canvas 实测 58,416 个不透明采样像素（文字退路为 0）、磕头入口存在、工作台回归正常、页面错误 0。health：commit `9eadb31`、`localMediaIncluded=true`、新指纹 `049f95ae…`。证据在 `.local/validation/deployment-20261022-3rd/`。
- 待办（用户操作）：在云效流水线 / K8s 部署环境变量中添加 `XINGYUN_APP_ID`、`XINGYUN_APP_SECRET`（值在本机主项目 `.env`），重新运行流水线后虚拟人播报即启用；Agent 不代填密钥，也不主动创建真实星云会话验证。

## 第四次发布：虚拟人密钥进镜像（10/22 用户授权，bdd5148）

- 用户要求 Agent 代为配置云效侧星云密钥。经浏览器登录云效核实：k8s 部署任务为"Kubectl镜像升级"步骤，仅替换镜像、不支持注入容器环境变量；发布类步骤亦无命令执行能力；本机无该集群 kubeconfig。生产容器现有环境（HOST/PORT/公网域名）实际来自 `server/entry.mjs` 默认值。
- 采用镜像内 env 方案：`.env`（仅 `XINGYUN_APP_ID`/`XINGYUN_APP_SECRET` 两项）随 Codeup 私有仓库提交（`.gitignore`/`.dockerignore` 精确例外），Dockerfile 启动命令改为 `node --env-file-if-exists=/root/inner/.env server/entry.mjs`（Node 22.22.2 支持）。密钥只存在于私有 Codeup 仓库与私有镜像，不进公开 GitHub、不进 K8s 明文环境、不出现在任何日志输出；MySQL 调试凭据未纳入。
- 流水线 #16 由推送 bdd5148 自动触发。公网验证：`/api/avatar/config` 返回 `configured:true`（见下方验证记录），虚拟人弹窗可用；Agent 未创建真实星云会话，声音与口型的真实验收由用户自行点击完成。
- 取舍说明：K8s Secret + 集群侧注入是更标准的做法，但当前无集群权限与流水线字段支持；本方案为比赛演示的最短可靠路径，赛后可迁移。

## 第五次发布：关闭瞬时失败停用网关的修复（ded0b88）

- 事件：公网真实试播 1 次成功后，停止会话的 DELETE 遇星云端 502，旧逻辑立即置"本进程因失败停止"，虚拟人在重启前不可用（17:00 前后在 /api/avatar/config 观测到 `configured:false` + `lastFailure DELETE 502`）。
- 修复（主仓库 `642be5e`）：关闭未确认仍对该次会话持续报错（语义不变），不再整进程停用；创建失败仅鉴权/额度类（401/402/403/429）停用；`upstream` 将 error_code 分类移到密钥守卫之前，鉴权失败即使响应回显凭据也能正确归类且不透传。验证：业务 83/83、浏览器全量 80/80。
- 同步脚本改为目录全量扫描：固定清单曾漏掉并行开发中的 `src/audio-review.ts` 导致部署副本编译失败，已在推送前拦截修复。
- 本次快照含并行会话进行中的 assistance 加固改动（`sourceDirty=true` 如实记录，本地与 CI 双侧 83/83 通过）。流水线 #17 镜像构建耗时约 10 分钟（较平时慢），最终成功上线。
- 公网复验：`/api/avatar/config` 恢复 `configured:true`、`requests:0`；虚拟人弹窗同意门禁正常；语音/截图/工作台页面回归通过；页面错误 0。
