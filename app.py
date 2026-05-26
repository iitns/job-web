import io
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
import requests
from flask import Flask, jsonify, request, send_from_directory
from minio import Minio
from minio.error import S3Error
from requests.auth import HTTPBasicAuth
from werkzeug.utils import secure_filename


logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"

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
RESUME_SCHEMA_PATH = BASE_DIR / "migrations" / "001_create_job_web_resume_tables.sql"

RESUME_STATUS_LABELS = {
    "queued": "대기 중",
    "processing": "처리 중",
    "ready": "추천 준비 완료",
    "pending": "미등록",
}


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


def db_connect():
    return psycopg2.connect(**PG_CONFIG)


def ensure_runtime_state() -> None:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(RESUME_SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.commit()


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
    if int(row.get("recommendation_count") or 0) > 0:
        return "ready"
    if row.get("content_embedding") or row.get("raw_text"):
        return "processing"
    if row.get("minio_key"):
        return "queued"
    return "pending"


def build_resume_message(row: dict[str, Any] | None) -> str | None:
    if not row:
        return None

    if int(row.get("recommendation_count") or 0) > 0:
        return None
    if not row.get("minio_key"):
        return "이력서를 먼저 업로드해 주세요."
    if not row.get("raw_text"):
        return "이력서 업로드가 완료되었습니다. Airflow에서 텍스트 추출을 진행 중입니다."
    if not row.get("content_embedding"):
        return "이력서 텍스트 추출이 끝났고 임베딩을 생성 중입니다."
    return "추천 결과를 생성 중입니다."


def serialize_job(row: dict[str, Any]) -> dict[str, Any]:
    locations = normalize_string_list(row.get("locations"))
    summary = summarize_text(
        row.get("summary"),
        row.get("team_description"),
        row.get("responsibilities"),
        row.get("raw_description"),
    )
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
    }


def serialize_resume(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None

    status = derive_resume_status(row)
    return {
        "id": row.get("id"),
        "label": row.get("label"),
        "filename": row.get("label"),
        "status": status,
        "status_label": RESUME_STATUS_LABELS.get(status, status),
        "minio_key": row.get("minio_key"),
        "uploaded_at": serialize_datetime(row.get("uploaded_at")),
        "created_at": serialize_datetime(row.get("uploaded_at")),
        "recommendation_ready": int(row.get("recommendation_count") or 0) > 0,
        "recommendation_count": int(row.get("recommendation_count") or 0),
        "last_ranked_at": serialize_datetime(row.get("latest_ranked_at")),
    }


def serialize_resume_profile(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None

    summary = summarize_text(row.get("summary"), limit=420)
    skills = normalize_string_list(row.get("skills"))
    if not summary and not skills:
        return None

    return {
        "resume_id": row.get("id"),
        "candidate_name": None,
        "summary": summary,
        "skills": skills,
        "domains": [],
        "locations": [],
        "experience_items": [],
        "projects": [],
    }


def fetch_company_options(conn) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT company
            FROM jobs
            WHERE is_active = TRUE
            ORDER BY company ASC
            """
        )
        return [row[0] for row in cur.fetchall()]


def fetch_jobs_from_postgres(*, page: int, page_size: int, companies: list[str]) -> dict[str, Any]:
    filters = ["is_active = TRUE"]
    params: list[Any] = []

    if companies:
        filters.append("company = ANY(%s)")
        params.append(companies)

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

        companies_all = fetch_company_options(conn)

    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "companies": companies_all,
        "source": "postgres",
    }


def search_jobs_in_elasticsearch(*, keyword: str, page: int, page_size: int, companies: list[str]) -> dict[str, Any]:
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

    response = requests.post(
        f"{ES_HOST}/{ES_INDEX}/_search",
        json=query,
        timeout=10,
    )

    if response.status_code == 404:
        logger.warning("Elasticsearch index %s not found", ES_INDEX)
        with db_connect() as conn:
            companies_all = fetch_company_options(conn)
        return {
            "jobs": [],
            "total": 0,
            "page": page,
            "page_size": page_size,
            "companies": companies_all,
            "source": "elasticsearch",
            "search_ready": False,
        }

    response.raise_for_status()
    payload = response.json()
    hits = payload.get("hits", {})
    total = hits.get("total", {}).get("value", 0)
    jobs = [serialize_job(hit.get("_source", {})) for hit in hits.get("hits", [])]

    with db_connect() as conn:
        companies_all = fetch_company_options(conn)

    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "companies": companies_all,
        "source": "elasticsearch",
        "search_ready": True,
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
                    r.minio_key,
                    r.raw_text,
                    r.skills,
                    r.summary,
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


def recommend_jobs_from_resume(*, page: int, page_size: int, companies: list[str]) -> dict[str, Any]:
    offset = (page - 1) * page_size

    with db_connect() as conn:
        companies_all = fetch_company_options(conn)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    r.id,
                    r.label,
                    r.minio_key,
                    r.raw_text,
                    r.skills,
                    r.summary,
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
                raise ValueError("추천을 사용하려면 먼저 최신 이력서를 업로드해 주세요.")

            resume_dict = dict(resume)
            if int(resume_dict.get("recommendation_count") or 0) <= 0:
                return {
                    "jobs": [],
                    "total": 0,
                    "page": page,
                    "page_size": page_size,
                    "companies": companies_all,
                    "source": "recommendation",
                    "resume": serialize_resume(resume_dict),
                    "profile": serialize_resume_profile(resume_dict),
                    "recommendation_ready": False,
                    "message": build_resume_message(resume_dict),
                }

            filters = ["r.resume_id = %s", "j.is_active = TRUE"]
            params: list[Any] = [resume_dict["id"]]
            if companies:
                filters.append("j.company = ANY(%s)")
                params.append(companies)

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

    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "companies": companies_all,
        "source": "recommendation",
        "resume": serialize_resume(resume_dict),
        "profile": serialize_resume_profile(resume_dict),
        "recommendation_ready": True,
        "message": None,
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
    return f"resumes/{resume_id}/{safe_name}"


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


def create_resume_record(*, label: str) -> int:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO resumes (label)
                VALUES (%s)
                RETURNING id
                """,
                (label,),
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
                SET minio_key = %s
                WHERE id = %s
                """,
                (minio_key, resume_id),
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
    auth = HTTPBasicAuth(AIRFLOW_API_USERNAME, AIRFLOW_API_PASSWORD) if AIRFLOW_API_USERNAME else None
    response = requests.post(
        f"{AIRFLOW_API_BASE_URL}/api/v1/dags/{AIRFLOW_DAG_ID}/dagRuns",
        json={
            "dag_run_id": dag_run_id,
            "conf": {
                "resume_id": resume_id,
            },
        },
        auth=auth,
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
        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("Health check failed")
        return jsonify({"ok": False, "message": str(exc)}), 500


@app.get("/api/jobs")
def list_jobs():
    page, page_size = get_page_args()
    companies = get_companies_arg()

    try:
        return jsonify(fetch_jobs_from_postgres(page=page, page_size=page_size, companies=companies))
    except Exception as exc:
        logger.exception("Failed to load jobs from PostgreSQL")
        return jsonify({"error": "failed_to_load_jobs", "message": str(exc)}), 500


@app.get("/api/jobs/search")
def search_jobs():
    keyword = request.args.get("q", "").strip()
    page, page_size = get_page_args()
    companies = get_companies_arg()

    if not keyword:
        return jsonify(fetch_jobs_from_postgres(page=page, page_size=page_size, companies=companies))

    try:
        return jsonify(search_jobs_in_elasticsearch(keyword=keyword, page=page, page_size=page_size, companies=companies))
    except Exception as exc:
        logger.exception("Failed to search jobs in Elasticsearch")
        return jsonify({"error": "failed_to_search_jobs", "message": str(exc)}), 500


@app.get("/api/jobs/recommendations")
def recommend_jobs():
    page, page_size = get_page_args()
    companies = get_companies_arg()

    try:
        return jsonify(recommend_jobs_from_resume(page=page, page_size=page_size, companies=companies))
    except ValueError as exc:
        return jsonify({"error": "resume_required", "message": str(exc)}), 404
    except Exception as exc:
        logger.exception("Failed to load recommendation jobs")
        return jsonify({"error": "failed_to_recommend_jobs", "message": str(exc)}), 500


@app.get("/api/jobs/<job_id>")
def job_detail(job_id: str):
    try:
        with db_connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
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
                    WHERE job_id = %s
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

    resume_id = create_resume_record(label=file_storage.filename)
    object_key: str | None = None

    try:
        object_key = upload_resume_object(resume_id=resume_id, filename=file_storage.filename, data=data)
        update_resume_minio_key(resume_id=resume_id, minio_key=object_key)
        dag_run = trigger_resume_dag(resume_id)

        resume, profile = fetch_resume_and_profile(resume_id=resume_id)
        return jsonify(
            {
                "resume": serialize_resume(resume),
                "profile": serialize_resume_profile(profile),
                "recommendation_ready": False,
                "message": build_resume_message(resume),
                "dag_run_id": dag_run.get("dag_run_id"),
            }
        ), 202
    except Exception as exc:
        logger.exception("Failed to upload and queue resume")
        try:
            delete_resume_object(object_key)
        except Exception:
            logger.exception("Failed to delete resume object during rollback")
        try:
            delete_resume_record(resume_id=resume_id)
        except Exception:
            logger.exception("Failed to delete resume row during rollback")
        return jsonify({"error": "resume_upload_failed", "message": str(exc)}), 500


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
            "recommendation_ready": int(resume.get("recommendation_count") or 0) > 0,
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
            "recommendation_ready": int(resume.get("recommendation_count") or 0) > 0,
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
            "profile": serialize_resume_profile(profile),
            "recommendation_ready": int(resume.get("recommendation_count") or 0) > 0,
            "message": build_resume_message(resume),
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
