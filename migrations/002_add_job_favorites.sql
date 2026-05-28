CREATE TABLE IF NOT EXISTS job_favorites (
    job_id      TEXT PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE job_favorites ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
UPDATE job_favorites SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE job_favorites ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE job_favorites ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_favorites_created_at
    ON job_favorites(created_at DESC);
