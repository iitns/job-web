CREATE TABLE IF NOT EXISTS job_web_resumes (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT NOT NULL,
    content_type TEXT,
    storage_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'uploaded',
    raw_text TEXT,
    extract_error TEXT,
    llm_model TEXT,
    normalization_method TEXT,
    normalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_web_resume_profiles (
    resume_id BIGINT PRIMARY KEY REFERENCES job_web_resumes(id) ON DELETE CASCADE,
    candidate_name TEXT,
    summary TEXT,
    years_of_experience NUMERIC(4,1),
    current_title TEXT,
    seniority TEXT,
    locations TEXT[] NOT NULL DEFAULT '{}',
    skills TEXT[] NOT NULL DEFAULT '{}',
    domains TEXT[] NOT NULL DEFAULT '{}',
    companies TEXT[] NOT NULL DEFAULT '{}',
    roles TEXT[] NOT NULL DEFAULT '{}',
    preferred_job_titles TEXT[] NOT NULL DEFAULT '{}',
    preferred_locations TEXT[] NOT NULL DEFAULT '{}',
    team_keywords TEXT[] NOT NULL DEFAULT '{}',
    responsibility_keywords TEXT[] NOT NULL DEFAULT '{}',
    qualification_keywords TEXT[] NOT NULL DEFAULT '{}',
    education JSONB NOT NULL DEFAULT '[]'::jsonb,
    certifications TEXT[] NOT NULL DEFAULT '{}',
    projects JSONB NOT NULL DEFAULT '[]'::jsonb,
    experience_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_web_resumes_created_at
    ON job_web_resumes(created_at DESC);
