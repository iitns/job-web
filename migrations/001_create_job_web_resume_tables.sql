DROP TABLE IF EXISTS job_web_resume_profiles;
DROP TABLE IF EXISTS job_web_resumes;

CREATE TABLE IF NOT EXISTS resumes (
    id                  BIGSERIAL PRIMARY KEY,
    label               TEXT NOT NULL DEFAULT 'default',
    minio_key           TEXT,
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

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS minio_key TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS raw_text TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS skills TEXT[];
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS content_embedding REAL[];
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
UPDATE resumes SET uploaded_at = NOW() WHERE uploaded_at IS NULL;
ALTER TABLE resumes ALTER COLUMN uploaded_at SET DEFAULT NOW();
ALTER TABLE resumes ALTER COLUMN uploaded_at SET NOT NULL;

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
