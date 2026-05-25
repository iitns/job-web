import logging
import os
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
import requests
from flask import Flask, jsonify, request, send_from_directory


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
DEFAULT_PAGE_SIZE = 12
MAX_PAGE_SIZE = 50


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


def serialize_job(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "job_id": row.get("job_id"),
        "company": row.get("company"),
        "title": row.get("title"),
        "location": row.get("location"),
        "locations": row.get("locations") or [],
        "level_guess": row.get("level_guess"),
        "team": row.get("team"),
        "raw_description": row.get("raw_description"),
        "team_description": row.get("team_description"),
        "responsibilities": row.get("responsibilities"),
        "minimum_qualifications": row.get("minimum_qualifications"),
        "preferred_qualifications": row.get("preferred_qualifications"),
        "skills": row.get("skills") or [],
        "domains": row.get("domains") or [],
        "url": row.get("url"),
        "posted_at": row.get("posted_at").isoformat() if row.get("posted_at") else None,
        "first_seen_at": row.get("first_seen_at").isoformat() if row.get("first_seen_at") else None,
        "last_seen_at": row.get("last_seen_at").isoformat() if row.get("last_seen_at") else None,
        "is_active": row.get("is_active", True),
        "detail_extracted_at": row.get("detail_extracted_at").isoformat() if row.get("detail_extracted_at") else None,
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
                    location,
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
            "location",
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
                                "location^2",
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


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


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
                        location,
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


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def frontend(path: str):
    if path.startswith("api/") or path == "healthz":
        return jsonify({"error": "not_found"}), 404

    candidate = DIST_DIR / path
    if path and candidate.exists() and candidate.is_file():
        return send_from_directory(DIST_DIR, path)
    return send_from_directory(DIST_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
