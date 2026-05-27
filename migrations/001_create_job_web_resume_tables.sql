DROP TABLE IF EXISTS job_web_resume_profiles;
DROP TABLE IF EXISTS job_web_resumes;

CREATE TABLE IF NOT EXISTS resumes (
    id                  BIGSERIAL PRIMARY KEY,
    label               TEXT NOT NULL DEFAULT 'default',
    status              TEXT NOT NULL DEFAULT 'pending',
    minio_key           TEXT,
    minio_uploaded_at   TIMESTAMPTZ,
    dag_run_id          TEXT,
    dag_triggered_at    TIMESTAMPTZ,
    last_error          TEXT,
    status_updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_text            TEXT,
    skills              TEXT[],
    summary             TEXT,
    content_embedding   REAL[],
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS label TEXT;
UPDATE resumes SET label = 'default' WHERE label IS NULL;
ALTER TABLE resumes ALTER COLUMN label SET DEFAULT 'default';
ALTER TABLE resumes ALTER COLUMN label SET NOT NULL;

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
UPDATE resumes SET uploaded_at = NOW() WHERE uploaded_at IS NULL;
ALTER TABLE resumes ALTER COLUMN uploaded_at SET DEFAULT NOW();
ALTER TABLE resumes ALTER COLUMN uploaded_at SET NOT NULL;

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS status TEXT;
UPDATE resumes
SET status = CASE
    WHEN content_embedding IS NOT NULL THEN 'embedded'
    WHEN raw_text IS NOT NULL THEN 'extracted'
    WHEN minio_key IS NOT NULL THEN 'pending'
    ELSE 'pending'
END
WHERE status IS NULL;
ALTER TABLE resumes ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE resumes ALTER COLUMN status SET NOT NULL;

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS minio_key TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS minio_uploaded_at TIMESTAMPTZ;
UPDATE resumes
SET minio_uploaded_at = uploaded_at
WHERE minio_uploaded_at IS NULL
  AND minio_key IS NOT NULL;

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS dag_run_id TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS dag_triggered_at TIMESTAMPTZ;

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
UPDATE resumes
SET status_updated_at = uploaded_at
WHERE status_updated_at IS NULL;
ALTER TABLE resumes ALTER COLUMN status_updated_at SET DEFAULT NOW();
ALTER TABLE resumes ALTER COLUMN status_updated_at SET NOT NULL;

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS raw_text TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS skills TEXT[];
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS content_embedding REAL[];

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS is_active BOOLEAN;
UPDATE resumes SET is_active = TRUE WHERE is_active IS NULL;
ALTER TABLE resumes ALTER COLUMN is_active SET DEFAULT TRUE;
ALTER TABLE resumes ALTER COLUMN is_active SET NOT NULL;

CREATE TABLE IF NOT EXISTS resume_job_recommendations (
    resume_id   BIGINT NOT NULL,
    job_id      TEXT NOT NULL,
    score       REAL NOT NULL,
    ranked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (resume_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_resumes_uploaded_at
    ON resumes(uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_resume_job_recommendations_resume_id
    ON resume_job_recommendations(resume_id);
