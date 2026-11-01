-- biscuit 数据表
CREATE TABLE IF NOT EXISTS words (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT NOT NULL UNIQUE,
  translation TEXT DEFAULT '',
  phonetic    TEXT DEFAULT '',
  audio       TEXT DEFAULT '',
  definition  TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','known','star')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_words_status ON words(status, updated_at DESC);

-- 词典查询缓存，避免重复打第三方 API
CREATE TABLE IF NOT EXISTS dict_cache (
  word       TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
