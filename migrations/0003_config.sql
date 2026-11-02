-- 口令配置表：app_token_hash = 访问口令的 SHA-256（设置页修改口令时写入）
-- 未写入前回退到 wrangler secret APP_TOKEN（初始口令，后备入口）
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
