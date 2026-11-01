# biscuit 项目笔记

## 架构
- Cloudflare Workers 单 Worker：`src/worker.js`（路由/鉴权/D1 CRUD）+ `src/dict.js`（词典聚合）
- 静态资源 `public/`（vanilla JS 无构建），assets 绑定 + `run_worker_first = ["/api/*"]`
- D1：`words` 表 + `dict_cache`（7 天 TTL）；migration 在 `migrations/`
- 鉴权：单人 Bearer `APP_TOKEN`（secret）；本地 `.dev.vars` = local-dev-token
- 词典链：dictionaryapi.dev（英英/音标/mp3）→ 翻译 TMT（HMAC-SHA256，需 key）→ MyMemory 兜底（质量差，如 biscuit→"姆鲁古"）→ 发音兜底 dict.youdao.com/dictvoice

## 手势约定（对齐 ifanr biscuit 原版）
- 点中 1/3=翻转释义；点左=发音；点右=笔记；背面点译文=改翻译
- 左滑短=known（变暗沉底）、左滑到底(>130px)=删除；右滑=star（高亮浮顶）
- 排序服务端固定：star > new > known，updated_at DESC

## 用户决策记录（2026-11-01）
- 托管：Cloudflare Workers + D1 云同步；词典 API：腾讯云 TMT（key 待用户提供）
- 模型选择结论：Kimi-K3 最佳 / GLM-5.2 次选（前端主导 + 多轮迭代任务）
- git 已 init，GitHub remote 待用户提供仓库地址

## 待办
- [ ] 用户给 TMT SecretId/SecretKey → wrangler secret put
- [ ] wrangler d1 create biscuit-db → 回填 wrangler.toml 的 database_id
- [ ] wrangler login 授权 → deploy
- [ ] GitHub remote + push
- [ ] 自定义域名（workers.dev 国内不通）
