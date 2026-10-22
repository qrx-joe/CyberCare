# 2026-10-22 阿里云部署记录

状态：已发布。Flow #13 成功；公网健康接口和合成材料浏览器闭环均已验证。

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
