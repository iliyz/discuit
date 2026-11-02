-- 记忆模型：mem=记忆层级(0..3a，越大越熟)，red=标记量(以 1/3 为单位，右滑+3 左滑-1)，tail=移到尾部
ALTER TABLE words ADD COLUMN mem INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN red INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN tail INTEGER NOT NULL DEFAULT 0;

-- 旧状态迁移：star → 红标记 1 次；known → 记满（a=1 时 3a=3）
UPDATE words SET red = 3 WHERE status = 'star';
UPDATE words SET mem = 3 WHERE status = 'known';
