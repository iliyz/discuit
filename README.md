# biscuit · 背单词

一个部署在 Cloudflare Workers 上的极简背单词 PWA（灵感来自 [biscuit](https://www.ifanr.com/app/353278)）。

> ⚠️ 项目处于草稿/快速迭代阶段，交互和记忆模型仍在调整中。

## 功能

- 输入单词回车即收录：自动补全中文翻译、音标、真人发音（Azure AI Translator + dictionaryapi.dev）
- 手势：左轻滑=记住（颜色层级变浅）、左滑到底=移到列表尾部、右轻滑=记忆回退、右滑到底=红标记（右缘色块显示次数）
- 点击分区：左/中/右三个区域功能与比例均可在设置中自定义（发音 / 翻转 / 编辑）
- 记忆颜色层级：biscuit 绿底起步，随记忆加深渐变为白底黑字
- 翻转浮层：点行中间展开释义浮层，可选中复制，不打断列表
- PWA：可安装到 Android/iOS 主屏幕，离线缓存静态资源
- 云同步：D1 数据库，单口令（Bearer token）鉴权，多设备共用

## 技术栈

| 层 | 选型 |
|---|---|
| 托管 | Cloudflare Workers（静态资源 + API 同一 Worker） |
| 数据库 | Cloudflare D1（SQLite） |
| 翻译 | Azure AI Translator F0（免费 200 万字符/月）→ MyMemory 兜底 |
| 词典 | dictionaryapi.dev（英英/音标/mp3） |
| 前端 | 原生 HTML/CSS/JS，无构建，Service Worker 离线缓存 |

## 发音实现

点击发音按以下优先级取音频：

1. **dictionaryapi.dev 返回的真人 mp3**（收录词条时已缓存 `audio` 地址，美/英音视词条而定）
2. **有道 dictvoice**（`dict.youdao.com/dictvoice`，非官方接口）：词典未提供 mp3 时回退使用
3. **浏览器 speechSynthesis 合成**：mp3 播放失败（断网/接口失效）时最后兜底

设置页「发音 → 发音源」可切换 **真人优先（native，默认）** 与 **设备合成（tts，直接用系统语音）**。

## 部署

```bash
npm install

# 登录 Cloudflare（浏览器授权）
npx wrangler login

# 创建 D1 并回填 wrangler.toml 的 database_id
npx wrangler d1 create biscuit-db

# 建表（本地 + 远端）
npx wrangler d1 execute biscuit-db --local  --file=./migrations/0001_init.sql
npx wrangler d1 execute biscuit-db --remote --file=./migrations/0001_init.sql
# 后续迁移同上（如 0002_memory_model.sql）

# 配置密钥
npx wrangler secret put APP_TOKEN              # 访问口令
npx wrangler secret put AZURE_TRANSLATOR_KEY   # Azure 翻译 key

# 本地预览
npx wrangler dev

# 上线
npx wrangler deploy
```

## 项目结构

```
src/worker.js    路由 / 鉴权 / D1 CRUD
src/dict.js      词典聚合（翻译链 + 英英词典 + 缓存）
public/          前端（index.html / app.js / style.css / sw.js / 图标）
migrations/      D1 建表与结构迁移
wrangler.toml    Workers 配置
```
