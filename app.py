import io
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

import psycopg2
import psycopg2.extras
import requests
from flask import Flask, jsonify, request, send_from_directory
from minio import Minio
from minio.error import S3Error
from werkzeug.utils import secure_filename


logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
MIGRATIONS_DIR = BASE_DIR / "migrations"

app = Flask(__name__, static_folder=str(DIST_DIR), static_url_path="")

PG_CONFIG = {
    "host": os.environ.get("PG_HOST", "postgresql-service.storage.svc.cluster.local"),
    "port": int(os.environ.get("PG_PORT", "5432")),
    "dbname": os.environ.get("PG_DB", "job_recommender"),
    "user": os.environ.get("PG_USER", "postgres"),
    "password": os.environ.get("PG_PASSWORD", ""),
}

ES_HOST = os.environ.get("ES_HOST", "http://elasticsearch-service.default.svc.cluster.local:9200").rstrip("/")
ES_INDEX = os.environ.get("ES_INDEX", "job_recommender_jobs")
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", os.environ.get("COMMUNITY_MINIO_ENDPOINT", "minio.minio.svc.cluster.local:9000"))
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", os.environ.get("COMMUNITY_MINIO_ACCESS_KEY", ""))
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", os.environ.get("COMMUNITY_MINIO_SECRET_KEY", ""))
MINIO_SECURE = os.environ.get("MINIO_SECURE", os.environ.get("COMMUNITY_MINIO_SECURE", "false")).lower() == "true"
RESUME_BUCKET = os.environ.get("JOB_RECOMMENDER_RESUME_MINIO_BUCKET", "job-recommender-resumes")
AIRFLOW_API_BASE_URL = os.environ.get("AIRFLOW_API_BASE_URL", "").rstrip("/")
AIRFLOW_API_USERNAME = os.environ.get("AIRFLOW_API_USERNAME", "")
AIRFLOW_API_PASSWORD = os.environ.get("AIRFLOW_API_PASSWORD", "")
AIRFLOW_DAG_ID = os.environ.get("AIRFLOW_RESUME_DAG_ID", "job_recommender_resume")

DEFAULT_PAGE_SIZE = 12
MAX_PAGE_SIZE = 50
ALLOWED_RESUME_EXTENSIONS = {".docx"}
KNN_CANDIDATES = 200
KNN_NUM_CANDIDATES = 500

W_VECTOR = 0.35
W_BM25 = 0.25
W_SENIORITY = 0.15
W_LOCATION = 0.10
W_DOMAIN = 0.10
W_COMPANY = 0.05
NEUTRAL_SCORE = 0.5

LEVEL_ORDER = ["junior", "mid", "senior", "staff"]
JOB_LEVEL_KEYWORDS: list[tuple[list[str], str]] = [
    (["distinguished", "fellow", "principal", "staff"], "staff"),
    (["senior", "sr."], "senior"),
    (["junior", "jr.", "associate", "entry"], "junior"),
]

RESUME_STATUS_LABELS = {
    "pending": "트리거 대기",
    "extracting": "텍스트 추출 중",
    "extracted": "텍스트 추출 완료",
    "embedding": "임베딩 생성 중",
    "embedded": "임베딩 생성 완료",
    "scoring": "추천 점수 계산 중",
    "done": "추천 계산 완료",
    "failed": "처리 실패",
}

RUNTIME_STATE_READY = False
FAVORITES_CACHE_TTL_SECONDS = 300
FAVORITES_CACHE_RETRY_SECONDS = 60
FAVORITES_CACHE: dict[str, dict[str, Any]] = {}
FAVORITES_CACHE_LOADED_AT: datetime | None = None
FAVORITES_CACHE_FAILED_AT: datetime | None = None
FAVORITES_CACHE_LOCK = Lock()


def get_page_args() -> tuple[int, int]:
    page = max(1, int(request.args.get("page", "1")))
    page_size = min(MAX_PAGE_SIZE, max(1, int(request.args.get("page_size", str(DEFAULT_PAGE_SIZE)))))
    return page, page_size


def get_companies_arg() -> list[str]:
    raw = request.args.getlist("company")
    if not raw:
        csv_value = request.args.get("companies", "")
        raw = csv_value.split(",") if csv_value else []
    return [value.strip() for value in raw if value and value.strip()]


def get_skills_arg() -> list[str]:
    raw = request.args.getlist("skill")
    if not raw:
        csv_value = request.args.get("skills", "")
        raw = csv_value.split(",") if csv_value else []
    return [value.strip() for value in raw if value and value.strip()]


def db_connect():
    return psycopg2.connect(**PG_CONFIG)


def ensure_runtime_state(*, force: bool = False) -> None:
    global RUNTIME_STATE_READY
    if RUNTIME_STATE_READY and not force:
        return

    with db_connect() as conn:
        with conn.cursor() as cur:
            for migration_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                cur.execute(migration_path.read_text(encoding="utf-8"))
        conn.commit()
    RUNTIME_STATE_READY = True


def summarize_text(*parts: Any, limit: int = 220) -> str | None:
    text = " ".join(str(part or "").strip() for part in parts if str(part or "").strip())
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


def company_mark(company: str | None) -> str:
    words = [chunk for chunk in re.split(r"[^A-Za-z0-9]+", str(company or "").strip()) if chunk]
    if not words:
        return "?"
    if len(words) == 1:
        return words[0][:2].upper()
    return f"{words[0][0]}{words[1][0]}".upper()


def normalize_string_list(items: Any) -> list[str]:
    values: list[str] = []
    for item in items or []:
        value = str(item or "").strip()
        if value:
            values.append(value)
    return values


def parse_profile_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value

    if isinstance(value, str):
        try:
            payload = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}

    return {}


def build_resume_parsed_profile(row: dict[str, Any]) -> dict[str, Any]:
    parsed = parse_profile_payload(row.get("parsed_profile"))
    profile = dict(parsed)

    if not profile.get("skills"):
        profile["skills"] = normalize_string_list(row.get("skills"))
    if not profile.get("domains"):
        profile["domains"] = normalize_string_list(row.get("domains"))
    if not profile.get("summary") and row.get("summary"):
        profile["summary"] = row.get("summary")
    if not profile.get("raw_text") and row.get("raw_text"):
        profile["raw_text"] = row.get("raw_text")

    return profile


def build_bm25_query_text(parsed_profile: dict[str, Any], keyword: str = "") -> str:
    parts: list[str] = []
    if keyword:
        parts.append(keyword)

    skills = normalize_string_list(parsed_profile.get("skills"))
    if skills:
        parts.append(" ".join(skills))

    domains = normalize_string_list(parsed_profile.get("domains"))
    if domains:
        parts.append(" ".join(domains))

    experience_items = parsed_profile.get("experience") or parsed_profile.get("experience_items") or []
    for item in experience_items[:3]:
        if not isinstance(item, dict):
            continue

        title = str(item.get("title") or "").strip()
        description = str(item.get("description") or item.get("summary") or "").strip()
        if title:
            parts.append(title)
        if description:
            parts.append(description[:300])

    summary = str(parsed_profile.get("summary") or "").strip()
    if not parts and summary:
        parts.append(summary[:420])

    raw_text = str(parsed_profile.get("raw_text") or "").strip()
    if not parts and raw_text:
        parts.append(raw_text[:600])

    return " ".join(parts).strip()


def infer_resume_level(parsed_profile: dict[str, Any]) -> str | None:
    experience_items = parsed_profile.get("experience") or parsed_profile.get("experience_items") or []
    combined = " ".join(
        str(item.get("title") or "").lower()
        for item in experience_items
        if isinstance(item, dict)
    )

    for keywords, level in JOB_LEVEL_KEYWORDS:
        if any(keyword in combined for keyword in keywords):
            return level

    if experience_items:
        return "mid"

    return None


def normalize_job_level(level_guess: Any) -> str | None:
    if not level_guess:
        return None

    normalized = str(level_guess).lower()
    for keywords, level in JOB_LEVEL_KEYWORDS:
        if any(keyword in normalized for keyword in keywords):
            return level

    if "senior" in normalized:
        return "senior"

    return "mid"


def seniority_score(resume_level: str | None, job_level: str | None) -> float:
    if not resume_level or not job_level:
        return NEUTRAL_SCORE

    if resume_level not in LEVEL_ORDER or job_level not in LEVEL_ORDER:
        return NEUTRAL_SCORE

    diff = abs(LEVEL_ORDER.index(resume_level) - LEVEL_ORDER.index(job_level))
    return max(0.0, 1.0 - diff * 0.35)


def domain_score(resume_domains: list[str], job_domains: list[str]) -> float:
    if not resume_domains or not job_domains:
        return NEUTRAL_SCORE

    overlap = len(set(resume_domains) & set(job_domains))
    denominator = max(len(resume_domains), len(job_domains))
    return overlap / denominator if denominator else NEUTRAL_SCORE


def format_recommendation_score(value: Any) -> str | None:
    if value is None:
        return None

    try:
        score = float(value)
    except (TypeError, ValueError):
        return str(value)

    if -1.0 <= score <= 1.0:
        return str(int(round(score * 100)))
    return str(int(round(score)))


def serialize_datetime(value: Any) -> str | None:
    if not value:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def derive_resume_status(row: dict[str, Any]) -> str:
    status = str(row.get("status") or "").strip().lower()
    if status == "failed":
        return status
    if int(row.get("recommendation_count") or 0) > 0:
        return "done"
    if status in RESUME_STATUS_LABELS:
        return status
    if row.get("content_embedding") is not None:
        return "embedded"
    if str(row.get("raw_text") or "").strip():
        return "extracted"
    if row.get("minio_key"):
        return "pending"
    return "pending"


def resume_ready_for_recommendations(row: dict[str, Any] | None) -> bool:
    if not row:
        return False

    return derive_resume_status(row) == "done" or int(row.get("recommendation_count") or 0) > 0


def build_resume_message(row: dict[str, Any] | None) -> str | None:
    if not row:
        return None

    status = derive_resume_status(row)
    last_error = str(row.get("last_error") or "").strip()
    if status == "failed" and last_error:
        return last_error

    if resume_ready_for_recommendations(row):
        return None
    if not row.get("minio_key"):
        return "이력서를 먼저 업로드해 주세요."
    if last_error:
        return last_error

    messages = {
        "pending": "MinIO 저장은 완료되었습니다. Airflow DAG의 다음 처리를 기다리는 중입니다.",
        "extracting": "이력서 텍스트를 추출하는 중입니다.",
        "extracted": "텍스트 추출이 완료되었습니다. 임베딩 작업을 기다리는 중입니다.",
        "embedding": "이력서 임베딩을 생성하는 중입니다.",
        "embedded": "임베딩 생성이 완료되었습니다. 추천 점수 계산을 기다리는 중입니다.",
        "scoring": "공고 추천 점수를 계산하는 중입니다.",
        "failed": "이력서 처리에 실패했습니다.",
        "done": None,
    }
    return messages.get(status, "이력서 처리 상태를 확인하는 중입니다.")


def serialize_job(row: dict[str, Any]) -> dict[str, Any]:
    locations = normalize_string_list(row.get("locations"))
    summary = summarize_text(
        row.get("summary"),
        row.get("team_description"),
        row.get("responsibilities"),
        row.get("raw_description"),
    )
    favorited_at = serialize_datetime(row.get("favorited_at"))
    is_favorited = row.get("is_favorited")
    if is_favorited is None:
        is_favorited = favorited_at is not None

    return {
        "job_id": row.get("job_id"),
        "company": row.get("company"),
        "company_mark": company_mark(row.get("company")),
        "company_logo_url": row.get("company_logo_url") or row.get("logo_url"),
        "title": row.get("title"),
        "locations": locations,
        "primary_location": locations[0] if locations else None,
        "level_guess": row.get("level_guess"),
        "team": row.get("team"),
        "display_team": row.get("team") or row.get("level_guess"),
        "raw_description": row.get("raw_description"),
        "team_description": row.get("team_description"),
        "summary": summary,
        "responsibilities": row.get("responsibilities"),
        "minimum_qualifications": row.get("minimum_qualifications"),
        "preferred_qualifications": row.get("preferred_qualifications"),
        "skills": row.get("skills") or [],
        "domains": row.get("domains") or [],
        "matched_skills": row.get("matched_skills") or [],
        "matched_domains": row.get("matched_domains") or [],
        "recommendation_score": format_recommendation_score(row.get("recommendation_score")),
        "recommendation_reason": row.get("recommendation_reason"),
        "url": row.get("url"),
        "posted_at": serialize_datetime(row.get("posted_at")),
        "first_seen_at": serialize_datetime(row.get("first_seen_at")),
        "last_seen_at": serialize_datetime(row.get("last_seen_at")),
        "is_active": row.get("is_active", True),
        "detail_extracted_at": serialize_datetime(row.get("detail_extracted_at")),
        "is_favorited": bool(is_favorited),
        "favorited_at": favorited_at,
    }


def serialize_resume(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None

    status = derive_resume_status(row)
    skills = normalize_string_list(row.get("skills"))
    original_filename = row.get("original_filename") or row.get("label")
    minio_key = row.get("minio_key")
    return {
        "id": row.get("id"),
        "label": row.get("label"),
        "filename": original_filename,
        "original_filename": original_filename,
        "status": status,
        "status_label": RESUME_STATUS_LABELS.get(status, status),
        "minio_key": minio_key,
        "minio_object_name": Path(str(minio_key)).name if minio_key else None,
        "uploaded_at": serialize_datetime(row.get("uploaded_at")),
        "created_at": serialize_datetime(row.get("uploaded_at")),
        "minio_uploaded_at": serialize_datetime(row.get("minio_uploaded_at")),
        "dag_run_id": row.get("dag_run_id"),
        "dag_triggered_at": serialize_datetime(row.get("dag_triggered_at")),
        "status_updated_at": serialize_datetime(row.get("status_updated_at")),
        "last_error": row.get("last_error"),
        "is_active": bool(row.get("is_active", True)),
        "recommendation_ready": resume_ready_for_recommendations(row),
        "recommendation_count": int(row.get("recommendation_count") or 0),
        "last_ranked_at": serialize_datetime(row.get("latest_ranked_at")),
        "skills": skills,
        "domains": normalize_string_list(row.get("domains")),
        "has_raw_text": bool(str(row.get("raw_text") or "").strip()),
        "has_embedding": row.get("content_embedding") is not None,
    }


def serialize_resume_profile(row: dict[str, Any] | None, *, include_raw_text: bool = False) -> dict[str, Any] | None:
    if not row:
        return None

    parsed_profile = build_resume_parsed_profile(row)
    summary = summarize_text(parsed_profile.get("summary") or row.get("summary"), limit=420)
    skills = normalize_string_list(parsed_profile.get("skills") or row.get("skills"))
    raw_text = str(parsed_profile.get("raw_text") or row.get("raw_text") or "").strip()
    if not summary and not skills and not raw_text:
        return None

    profile = {
        "resume_id": row.get("id"),
        "candidate_name": None,
        "summary": summary,
        "skills": skills,
        "domains": normalize_string_list(parsed_profile.get("domains") or row.get("domains")),
        "locations": normalize_string_list(parsed_profile.get("locations") or parsed_profile.get("target_locations")),
        "experience_items": parsed_profile.get("experience_items") or parsed_profile.get("experience") or [],
        "projects": parsed_profile.get("projects") or [],
    }

    if include_raw_text:
        profile["raw_text"] = raw_text or None

    return profile


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def fetch_favorite_lookup(conn, *, job_ids: list[str] | None = None) -> dict[str, dict[str, Any]]:
    normalized_job_ids = [
        str(job_id or "").strip()
        for job_id in (job_ids or [])
        if str(job_id or "").strip()
    ]

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if job_ids is None:
            cur.execute(
                """
                SELECT job_id, created_at AS favorited_at
                FROM job_favorites
                """
            )
        else:
            if not normalized_job_ids:
                return {}

            cur.execute(
                """
                SELECT job_id, created_at AS favorited_at
                FROM job_favorites
                WHERE job_id = ANY(%s)
                """,
                (normalized_job_ids,),
            )
        rows = cur.fetchall()

    return {
        str(row["job_id"]): dict(row)
        for row in rows
        if row.get("job_id")
    }


def refresh_favorite_cache(*, force: bool = False, best_effort: bool = False) -> dict[str, dict[str, Any]]:
    global FAVORITES_CACHE
    global FAVORITES_CACHE_LOADED_AT
    global FAVORITES_CACHE_FAILED_AT

    now = utc_now()

    with FAVORITES_CACHE_LOCK:
        loaded_at = FAVORITES_CACHE_LOADED_AT
        failed_at = FAVORITES_CACHE_FAILED_AT
        cache_snapshot = dict(FAVORITES_CACHE)

    cache_is_fresh = (
        loaded_at is not None
        and (now - loaded_at).total_seconds() < FAVORITES_CACHE_TTL_SECONDS
    )
    retry_blocked = (
        failed_at is not None
        and (now - failed_at).total_seconds() < FAVORITES_CACHE_RETRY_SECONDS
    )

    if not force and cache_is_fresh:
        return cache_snapshot
    if not force and retry_blocked:
        return cache_snapshot

    try:
        with db_connect() as conn:
            favorite_lookup = fetch_favorite_lookup(conn)
    except Exception:
        if not best_effort:
            raise
        logger.warning("Failed to refresh favorites cache; using cached state", exc_info=True)
        with FAVORITES_CACHE_LOCK:
            FAVORITES_CACHE_FAILED_AT = now
            return dict(FAVORITES_CACHE)

    with FAVORITES_CACHE_LOCK:
        FAVORITES_CACHE = favorite_lookup
        FAVORITES_CACHE_LOADED_AT = now
        FAVORITES_CACHE_FAILED_AT = None
        return dict(FAVORITES_CACHE)


def cached_favorite_lookup(*, job_ids: list[str], best_effort: bool = False) -> dict[str, dict[str, Any]]:
    favorite_lookup = refresh_favorite_cache(best_effort=best_effort)
    return {
        job_id: favorite_lookup[job_id]
        for job_id in job_ids
        if job_id in favorite_lookup
    }


def set_cached_favorite(*, job_id: str, favorited_at: Any) -> None:
    global FAVORITES_CACHE_LOADED_AT
    global FAVORITES_CACHE_FAILED_AT

    favorite = {
        "job_id": job_id,
        "favorited_at": favorited_at,
    }

    with FAVORITES_CACHE_LOCK:
        FAVORITES_CACHE[job_id] = favorite
        FAVORITES_CACHE_LOADED_AT = utc_now()
        FAVORITES_CACHE_FAILED_AT = None


def delete_cached_favorite(*, job_id: str) -> None:
    global FAVORITES_CACHE_LOADED_AT
    global FAVORITES_CACHE_FAILED_AT

    with FAVORITES_CACHE_LOCK:
        FAVORITES_CACHE.pop(job_id, None)
        FAVORITES_CACHE_LOADED_AT = utc_now()
        FAVORITES_CACHE_FAILED_AT = None


def enrich_jobs_with_favorites(
    jobs: list[dict[str, Any]],
    *,
    conn=None,
    best_effort: bool = False,
    prefer_cache: bool = False,
) -> list[dict[str, Any]]:
    if not jobs:
        return jobs

    job_ids = [str(job.get("job_id") or "").strip() for job in jobs if job.get("job_id")]
    if not job_ids:
        for job in jobs:
            job["is_favorited"] = False
            job["favorited_at"] = None
        return jobs

    try:
        if prefer_cache:
            favorite_lookup = cached_favorite_lookup(
                job_ids=job_ids,
                best_effort=best_effort,
            )
        elif conn is None:
            with db_connect() as favorite_conn:
                favorite_lookup = fetch_favorite_lookup(favorite_conn, job_ids=job_ids)
        else:
            favorite_lookup = fetch_favorite_lookup(conn, job_ids=job_ids)
    except Exception:
        if not best_effort:
            raise
        logger.warning("Failed to enrich jobs with favorites; defaulting to unfavorited state", exc_info=True)
        favorite_lookup = {}

    for job in jobs:
        job_id = str(job.get("job_id") or "").strip()
        favorite = favorite_lookup.get(job_id)
        job["is_favorited"] = favorite is not None
        job["favorited_at"] = serialize_datetime(favorite.get("favorited_at")) if favorite else None

    return jobs


def fetch_filter_options_from_postgres(conn, *, allowed_job_ids: list[str] | None = None) -> tuple[list[str], list[str]]:
    filters = ["is_active = TRUE"]
    params: list[Any] = []

    if allowed_job_ids is not None:
        if allowed_job_ids:
            filters.append("job_id = ANY(%s)")
            params.append(allowed_job_ids)
        else:
            return [], []

    where_clause = " AND ".join(filters)

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT DISTINCT company
            FROM jobs
            WHERE {where_clause}
            ORDER BY company ASC
            """,
            params,
        )
        companies = [row[0] for row in cur.fetchall() if row[0]]

        cur.execute(
            f"""
            SELECT DISTINCT skill
            FROM (
                SELECT UNNEST(COALESCE(skills, ARRAY[]::TEXT[])) AS skill
                FROM jobs
                WHERE {where_clause}
            ) skill_values
            WHERE skill IS NOT NULL AND BTRIM(skill) <> ''
            ORDER BY skill ASC
            """,
            params,
        )
        skills = [row[0] for row in cur.fetchall() if row[0]]

    return companies, skills


def fetch_filter_options_from_elasticsearch(
    *,
    keyword: str = "",
    allowed_job_ids: list[str] | None = None,
) -> dict[str, Any]:
    filters: list[dict[str, Any]] = [{"term": {"is_active": True}}]

    if allowed_job_ids is not None:
        filters.append({"ids": {"values": allowed_job_ids or ["__job_web_empty__"]}})

    bool_query: dict[str, Any] = {"filter": filters}

    if keyword:
        bool_query["must"] = [
            {
                "multi_match": {
                    "query": keyword,
                    "fields": [
                        "title^4",
                        "company^3",
                        "team^2",
                        "locations^2",
                        "team_description",
                        "responsibilities",
                        "minimum_qualifications",
                        "preferred_qualifications",
                        "skills^2",
                        "domains",
                    ],
                    "type": "best_fields",
                }
            }
        ]

    query: dict[str, Any] = {
        "size": 0,
        "track_total_hits": False,
        "query": {"bool": bool_query},
        "aggs": {
            "companies": {
                "terms": {
                    "field": "company",
                    "size": 2000,
                    "order": {"_key": "asc"},
                }
            },
            "skills": {
                "terms": {
                    "field": "skills",
                    "size": 4000,
                    "order": {"_key": "asc"},
                }
            },
        },
    }

    response = requests.post(
        f"{ES_HOST}/{ES_INDEX}/_search",
        json=query,
        timeout=10,
    )

    if response.status_code == 404:
        logger.warning("Elasticsearch index %s not found while loading filters", ES_INDEX)
        with db_connect() as conn:
            companies, skills = fetch_filter_options_from_postgres(conn, allowed_job_ids=allowed_job_ids)
        return {
            "companies": companies,
            "skills": skills,
            "search_ready": False,
        }

    response.raise_for_status()
    payload = response.json()
    aggregations = payload.get("aggregations", {})

    companies = [
        bucket.get("key")
        for bucket in aggregations.get("companies", {}).get("buckets", [])
        if bucket.get("key")
    ]
    skills = [
        bucket.get("key")
        for bucket in aggregations.get("skills", {}).get("buckets", [])
        if bucket.get("key")
    ]

    return {
        "companies": companies,
        "skills": skills,
        "search_ready": True,
    }


def fetch_jobs_from_postgres(*, page: int, page_size: int, companies: list[str], skills: list[str]) -> dict[str, Any]:
    filters = ["is_active = TRUE"]
    params: list[Any] = []

    if companies:
        filters.append("company = ANY(%s)")
        params.append(companies)
    if skills:
        filters.append("COALESCE(skills, ARRAY[]::TEXT[]) && %s::TEXT[]")
        params.append(skills)

    where_clause = " AND ".join(filters)
    offset = (page - 1) * page_size

    with db_connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM jobs WHERE {where_clause}", params)
            total = cur.fetchone()["total"]

            cur.execute(
                f"""
                SELECT
                    job_id,
                    company,
                    title,
                    locations,
                    level_guess,
                    team,
                    raw_description,
                    team_description,
                    responsibilities,
                    minimum_qualifications,
                    preferred_qualifications,
                    skills,
                    domains,
                    url,
                    posted_at,
                    first_seen_at,
                    last_seen_at,
                    is_active,
                    detail_extracted_at
                FROM jobs
                WHERE {where_clause}
                ORDER BY posted_at DESC NULLS LAST, last_seen_at DESC, job_id ASC
                OFFSET %s
                LIMIT %s
                """,
                [*params, offset, page_size],
            )
            jobs = [serialize_job(dict(row)) for row in cur.fetchall()]
            jobs = enrich_jobs_with_favorites(jobs, conn=conn)

    filter_options = fetch_filter_options_from_elasticsearch()

    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "companies": filter_options["companies"],
        "skills": filter_options["skills"],
        "source": "postgres",
        "search_ready": True,
    }


def search_jobs_in_elasticsearch(*, keyword: str, page: int, page_size: int, companies: list[str], skills: list[str]) -> dict[str, Any]:
    from_offset = (page - 1) * page_size
    query: dict[str, Any] = {
        "from": from_offset,
        "size": page_size,
        "track_total_hits": True,
        "_source": [
            "job_id",
            "company",
            "title",
            "locations",
            "level_guess",
            "team",
            "raw_description",
            "team_description",
            "responsibilities",
            "minimum_qualifications",
            "preferred_qualifications",
            "skills",
            "domains",
            "url",
            "posted_at",
            "first_seen_at",
            "last_seen_at",
            "is_active",
            "detail_extracted_at",
        ],
        "query": {
            "bool": {
                "must": [
                    {
                        "multi_match": {
                            "query": keyword,
                            "fields": [
                                "title^4",
                                "company^3",
                                "team^2",
                                "locations^2",
                                "team_description",
                                "responsibilities",
                                "minimum_qualifications",
                                "preferred_qualifications",
                                "skills^2",
                                "domains",
                            ],
                            "type": "best_fields",
                            "operator": "and",
                        }
                    }
                ],
                "filter": [{"term": {"is_active": True}}],
            }
        },
        "sort": [
            "_score",
            {"posted_at": {"order": "desc", "missing": "_last"}},
            {"last_seen_at": {"order": "desc", "missing": "_last"}},
        ],
    }

    if companies:
        query["query"]["bool"]["filter"].append({"terms": {"company": companies}})
    if skills:
        query["query"]["bool"]["filter"].append({"terms": {"skills": skills}})

    response = requests.post(
        f"{ES_HOST}/{ES_INDEX}/_search",
        json=query,
        timeout=10,
    )

    if response.status_code == 404:
        logger.warning("Elasticsearch index %s not found", ES_INDEX)
        filter_options = fetch_filter_options_from_elasticsearch(keyword=keyword)
        return {
            "jobs": [],
            "total": 0,
            "page": page,
            "page_size": page_size,
            "companies": filter_options["companies"],
            "skills": filter_options["skills"],
            "source": "elasticsearch",
            "search_ready": False,
        }

    response.raise_for_status()
    payload = response.json()
    hits = payload.get("hits", {})
    total = hits.get("total", {}).get("value", 0)
    jobs = [serialize_job(hit.get("_source", {})) for hit in hits.get("hits", [])]
    jobs = enrich_jobs_with_favorites(jobs, best_effort=True, prefer_cache=True)

    filter_options = fetch_filter_options_from_elasticsearch(keyword=keyword)

    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "companies": filter_options["companies"],
        "skills": filter_options["skills"],
        "source": "elasticsearch",
        "search_ready": filter_options["search_ready"],
    }


def fetch_resume_record(*, resume_id: int | None = None, latest: bool = False) -> dict[str, Any] | None:
    clause = "r.id = %s"
    params: list[Any] = [resume_id]
    if latest:
        clause = "r.is_active = TRUE"
        params = []

    with db_connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT
                    r.id,
                    r.label,
                    r.original_filename,
                    r.status,
                    r.minio_key,
                    r.minio_uploaded_at,
                    r.dag_run_id,
                    r.dag_triggered_at,
                    r.last_error,
                    r.status_updated_at,
                    r.raw_text,
                    r.skills,
                    r.domains,
                    r.summary,
                    r.parsed_profile,
                    r.content_embedding,
                    r.uploaded_at,
                    r.is_active,
                    COALESCE(stats.recommendation_count, 0) AS recommendation_count,
                    stats.latest_ranked_at
                FROM resumes r
                LEFT JOIN (
                    SELECT
                        resume_id,
                        COUNT(*) AS recommendation_count,
                        MAX(ranked_at) AS latest_ranked_at
                    FROM resume_job_recommendations
                    GROUP BY resume_id
                ) stats ON stats.resume_id = r.id
                WHERE {clause}
                ORDER BY r.uploaded_at DESC, r.id DESC
                LIMIT 1
                """,
                params,
            )
            row = cur.fetchone()

    return dict(row) if row else None


def fetch_resume_and_profile(*, resume_id: int | None = None, latest: bool = False) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    resume = fetch_resume_record(resume_id=resume_id, latest=latest)
    profile = resume if resume else None
    return resume, profile


def fetch_resume_records() -> list[dict[str, Any]]:
    with db_connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    r.id,
                    r.label,
                    r.original_filename,
                    r.status,
                    r.minio_key,
                    r.minio_uploaded_at,
                    r.dag_run_id,
                    r.dag_triggered_at,
                    r.last_error,
                    r.status_updated_at,
                    r.raw_text,
                    r.skills,
                    r.domains,
                    r.summary,
                    r.parsed_profile,
                    r.content_embedding,
                    r.uploaded_at,
                    r.is_active,
                    COALESCE(stats.recommendation_count, 0) AS recommendation_count,
                    stats.latest_ranked_at
                FROM resumes r
                LEFT JOIN (
                    SELECT
                        resume_id,
                        COUNT(*) AS recommendation_count,
                        MAX(ranked_at) AS latest_ranked_at
                    FROM resume_job_recommendations
                    GROUP BY resume_id
                ) stats ON stats.resume_id = r.id
                ORDER BY r.uploaded_at DESC, r.id DESC
                """
            )
            rows = cur.fetchall()

    items = [serialize_resume(dict(row)) for row in rows]
    recommendation_source_id = next((item["id"] for item in items if item and item.get("is_active")), None)
    for item in items:
        if item:
            item["is_recommendation_source"] = item.get("id") == recommendation_source_id
    return [item for item in items if item]


def fetch_recommendation_job_ids(conn, *, resume_id: int) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.job_id
            FROM resume_job_recommendations r
            JOIN jobs j USING (job_id)
            WHERE r.resume_id = %s
              AND j.is_active = TRUE
            ORDER BY r.score DESC, j.posted_at DESC NULLS LAST, j.last_seen_at DESC, j.job_id ASC
            """,
            (resume_id,),
        )
        return [row[0] for row in cur.fetchall() if row[0]]


def fetch_favorite_filter_options_from_postgres(conn) -> tuple[list[str], list[str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT j.company
            FROM job_favorites f
            JOIN jobs j USING (job_id)
            WHERE j.company IS NOT NULL AND BTRIM(j.company) <> ''
            ORDER BY j.company ASC
            """
        )
        companies = [row[0] for row in cur.fetchall() if row[0]]

        cur.execute(
            """
            SELECT DISTINCT skill
            FROM (
                SELECT UNNEST(COALESCE(j.skills, ARRAY[]::TEXT[])) AS skill
                FROM job_favorites f
                JOIN jobs j USING (job_id)
            ) skill_values
            WHERE skill IS NOT NULL AND BTRIM(skill) <> ''
            ORDER BY skill ASC
            """
        )
        skills = [row[0] for row in cur.fetchall() if row[0]]

    return companies, skills


def fetch_favorite_jobs_from_postgres(
    *,
    page: int,
    page_size: int,
    companies: list[str],
    skills: list[str],
    keyword: str,
) -> dict[str, Any]:
    filters = ["TRUE"]
    params: list[Any] = []

    if companies:
        filters.append("j.company = ANY(%s)")
        params.append(companies)
    if skills:
        filters.append("COALESCE(j.skills, ARRAY[]::TEXT[]) && %s::TEXT[]")
        params.append(skills)
    if keyword:
        like_keyword = f"%{keyword}%"
        filters.append(
            """
            (
                j.company ILIKE %s
                OR j.title ILIKE %s
                OR COALESCE(j.team, '') ILIKE %s
                OR COALESCE(j.level_guess, '') ILIKE %s
                OR COALESCE(j.team_description, '') ILIKE %s
                OR COALESCE(j.responsibilities, '') ILIKE %s
                OR COALESCE(j.minimum_qualifications, '') ILIKE %s
                OR COALESCE(j.preferred_qualifications, '') ILIKE %s
                OR COALESCE(array_to_string(j.skills, ' '), '') ILIKE %s
                OR COALESCE(array_to_string(j.domains, ' '), '') ILIKE %s
            )
            """
        )
        params.extend([like_keyword] * 10)

    where_clause = " AND ".join(filters)
    offset = (page - 1) * page_size

    with db_connect() as conn:
        favorite_companies, favorite_skills = fetch_favorite_filter_options_from_postgres(conn)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM job_favorites f
                JOIN jobs j USING (job_id)
                WHERE {where_clause}
                """,
                params,
            )
            total = cur.fetchone()["total"]

            cur.execute(
                f"""
                SELECT
                    j.job_id,
                    j.company,
                    j.title,
                    j.locations,
                    j.level_guess,
                    j.team,
                    j.raw_description,
                    j.team_description,
                    j.responsibilities,
                    j.minimum_qualifications,
                    j.preferred_qualifications,
                    j.skills,
                    j.domains,
                    j.url,
                    j.posted_at,
                    j.first_seen_at,
                    j.last_seen_at,
                    j.is_active,
                    j.detail_extracted_at,
                    j.summary,
                    TRUE AS is_favorited,
                    f.created_at AS favorited_at
                FROM job_favorites f
                JOIN jobs j USING (job_id)
                WHERE {where_clause}
                ORDER BY f.created_at DESC, j.posted_at DESC NULLS LAST, j.last_seen_at DESC, j.job_id ASC
                OFFSET %s
                LIMIT %s
                """,
                [*params, offset, page_size],
            )
            jobs = [serialize_job(dict(row)) for row in cur.fetchall()]

    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "companies": favorite_companies,
        "skills": favorite_skills,
        "source": "favorites",
        "search_ready": True,
    }


def job_exists(conn, *, job_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM jobs WHERE job_id = %s", (job_id,))
        return cur.fetchone() is not None


def fetch_job_favorite(conn, *, job_id: str) -> dict[str, Any] | None:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT job_id, created_at AS favorited_at
            FROM job_favorites
            WHERE job_id = %s
            """,
            (job_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def create_job_favorite(*, job_id: str) -> dict[str, Any] | None:
    with db_connect() as conn:
        if not job_exists(conn, job_id=job_id):
            return None

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO job_favorites (job_id)
                VALUES (%s)
                ON CONFLICT (job_id) DO NOTHING
                """,
                (job_id,),
            )
        favorite = fetch_job_favorite(conn, job_id=job_id)
        conn.commit()

    if favorite:
        set_cached_favorite(job_id=job_id, favorited_at=favorite.get("favorited_at"))

    return favorite


def delete_job_favorite(*, job_id: str) -> bool | None:
    with db_connect() as conn:
        exists = job_exists(conn, job_id=job_id)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM job_favorites WHERE job_id = %s", (job_id,))
            deleted = cur.rowcount > 0
        conn.commit()

    if not exists and not deleted:
        return None

    if deleted:
        delete_cached_favorite(job_id=job_id)

    return deleted


def knn_search_recommendation_candidates(*, resume_embedding: list[float]) -> tuple[list[dict[str, Any]], bool]:
    response = requests.post(
        f"{ES_HOST}/{ES_INDEX}/_search",
        json={
            "knn": {
                "field": "content_embedding",
                "query_vector": resume_embedding,
                "k": KNN_CANDIDATES,
                "num_candidates": KNN_NUM_CANDIDATES,
                "filter": [{"term": {"is_active": True}}],
            },
            "_source": [
                "job_id",
                "company",
                "title",
                "locations",
                "level_guess",
                "team",
                "raw_description",
                "team_description",
                "responsibilities",
                "minimum_qualifications",
                "preferred_qualifications",
                "skills",
                "domains",
                "url",
                "posted_at",
                "first_seen_at",
                "last_seen_at",
                "is_active",
                "detail_extracted_at",
            ],
            "size": KNN_CANDIDATES,
        },
        timeout=10,
    )

    if response.status_code == 404:
        logger.warning("Elasticsearch index %s not found for recommendation search", ES_INDEX)
        return [], False

    response.raise_for_status()
    hits = response.json().get("hits", {}).get("hits", [])

    candidates: list[dict[str, Any]] = []
    for hit in hits:
        source = hit.get("_source", {})
        candidates.append(
            {
                **source,
                "job_id": source.get("job_id") or hit.get("_id"),
                "_vector_score": float(hit.get("_score") or 0.0),
            }
        )

    return candidates, True


def bm25_search_recommendation_scores(*, query_text: str, job_ids: list[str]) -> dict[str, float]:
    if not query_text.strip() or not job_ids:
        return {}

    response = requests.post(
        f"{ES_HOST}/{ES_INDEX}/_search",
        json={
            "query": {
                "bool": {
                    "must": {
                        "multi_match": {
                            "query": query_text,
                            "fields": [
                                "skills^3",
                                "title^2",
                                "responsibilities^2",
                                "minimum_qualifications^2",
                                "preferred_qualifications^1.5",
                                "team_description",
                            ],
                        }
                    },
                    "filter": [{"ids": {"values": job_ids}}],
                }
            },
            "_source": False,
            "size": len(job_ids),
        },
        timeout=10,
    )

    if response.status_code == 404:
        logger.warning("Elasticsearch index %s not found for recommendation BM25 search", ES_INDEX)
        return {}

    response.raise_for_status()
    hits = response.json().get("hits", {}).get("hits", [])
    if not hits:
        return {}

    max_score = hits[0].get("_score") or 1.0
    return {
        str(hit.get("_id")): float(hit.get("_score") or 0.0) / max_score
        for hit in hits
        if hit.get("_id")
    }


def score_recommendation_candidates(
    *,
    candidates: list[dict[str, Any]],
    bm25_scores: dict[str, float],
    parsed_profile: dict[str, Any],
) -> list[dict[str, Any]]:
    resume_level = infer_resume_level(parsed_profile)
    resume_domains = normalize_string_list(parsed_profile.get("domains"))
    resume_skills = {skill.casefold(): skill for skill in normalize_string_list(parsed_profile.get("skills"))}

    scored_jobs: list[dict[str, Any]] = []
    for candidate in candidates:
        job_id = str(candidate.get("job_id") or "").strip()
        if not job_id:
            continue

        vector_score = float(candidate.get("_vector_score") or 0.0)
        bm25_score = float(bm25_scores.get(job_id, 0.0))
        job_level = normalize_job_level(candidate.get("level_guess"))
        current_job_domains = normalize_string_list(candidate.get("domains"))
        seniority = seniority_score(resume_level, job_level)
        domain = domain_score(resume_domains, current_job_domains)

        current_job_skills = normalize_string_list(candidate.get("skills"))
        matched_skills = [
            skill for skill in current_job_skills if skill.casefold() in resume_skills
        ]
        matched_domains = [
            domain_name
            for domain_name in current_job_domains
            if domain_name in resume_domains
        ]

        score = (
            W_VECTOR * vector_score
            + W_BM25 * bm25_score
            + W_SENIORITY * seniority
            + W_LOCATION * NEUTRAL_SCORE
            + W_DOMAIN * domain
            + W_COMPANY * NEUTRAL_SCORE
        )

        scored_jobs.append(
            {
                **candidate,
                "job_id": job_id,
                "matched_skills": matched_skills,
                "matched_domains": matched_domains,
                "recommendation_score": score,
            }
        )

    scored_jobs.sort(
        key=lambda item: (
            float(item.get("recommendation_score") or 0.0),
            item.get("posted_at") or "",
            item.get("last_seen_at") or "",
            item.get("job_id") or "",
        ),
        reverse=True,
    )
    return scored_jobs


def recommend_jobs_from_resume(*, page: int, page_size: int, companies: list[str], skills: list[str], keyword: str) -> dict[str, Any]:
    offset = (page - 1) * page_size

    with db_connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    r.id,
                    r.label,
                    r.original_filename,
                    r.status,
                    r.minio_key,
                    r.minio_uploaded_at,
                    r.dag_run_id,
                    r.dag_triggered_at,
                    r.last_error,
                    r.status_updated_at,
                    r.raw_text,
                    r.skills,
                    r.domains,
                    r.summary,
                    r.parsed_profile,
                    r.content_embedding,
                    r.uploaded_at,
                    r.is_active,
                    COALESCE(stats.recommendation_count, 0) AS recommendation_count,
                    stats.latest_ranked_at
                FROM resumes r
                LEFT JOIN (
                    SELECT
                        resume_id,
                        COUNT(*) AS recommendation_count,
                        MAX(ranked_at) AS latest_ranked_at
                    FROM resume_job_recommendations
                    GROUP BY resume_id
                ) stats ON stats.resume_id = r.id
                WHERE r.is_active = TRUE
                ORDER BY r.uploaded_at DESC, r.id DESC
                LIMIT 1
                """
            )
            resume = cur.fetchone()

            if not resume:
                filter_options = fetch_filter_options_from_elasticsearch()
                return {
                    "jobs": [],
                    "total": 0,
                    "page": page,
                    "page_size": page_size,
                    "companies": filter_options["companies"],
                    "skills": filter_options["skills"],
                    "source": "recommendation",
                    "resume": None,
                    "profile": None,
                    "recommendation_ready": False,
                    "message": "활성 이력서가 없습니다. 이력서 관리에서 이력서를 업로드하거나 활성화해 주세요.",
                    "search_ready": filter_options["search_ready"],
                }

            resume_dict = dict(resume)
            if not resume_ready_for_recommendations(resume_dict):
                filter_options = fetch_filter_options_from_elasticsearch()
                return {
                    "jobs": [],
                    "total": 0,
                    "page": page,
                    "page_size": page_size,
                    "companies": filter_options["companies"],
                    "skills": filter_options["skills"],
                    "source": "recommendation",
                    "resume": serialize_resume(resume_dict),
                    "profile": serialize_resume_profile(resume_dict),
                    "recommendation_ready": False,
                    "message": build_resume_message(resume_dict),
                    "search_ready": filter_options["search_ready"],
                }

            if keyword:
                parsed_profile = build_resume_parsed_profile(resume_dict)
                candidates, search_ready = knn_search_recommendation_candidates(
                    resume_embedding=resume_dict["content_embedding"]
                )
                job_ids = [str(item.get("job_id")) for item in candidates if item.get("job_id")]
                bm25_scores = bm25_search_recommendation_scores(
                    query_text=build_bm25_query_text(parsed_profile, keyword),
                    job_ids=job_ids,
                )
                ranked_jobs = score_recommendation_candidates(
                    candidates=candidates,
                    bm25_scores=bm25_scores,
                    parsed_profile=parsed_profile,
                )

                companies_all = sorted(
                    {job.get("company") for job in ranked_jobs if job.get("company")},
                    key=lambda value: str(value).casefold(),
                )
                skills_all = sorted(
                    {
                        skill
                        for job in ranked_jobs
                        for skill in normalize_string_list(job.get("skills"))
                    },
                    key=lambda value: str(value).casefold(),
                )

                filtered_jobs = ranked_jobs
                if companies:
                    filtered_jobs = [
                        job for job in filtered_jobs if job.get("company") in companies
                    ]
                if skills:
                    filtered_jobs = [
                        job
                        for job in filtered_jobs
                        if set(normalize_string_list(job.get("skills"))) & set(skills)
                    ]

                total = len(filtered_jobs)
                jobs = [
                    serialize_job(job)
                    for job in filtered_jobs[offset : offset + page_size]
                ]
                jobs = enrich_jobs_with_favorites(jobs, conn=conn)

                return {
                    "jobs": jobs,
                    "total": total,
                    "page": page,
                    "page_size": page_size,
                    "companies": companies_all,
                    "skills": skills_all,
                    "source": "recommendation-hybrid",
                    "resume": serialize_resume(resume_dict),
                    "profile": serialize_resume_profile(resume_dict),
                    "recommendation_ready": True,
                    "message": None,
                    "search_ready": search_ready,
                }

            recommendation_job_ids = fetch_recommendation_job_ids(
                conn,
                resume_id=resume_dict["id"],
            )
            filter_options = fetch_filter_options_from_elasticsearch(
                allowed_job_ids=recommendation_job_ids,
            )

            filters = ["r.resume_id = %s", "j.is_active = TRUE"]
            params: list[Any] = [resume_dict["id"]]
            if companies:
                filters.append("j.company = ANY(%s)")
                params.append(companies)
            if skills:
                filters.append("COALESCE(j.skills, ARRAY[]::TEXT[]) && %s::TEXT[]")
                params.append(skills)

            where_clause = " AND ".join(filters)

            cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM resume_job_recommendations r
                JOIN jobs j USING (job_id)
                WHERE {where_clause}
                """,
                params,
            )
            total = cur.fetchone()["total"]

            cur.execute(
                f"""
                SELECT
                    j.job_id,
                    j.company,
                    j.title,
                    j.locations,
                    j.level_guess,
                    j.team,
                    j.raw_description,
                    j.team_description,
                    j.responsibilities,
                    j.minimum_qualifications,
                    j.preferred_qualifications,
                    j.skills,
                    j.domains,
                    j.url,
                    j.posted_at,
                    j.first_seen_at,
                    j.last_seen_at,
                    j.is_active,
                    j.detail_extracted_at,
                    j.summary,
                    r.score AS recommendation_score
                FROM resume_job_recommendations r
                JOIN jobs j USING (job_id)
                WHERE {where_clause}
                ORDER BY r.score DESC, j.posted_at DESC NULLS LAST, j.last_seen_at DESC, j.job_id ASC
                OFFSET %s
                LIMIT %s
                """,
                [*params, offset, page_size],
            )
            jobs = [serialize_job(dict(row)) for row in cur.fetchall()]
            jobs = enrich_jobs_with_favorites(jobs, conn=conn)

    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "companies": filter_options["companies"],
        "skills": filter_options["skills"],
        "source": "recommendation",
        "resume": serialize_resume(resume_dict),
        "profile": serialize_resume_profile(resume_dict),
        "recommendation_ready": True,
        "message": None,
        "search_ready": filter_options["search_ready"],
    }


def allowed_resume_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_RESUME_EXTENSIONS


def get_minio_client() -> Minio:
    if not MINIO_ACCESS_KEY or not MINIO_SECRET_KEY:
        raise RuntimeError("MinIO credentials are not configured.")

    return Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=MINIO_SECURE,
    )


def ensure_resume_bucket(client: Minio) -> None:
    if not client.bucket_exists(RESUME_BUCKET):
        client.make_bucket(RESUME_BUCKET)


def resume_object_key(resume_id: int, filename: str) -> str:
    safe_name = secure_filename(filename or "resume.docx") or "resume.docx"
    safe_path = Path(safe_name)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    stem = safe_path.stem or "resume"
    suffix = safe_path.suffix.lower() or ".docx"
    object_name = f"{timestamp}-{stem}{suffix}"
    return f"resumes/{resume_id}/{object_name}"


def upload_resume_object(*, resume_id: int, filename: str, data: bytes) -> str:
    object_key = resume_object_key(resume_id, filename)
    client = get_minio_client()
    ensure_resume_bucket(client)
    client.put_object(
        RESUME_BUCKET,
        object_key,
        io.BytesIO(data),
        len(data),
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    return object_key


def delete_resume_object(object_key: str | None) -> None:
    if not object_key:
        return

    client = get_minio_client()
    try:
        client.remove_object(RESUME_BUCKET, object_key)
    except S3Error as exc:
        if exc.code != "NoSuchKey":
            raise


def create_resume_record(*, label: str, original_filename: str) -> int:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO resumes (label, original_filename, status)
                VALUES (%s, %s, 'pending')
                RETURNING id
                """,
                (label, original_filename),
            )
            resume_id = cur.fetchone()[0]
        conn.commit()
    return int(resume_id)


def update_resume_minio_key(*, resume_id: int, minio_key: str) -> None:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE resumes
                SET
                    minio_key = %s,
                    minio_uploaded_at = NOW(),
                    last_error = NULL
                WHERE id = %s
                """,
                (minio_key, resume_id),
            )
        conn.commit()


def update_resume_dag_trigger(*, resume_id: int, dag_run_id: str | None) -> None:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE resumes
                SET
                    dag_run_id = %s,
                    dag_triggered_at = NOW(),
                    last_error = NULL
                WHERE id = %s
                """,
                (dag_run_id, resume_id),
            )
        conn.commit()


def update_resume_error(*, resume_id: int, message: str) -> None:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE resumes
                SET last_error = %s
                WHERE id = %s
                """,
                (message, resume_id),
            )
        conn.commit()


def update_resume_active_flag(*, resume_id: int, is_active: bool) -> None:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE resumes
                SET is_active = %s
                WHERE id = %s
                """,
                (is_active, resume_id),
            )
        conn.commit()


def delete_resume_record(*, resume_id: int) -> None:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM resume_job_recommendations WHERE resume_id = %s", (resume_id,))
            cur.execute("DELETE FROM resumes WHERE id = %s", (resume_id,))
        conn.commit()


def trigger_resume_dag(resume_id: int) -> dict[str, Any]:
    if not AIRFLOW_API_BASE_URL:
        raise RuntimeError("AIRFLOW_API_BASE_URL is not configured.")

    dag_run_id = f"job-web-resume-{resume_id}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}"
    headers = {}

    if AIRFLOW_API_USERNAME:
        token_response = requests.post(
            f"{AIRFLOW_API_BASE_URL}/auth/token",
            json={
                "username": AIRFLOW_API_USERNAME,
                "password": AIRFLOW_API_PASSWORD,
            },
            timeout=15,
        )
        if token_response.status_code >= 400:
            raise RuntimeError(
                f"Airflow token request failed with status {token_response.status_code}: {token_response.text[:240]}"
            )

        token_payload = token_response.json()
        access_token = token_payload.get("access_token")
        if not access_token:
            raise RuntimeError("Airflow token response did not contain access_token.")

        headers["Authorization"] = f"Bearer {access_token}"

    response = requests.post(
        f"{AIRFLOW_API_BASE_URL}/api/v2/dags/{AIRFLOW_DAG_ID}/dagRuns",
        json={
            "dag_run_id": dag_run_id,
            "logical_date": datetime.now(timezone.utc).isoformat(),
            "conf": {
                "resume_id": resume_id,
            },
        },
        headers=headers,
        timeout=15,
    )

    if response.status_code >= 400:
        raise RuntimeError(
            f"Airflow trigger failed with status {response.status_code}: {response.text[:240]}"
        )

    payload = response.json()
    return {
        "dag_run_id": payload.get("dag_run_id", dag_run_id),
        "state": payload.get("state"),
    }


@app.get("/healthz")
def healthz():
    try:
        ensure_runtime_state()
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("Health check failed")
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.get("/api/jobs")
def list_jobs():
    ensure_runtime_state()
    page, page_size = get_page_args()
    companies = get_companies_arg()
    skills = get_skills_arg()

    try:
        return jsonify(fetch_jobs_from_postgres(page=page, page_size=page_size, companies=companies, skills=skills))
    except Exception as exc:
        logger.exception("Failed to load jobs from PostgreSQL")
        return jsonify({"error": "failed_to_load_jobs", "message": str(exc)}), 500


@app.get("/api/jobs/search")
def search_jobs():
    ensure_runtime_state()
    keyword = request.args.get("q", "").strip()
    page, page_size = get_page_args()
    companies = get_companies_arg()
    skills = get_skills_arg()

    if not keyword:
        return jsonify(fetch_jobs_from_postgres(page=page, page_size=page_size, companies=companies, skills=skills))

    try:
        return jsonify(
            search_jobs_in_elasticsearch(
                keyword=keyword,
                page=page,
                page_size=page_size,
                companies=companies,
                skills=skills,
            )
        )
    except Exception as exc:
        logger.exception("Failed to search jobs in Elasticsearch")
        return jsonify({"error": "failed_to_search_jobs", "message": str(exc)}), 500


@app.get("/api/jobs/recommendations")
def recommend_jobs():
    ensure_runtime_state()
    page, page_size = get_page_args()
    companies = get_companies_arg()
    skills = get_skills_arg()
    keyword = request.args.get("q", "").strip()

    try:
        return jsonify(
            recommend_jobs_from_resume(
                page=page,
                page_size=page_size,
                companies=companies,
                skills=skills,
                keyword=keyword,
            )
        )
    except Exception as exc:
        logger.exception("Failed to load recommendation jobs")
        return jsonify({"error": "failed_to_recommend_jobs", "message": str(exc)}), 500


@app.get("/api/jobs/favorites")
def list_favorite_jobs():
    ensure_runtime_state()
    page, page_size = get_page_args()
    companies = get_companies_arg()
    skills = get_skills_arg()
    keyword = request.args.get("q", "").strip()

    try:
        return jsonify(
            fetch_favorite_jobs_from_postgres(
                page=page,
                page_size=page_size,
                companies=companies,
                skills=skills,
                keyword=keyword,
            )
        )
    except Exception as exc:
        logger.exception("Failed to load favorite jobs")
        return jsonify({"error": "failed_to_load_favorite_jobs", "message": str(exc)}), 500


@app.get("/api/jobs/<job_id>")
def job_detail(job_id: str):
    ensure_runtime_state()
    try:
        with db_connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT
                        j.job_id,
                        j.company,
                        j.title,
                        j.locations,
                        j.level_guess,
                        j.team,
                        j.raw_description,
                        j.team_description,
                        j.responsibilities,
                        j.minimum_qualifications,
                        j.preferred_qualifications,
                        j.skills,
                        j.domains,
                        j.url,
                        j.posted_at,
                        j.first_seen_at,
                        j.last_seen_at,
                        j.is_active,
                        j.detail_extracted_at,
                        (f.job_id IS NOT NULL) AS is_favorited,
                        f.created_at AS favorited_at
                    FROM jobs j
                    LEFT JOIN job_favorites f
                        ON f.job_id = j.job_id
                    WHERE j.job_id = %s
                    """,
                    (job_id,),
                )
                row = cur.fetchone()

        if not row:
            return jsonify({"error": "job_not_found"}), 404

        return jsonify({"job": serialize_job(dict(row))})
    except Exception as exc:
        logger.exception("Failed to load job detail")
        return jsonify({"error": "failed_to_load_job_detail", "message": str(exc)}), 500


@app.put("/api/jobs/<job_id>/favorite")
def favorite_job(job_id: str):
    ensure_runtime_state()

    try:
        favorite = create_job_favorite(job_id=job_id)
        if not favorite:
            return jsonify({"error": "job_not_found"}), 404

        return jsonify(
            {
                "job_id": job_id,
                "is_favorited": True,
                "favorited_at": serialize_datetime(favorite.get("favorited_at")),
            }
        )
    except Exception as exc:
        logger.exception("Failed to favorite job")
        return jsonify({"error": "failed_to_favorite_job", "message": str(exc)}), 500


@app.delete("/api/jobs/<job_id>/favorite")
def unfavorite_job(job_id: str):
    ensure_runtime_state()

    try:
        deleted = delete_job_favorite(job_id=job_id)
        if deleted is None:
            return jsonify({"error": "job_not_found"}), 404

        return jsonify(
            {
                "job_id": job_id,
                "is_favorited": False,
                "favorited_at": None,
                "deleted": deleted,
            }
        )
    except Exception as exc:
        logger.exception("Failed to unfavorite job")
        return jsonify({"error": "failed_to_unfavorite_job", "message": str(exc)}), 500


@app.post("/api/resumes")
def upload_resume():
    ensure_runtime_state()

    file_storage = request.files.get("file")
    if file_storage is None or not file_storage.filename:
        return jsonify({"error": "missing_file", "message": "A DOCX file is required."}), 400

    if not allowed_resume_file(file_storage.filename):
        return jsonify({"error": "invalid_file_type", "message": "Only .docx files are supported."}), 400

    data = file_storage.read()
    if not data:
        return jsonify({"error": "empty_file", "message": "The uploaded DOCX file is empty."}), 400

    resume_id = create_resume_record(
        label=file_storage.filename,
        original_filename=file_storage.filename,
    )
    object_key: str | None = None

    try:
        object_key = upload_resume_object(resume_id=resume_id, filename=file_storage.filename, data=data)
        update_resume_minio_key(resume_id=resume_id, minio_key=object_key)
    except Exception as exc:
        logger.exception("Failed to upload resume to MinIO")
        try:
            delete_resume_record(resume_id=resume_id)
        except Exception:
            logger.exception("Failed to delete resume row during MinIO rollback")
        return jsonify({"error": "resume_upload_failed", "message": str(exc)}), 500

    dag_run_id = None
    dag_triggered = False
    warning_message = None

    try:
        dag_run = trigger_resume_dag(resume_id)
        dag_run_id = dag_run.get("dag_run_id")
        update_resume_dag_trigger(resume_id=resume_id, dag_run_id=dag_run_id)
        dag_triggered = True
    except Exception as exc:
        logger.exception("Failed to trigger Airflow DAG for resume %s", resume_id)
        warning_message = "MinIO 저장은 완료되었지만 Airflow DAG 트리거에 실패했습니다. 설정을 확인해 주세요."
        update_resume_error(
            resume_id=resume_id,
            message=f"Airflow DAG 트리거 실패: {exc}",
        )

    resume, profile = fetch_resume_and_profile(resume_id=resume_id)
    return jsonify(
        {
            "resume": serialize_resume(resume),
            "profile": serialize_resume_profile(profile),
            "recommendation_ready": resume_ready_for_recommendations(resume),
            "message": warning_message or build_resume_message(resume),
            "dag_run_id": dag_run_id,
            "dag_triggered": dag_triggered,
            "warning": warning_message,
        }
    ), 202


@app.get("/api/resumes")
def list_resumes():
    ensure_runtime_state()
    return jsonify({"items": fetch_resume_records()})


@app.get("/api/resumes/latest")
def latest_resume():
    ensure_runtime_state()
    resume, profile = fetch_resume_and_profile(latest=True)
    if not resume:
        return jsonify({"error": "resume_not_found"}), 404
    return jsonify(
        {
            "resume": serialize_resume(resume),
            "profile": serialize_resume_profile(profile),
            "recommendation_ready": resume_ready_for_recommendations(resume),
            "message": build_resume_message(resume),
        }
    )


@app.get("/api/resumes/latest/profile")
def latest_resume_profile():
    ensure_runtime_state()
    resume, profile = fetch_resume_and_profile(latest=True)
    if not resume:
        return jsonify({"error": "resume_not_found"}), 404

    return jsonify(
        {
            "resume": serialize_resume(resume),
            "profile": serialize_resume_profile(profile, include_raw_text=True),
            "recommendation_ready": resume_ready_for_recommendations(resume),
            "message": build_resume_message(resume),
        }
    )


@app.get("/api/resumes/<int:resume_id>")
def get_resume(resume_id: int):
    ensure_runtime_state()
    resume, profile = fetch_resume_and_profile(resume_id=resume_id)
    if not resume:
        return jsonify({"error": "resume_not_found"}), 404
    return jsonify(
        {
            "resume": serialize_resume(resume),
            "profile": serialize_resume_profile(profile),
            "recommendation_ready": resume_ready_for_recommendations(resume),
            "message": build_resume_message(resume),
        }
    )


@app.get("/api/resumes/<int:resume_id>/profile")
def get_resume_profile(resume_id: int):
    ensure_runtime_state()
    resume, profile = fetch_resume_and_profile(resume_id=resume_id)
    if not resume:
        return jsonify({"error": "resume_not_found"}), 404
    return jsonify(
        {
            "resume": serialize_resume(resume),
            "profile": serialize_resume_profile(profile, include_raw_text=True),
            "recommendation_ready": resume_ready_for_recommendations(resume),
            "message": build_resume_message(resume),
        }
    )


@app.patch("/api/resumes/<int:resume_id>")
def update_resume(resume_id: int):
    ensure_runtime_state()
    payload = request.get_json(silent=True) or {}
    if "is_active" not in payload:
        return jsonify({"error": "invalid_payload", "message": "is_active is required."}), 400

    resume = fetch_resume_record(resume_id=resume_id)
    if not resume:
        return jsonify({"error": "resume_not_found"}), 404

    update_resume_active_flag(resume_id=resume_id, is_active=bool(payload.get("is_active")))

    updated_resume, profile = fetch_resume_and_profile(resume_id=resume_id)
    return jsonify(
        {
            "resume": serialize_resume(updated_resume),
            "profile": serialize_resume_profile(profile),
            "recommendation_ready": resume_ready_for_recommendations(updated_resume),
            "message": build_resume_message(updated_resume),
        }
    )


@app.delete("/api/resumes/<int:resume_id>")
def delete_resume(resume_id: int):
    ensure_runtime_state()
    resume, _profile = fetch_resume_and_profile(resume_id=resume_id)
    if not resume:
        return jsonify({"error": "resume_not_found"}), 404

    delete_resume_record(resume_id=resume_id)

    try:
        delete_resume_object(resume.get("minio_key"))
    except Exception:
        logger.exception("Failed to delete MinIO object for resume %s", resume_id)

    return jsonify({"deleted": True, "resume_id": resume_id})


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def frontend(path: str):
    if path.startswith("api/") or path == "healthz":
        return jsonify({"error": "not_found"}), 404

    candidate = DIST_DIR / path
    if path and candidate.exists() and candidate.is_file():
        return send_from_directory(DIST_DIR, path)
    return send_from_directory(DIST_DIR, "index.html")


ensure_runtime_state()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
