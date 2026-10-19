# 局部模糊材料：调用前准备

日期：2026-10-20（Asia/Shanghai）。上一节点完成单张无文字负例与未知提示；本节点检查部分文字不可见、部分仍可读时的边界，当前模型请求 0。

## 材料与先验

采用 [Red Bull Air Race 2007 (blurred).jpg](https://commons.wikimedia.org/wiki/File:Red_Bull_Air_Race_2007_(blurred).jpg)，作者 Feliciano Guimarães，文件页声明 [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)，已读取许可说明。来源历史记载 DarwIn 模糊处理、Cropbot 裁切；下载后的当前图未做本地修改，不表示原作者认可本项目。原文件 1,083×1,595 JPEG、257,940 bytes，SHA-256 为 `2c014f808db452742635299a7beab5be66ad626408b2605ca7a16a5da1bfbabd`。

原图上方海报区域被模糊，下方可读 `PORTO`、`RIBEIRA`、`CAIS DE GAIA`、`1 SETEMBRO`、`13:00 H` 与网站域名。先验为时间、地点 2 项已知；活动正式名称与报名方式 2 项未知。域名不足以确认活动名称或报名用途，拍摄年份和文件名不能补成活动年份；不访问图上网址。小型赞助标志和全文未设独立完整答案，不能外推全文识别准确率。

先验清单在首个模型请求前冻结，SHA-256 为 `dc6c55005bbbbf344fe67515ac27deda34f67104b3ce7926375cf30544a80ff3`。原图、许可来源、只读元数据与实际浏览器解码检查保存在 `.local/validation/blurred-control-20261020/`，不进 Git。画面未观察到人物、个人联系方式或二维码；所检查的 EXIF / XMP 名称未发现个人或 GPS 候选字段。Pillow 缺少 XMP 解析依赖，另以有界标准库解析复核；原 XMP 的 5 处无效数字字符引用仅在内存解析副本忽略，原图与元数据字节不变，失败事实保留。

## 执行与判定

1. 固定材料与先验 → verify：Commons SHA-1、原图 SHA-256、尺寸 / 签名和实际解码，不向模型发送网页标题或先验。
2. 最多 1 次 `step-5-preview` / `poster-extract-v3` 请求、0 重试，90,000 ms、4,096 输出 tokens → verify：原始与应用字段分别评分，记录实际请求与可得 usage。成功、超时、失败、截断或发现编造 / 遗漏 / 差异均结束本批；请求上限不是人民币费用上限。
3. 原图对照和错误复查 → verify：原报告与先验不改写，另列审阅与未验证项；只在实际缺陷需要时修改产品，按节点提交。

这是一张来源方已处理的实拍海报，不能替代自然失焦、运动模糊、代表性材料或用户效果验证。读屏检查亦未开展：本机有 Windows 讲述人，但原生工具初始化返回“failed to write kernel assets: 系统找不到指定的路径。 (os error 3)”，没有实际朗读观察，不将 DOM 或自动 axe 当作读屏通过。
