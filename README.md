# 赛博公益 · CyberCare

> 求一点注意力，一起做件小事。

10/19 前端：根据用户提供的参考，统一大标题、荧光黄／紫色、粗线框与海报核对工作台，保留现有角色与完整核对链路。见[改造与验证记录](doc/reference-frontend-20261019.md)。

10/19 评估：真实模型本批对完整、缺报名方式、缺年份三张清晰合成图调用 3 次，11 个已知字段匹配、1 个未知保留，5,118 tokens。另补齐导出中的年份核实提醒；当前业务 21 项、浏览器 20 项通过。见[模型结果与覆盖边界](doc/stepfun-validation-20261019.md)、[导出修复](doc/recipient-date-20261019.md)。

10/18 进展：真实 StepFun 的首张合成海报冒烟已通过，四个已知字段均匹配；四字段及全文修正、修订留痕、重新检测确认后导出和复制退路已实现。当前仍未完成代表性真实材料、用户效果或社会价值验证。见 [产品目标与推进方案](doc/product-target-20261017.md)、[模型调用记录](doc/stepfun-validation-20261018.md)、[本地评估包](doc/evaluation/README.md)和 [演示讲述稿](doc/demo-story-20261017.md)。

当前是 ACC 2026 的**本地技术 MVP**：角色与预设互动 → 短科普 → 海报信息转换 / 检测 / 人工确认 → 角色反馈和回执。根据用户提供的“求求你了，听我把话说完”参考恢复了抽象入口，见 [方向纠偏](doc/direction-reset-20261016.md)。

原 PRD 的三条任务收敛为海报单链路；音频转写、截图指导、3D 实时虚拟人、云 TTS 和公开分享顺延。完整取舍、10 月 22 日计划与未验证假设见 [MVP 方案](doc/mvp-plan-20261022.md)。

内置合成样例、人工转录路径可立即运行。真实视觉识别现使用 Step Plan `/step_plan/v1` 与 `step-5-preview`，已取得真实图片结果；当前证据覆盖三类原创清晰合成图，其中完整海报曾重复测试，不能外推为整体识别准确率。目标用户测试与机构采用验证仍未开展。自动检测和确认记录都不代表 WCAG 认证。

## 本地运行

需要 Node.js 24+、npm 和已安装的 Chrome 或 Edge。无需安装浏览器、数据库或 Python。PowerShell：

```powershell
Set-Location -LiteralPath D:\code\CyberCare
npm.cmd ci
npm.cmd run dev
```

打开 [本地 Demo](http://127.0.0.1:4310)。首次使用选择“内置合成样例”，勾选材料声明，生成草稿 → 核对/修改 → 检测 → 逐项确认 → 下载文字、HTML 和证据 JSON。可选反馈后删除任务。详见 [验收与三分钟演示步骤](doc/demo-acceptance.md)。

任务区可先展开“先看结果示例”：不提交材料即可查看文字、大字排版和记录状态，不创建任务，也不能作为正式回执。实际核对时，空白字段会提示具体需要向活动方核实什么；没有年份的时间文字会提醒核实日期，不自动补填。

首页可先与角色互动、查看 3 条固定科普示例，再进入上述任务，也可以直接跳过角色。角色现有轻微呼吸、自动眨眼、预设台词的嘴部表情和低头动作；可关闭，离屏或减少动态时停止。互动不是实时 AI 对话，也没有声音或语音口型同步，见 [角色动画与验收](doc/avatar-motion-20261016.md)。

动画素材位于忽略目录 `.local/avatar/character-atlas-v1.png`，build 时嵌入角色模块，不随源码分发。缺少动画素材时回退到未修改的用户参考图 `.local/reference/attention-poster.jpg`；两者均缺失时显示文字角色，科普和任务仍可运行。重新取源码需自行提供有权使用的素材才能复现动画；缺素材的动画专项测试会明确跳过。角色身份与对外使用授权未核实。

服务仅监听 `127.0.0.1`，不适合作为公网服务。若未找到浏览器，在本地 `.env` 指定 `CHROME_PATH` 后重启；使用其他端口可设置 `PORT`。构建后再次启动只需 `npm.cmd start`；修改源码后重新 build。Ctrl+C 停止。

## 可选真实识别

仅在需要真实图片提取时，将 `.env.example` 复制为本地 `.env`，在本机填写 `STEPFUN_API_KEY`、`STEPFUN_BASE_URL`、`STEPFUN_MODEL`，重启服务。密钥不要发送到聊天或写入源码。选择账号实际可用的视觉模型；本项目不猜测模型 ID。

中国站按请求计费 API 使用 `https://api.stepfun.com/v1`，Step Plan 套餐使用 `https://api.stepfun.com/step_plan/v1`，见[官方 Provider 源码](https://github.com/stepfun-ai/Step-Code/blob/main/packages/providers/src/step-provider/index.ts)。按实际资源选择地址，不把套餐额度当作普通 API 余额；分别查询所选地址的 `/models` 并核对图片能力。列表返回模型不等于该账号已获准推理。不会在请求被拒后自动回落到另一计费地址。

配置存在只会启用入口，不表示中文海报质量或供应商数据策略已经验证。适配器基于 StepFun 的[官方图像调用示例](https://github.com/stepfun-ai/Step-3.7-Flash#52-text-and-image-input-example)，模型选择另核对了[官方 Step 5 图片提取示例](https://platform.stepfun.com/cookbook/step-5-vision-structured)。10/18 在必要前置条件处理后，文字探针与合成海报各 1 次请求成功；旧失败记录保留在 [验证记录](doc/stepfun-validation-20261018.md)。已有服务不会自动重读 `.env`，需要在保留现有任务的前提下安排重启或另用端口。

每进程最多 10 次外部请求，`MODEL_REQUEST_LIMIT` 只能向下限制；每任务一次、无自动重试、30 秒超时，鉴权/额度/参数错误立即停止，连续两次其他失败停止。重启会重置进程计数，这不是费用上限。正式测试按方案先说明本轮请求上限，只使用授权且无个人信息的材料，记录返回 usage；不可得时写未知。

## 验证

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:e2e
npm.cmd run evaluate
```

业务测试使用 Node 原生测试运行器；浏览器测试使用已安装的 Chrome/Edge，测试服务端口为 4311，不调用外部模型。`evaluate` 默认运行原创合成文本边界评估，报告写入忽略目录，不代表视觉模型质量。10/16 历史结果见 [原验证记录](doc/validation-20261016.md)，10/17 当前结果见 [本轮验证](doc/validation-20261017.md)。本轮没有配置远程 CI、推送或部署。

## 技术与结构

| 层 | 实际选择 |
|---|---|
| 语言 / 运行时 | TypeScript 7.0.2 strict / 本轮 Node.js 24.13.0 |
| 页面 / 服务 | 原生语义 HTML、CSS、TypeScript / Node HTTP 模块 |
| 契约 | Zod 4.6.7 |
| 自动检测 | axe-core 4.14.0 + playwright-core 1.64.1 |
| 图片尺寸检查 | image-size 2.0.4；再用已有浏览器实际解码 |
| 浏览器测试 | @playwright/test 1.64.1 |
| 存储 / 部署 | 单进程内存，30 分钟到期；未部署 |

`src/web/` 页面 → `server.ts` HTTP → `service.ts` 生命周期 → `domain.ts` 规则。`provider.ts` 隔离模型协议，`audit.ts` 隔离浏览器，`contracts.ts` 统一关键字段与运行时校验。

本轮具体决策：

- 采用单链路保留完整核对流程，避免三种任务同时扩大质量验证范围。
- 缺失、模糊或无转录引用支持的字段标为未知，不能由模型常识自动补全。
- HTML 从受控模板生成，转义用户和模型文字，避免把海报中的指令作为可执行内容。
- 检测记录绑定结果版本和 HTML 哈希；编辑使旧检测失效，下载同一模板结果。
- 处理完成、操作者确认、自报反馈和机构采用分别记录；没有证据的后两类结果不自动补齐。
- 删除/取消/过期优先于晚到的模型响应，幂等请求不应触发重复模型处理。

## 数据边界

图片限 PNG/JPEG/WebP、2 MB、单边不超过 8000、总像素不超过 1600 万；请求体限 3 MB。原图仅在内存处理，不写本地上传目录。浏览器临时预览、服务端任务和文本最长保留 30 分钟；内存服务重启即丢失，页面刷新不自动恢复。任务按 HttpOnly、SameSite=Strict 的匿名会话隔离。

删除撤回本方任务访问并清空当前页面资料；无法删除已经下载的文件，也不能承诺第三方模型副本已删除。内存回收由运行时决定。请勿使用身份证、真实联系方式、密码、验证码等个人或敏感信息进行演示。证据 JSON 包含原始转录和修改文字，分享前需另行审查。

原始资料：[PRD](writing-block.md)、[研究报告](deep-research-report%20%2814%29.md)；当前状态：[To do](doc/to-do.md)。
