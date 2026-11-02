# biscuit 项目笔记

## 架构
- Cloudflare Workers 单 Worker：`src/worker.js`（路由/鉴权/D1 CRUD）+ `src/dict.js`（词典聚合）
- 静态资源 `public/`（vanilla JS 无构建），assets 绑定 + `run_worker_first = ["/api/*"]`
- D1：`words` 表 + `dict_cache`（7 天 TTL）；migration 在 `migrations/`
- 鉴权：单人 Bearer `APP_TOKEN`（secret）；本地 `.dev.vars` = local-dev-token
- 词典链：dictionaryapi.dev（英英/音标/mp3）→ 翻译链 Azure→百度→MyMemory → 发音兜底 dict.youdao.com/dictvoice
- 翻译引擎最终定为 Azure AI Translator F0（200 万字符/月永久免费，超额拒绝不扣费）；key 在 .dev.vars，部署时 wrangler secret put；region=eastasia
- 用户纠正记录：腾讯云 TMT 已无免费额度（2026-10 文档）；DeepL 月度免费层已取消（新人一次性 100 万字符）；方案级变更必须先确认再动代码

## 手势约定（对齐 ifanr biscuit 原版）
- 点中 1/3=翻转释义；点左=发音；点右=笔记；背面点译文=改翻译
- 左滑短=known（变暗沉底）、左滑到底(>130px)=删除；右滑=star（高亮浮顶）
- 排序服务端固定：star > new > known，updated_at DESC

## 用户决策记录（2026-11-01）
- 托管：Cloudflare Workers + D1 云同步；词典 API：腾讯云 TMT（key 待用户提供）
- 模型选择结论：Kimi-K3 最佳 / GLM-5.2 次选（前端主导 + 多轮迭代任务）
- git 已 init，GitHub remote 待用户提供仓库地址

## 线上环境（2026-11-02 已上线）
- 地址：https://biscuit.iliy.workers.dev
- 口令：discuit6367（用户自定，2026-11-02 晚起生效，.dev.vars 同步）
- CF 账号 iliy（yinzhi6367@gmail.com），Account ID ceedd6542e165201118a88d7afe8b83f
- D1：biscuit-db，id 8e522098-3396-4310-91c1-9f5f81c81360，区域 WNAM（创建时未指定，可在 CF 后台改）
- GitHub：https://github.com/iliyz/discuit.git（仓库名叫 discuit，项目名 biscuit，不影响）
- 本机直连 workers.dev 不通，需走本地代理 127.0.0.1:49637；测线上用 node + undici ProxyAgent
- 已知小瑕疵：dictionaryapi.dev 约 8% 的词只有 mp3 无 IPA 文本（如 resilient），音标留空

## 待办
- [x] wrangler login → d1 create → remote migration → secrets → deploy（2026-11-02 完成）
- [x] GitHub remote + push
- [ ] APP_TOKEN 目前是脚本生成的 biscuit-af19aa87ec22e8b50e，用户可自行更换
- [ ] Azure key 已出现在聊天记录，建议在门户重新生成后更新 secret
- [ ] 自定义域名（workers.dev 国内不通，用户暂不考虑）
