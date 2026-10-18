# 赛博公益 · CyberCare

本地技术 MVP：2D 概念角色与预设互动、固定短科普、单张海报的草稿、修正、同版本 HTML 检测、逐项确认与本地导出。合成样例、人工转录与可选 StepFun 视觉识别分别标识。

需要 Node.js 24+、npm 及已安装的 Chrome/Edge。运行 npm.cmd ci 后执行 npm.cmd run dev，打开 http://127.0.0.1:4310/。默认合成路径无需模型调用；可按 .env.example 在本机配置真实模型，密钥不进 Git。

验证：npm.cmd run typecheck、npm.cmd test、npm.cmd run test:e2e。测试使用合成输入和替代上游，不证明真实模型质量、用户效果或 WCAG 符合性。

任务按匿名会话隔离，只在本机内存保留最多 30 分钟；修改会使检测与确认失效。服务不用于公网运行。

角色帧图与参考图保存在被忽略的 .local/ 中，不随源码提交；缺素材时使用文字退路。角色效果与素材对外授权仍待验证。

产品范围见 doc/mvp-plan-20261022.md，流程验收见 doc/demo-acceptance.md，实际验证见 doc/validation-20261016.md。
