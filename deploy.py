
from pathlib import Path
from functools import wraps
import os
import re
import secrets
import sqlite3

import pandas as pd

from flask import (
    Flask,
    render_template,
    jsonify,
    request,
    session
)
from werkzeug.security import generate_password_hash, check_password_hash


# ==================================================
# PATHS AND APPLICATION CONFIGURATION
# ==================================================

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"
DATA_FILE = DATA_DIR / "deployments.csv"
UPLOAD_DIR = DATA_DIR / "incoming"
DATABASE_FILE = DATA_DIR / "deploywatch_users.sqlite3"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

SECRET_FILE = DATA_DIR / ".session_secret"

if os.environ.get("SECRET_KEY"):
    SECRET_KEY = os.environ["SECRET_KEY"]
else:
    if not SECRET_FILE.exists():
        SECRET_FILE.write_text(secrets.token_hex(32))
    SECRET_KEY = SECRET_FILE.read_text().strip()

app = Flask(
    __name__,
    template_folder="templets",
    static_folder="templets/static",
    static_url_path="/static"
)

app.secret_key = SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(
        os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    ),
    PERMANENT_SESSION_LIFETIME=60 * 60 * 12,
    MAX_CONTENT_LENGTH=16 * 1024 * 1024
)

active_data = None


# ==================================================
# AUTHENTICATION DATABASE
# ==================================================

def get_db():
    connection = sqlite3.connect(DATABASE_FILE)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    with get_db() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        connection.commit()


initialize_database()


def login_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({
                "success": False,
                "error": "Authentication required."
            }), 401

        return function(*args, **kwargs)

    return decorated


def current_user():
    user_id = session.get("user_id")

    if not user_id:
        return None

    with get_db() as connection:
        user = connection.execute(
            """
            SELECT id, username, email
            FROM users
            WHERE id = ?
            """,
            (user_id,)
        ).fetchone()

    if not user:
        session.clear()
        return None

    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"]
    }


# ==================================================
# SMART CSV ANALYZER
# ==================================================

COLUMN_ALIASES = {
    "id": "deployment_id",
    "deploymentid": "deployment_id",
    "deployment_id": "deployment_id",
    "deployment": "deployment_id",
    "deploy_id": "deployment_id",

    "project_name": "project",
    "application": "project",
    "app_name": "project",

    "environment_name": "environment",
    "env": "environment",
    "stage": "environment",

    "deployment_status": "status",
    "result": "status",
    "outcome": "status",

    "duration": "duration_minutes",
    "duration_min": "duration_minutes",
    "deployment_duration": "duration_minutes",
    "execution_time": "duration_minutes",

    "tests": "tests_passed",
    "passed_tests": "tests_passed",

    "files_changed": "changed_files",
    "modified_files": "changed_files",

    "deployment_date": "date",
    "created_at": "date",
    "timestamp": "date",
    "deployed_at": "date",

    "error": "error_message",
    "error": "error_message",
    "exception": "error_message",
    "failure_reason": "error_message",
    "failure_details": "error_message",
    "error_details": "error_message",
    "message": "error_message"
}

NUMERIC_COLUMNS = {
    "duration_minutes",
    "tests_passed",
    "commit_count",
    "changed_files",
    "build_number",
    "retry_count",
    "error_count",
    "warning_count",
    "tests_failed"
}

DATE_COLUMNS = {
    "date",
    "created_at",
    "updated_at",
    "timestamp",
    "started_at",
    "finished_at"
}

ERROR_COLUMNS = [
    "error_message",
    "failure_reason",
    "exception",
    "error_details",
    "failure_details",
    "log_message",
    "message"
]


def clean_column_name(column):
    """Normalize CSV headings while retaining meaningful names."""

    name = str(column).strip().lower()
    name = re.sub(r"[^a-z0-9]+", "_", name)
    name = name.strip("_")

    return COLUMN_ALIASES.get(name, name)


def prepare_dataframe(df):
    """
    Prepare different CSV structures.

    IDs and unknown columns remain strings.
    Only recognized numeric columns are converted.
    Missing optional columns are not fabricated.
    """

    if df is None or df.empty:
        raise ValueError("CSV file does not contain usable records.")

    df = df.copy()

    cleaned_columns = [
        clean_column_name(column)
        for column in df.columns
    ]

    if not cleaned_columns or any(not column for column in cleaned_columns):
        raise ValueError("CSV contains an empty or invalid column heading.")

    if len(cleaned_columns) != len(set(cleaned_columns)):
        raise ValueError(
            "CSV contains duplicate columns after heading normalization."
        )

    df.columns = cleaned_columns

    # Preserve empty cells as missing values.
    df = df.replace(r"^\s*$", pd.NA, regex=True)
    df = df.dropna(how="all").copy()

    if df.empty:
        raise ValueError("CSV does not contain any usable records.")

    # Keep identifiers and unknown fields as text.
    for column in df.columns:
        if column not in NUMERIC_COLUMNS and column not in DATE_COLUMNS:
            df[column] = df[column].astype("string").str.strip()

    # Normalize known status values.
    if "status" in df.columns:
        status = df["status"].astype("string").str.strip().str.lower()

        status_aliases = {
            "successful": "Success",
            "success": "Success",
            "passed": "Success",
            "pass": "Success",
            "complete": "Success",
            "completed": "Success",

            "failure": "Failed",
            "failed": "Failed",
            "error": "Failed",
            "failure/failed": "Failed"
        }

        df["status"] = status.map(
            lambda value: (
                status_aliases.get(value, value.title())
                if pd.notna(value)
                else pd.NA
            )
        )

    # Convert only recognized numeric fields.
    for column in NUMERIC_COLUMNS:
        if column in df.columns:
            df[column] = pd.to_numeric(
                df[column],
                errors="coerce"
            )

    # Parse recognized date fields.
    for column in DATE_COLUMNS:
        if column in df.columns:
            df[column] = pd.to_datetime(
                df[column],
                errors="coerce"
            )

    return df.reset_index(drop=True)


def load_data():
    if active_data is not None:
        return active_data.copy()

    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"Default dataset not found: {DATA_FILE}"
        )

    # Read every original CSV field as text first.
    df = pd.read_csv(
        DATA_FILE,
        dtype=str,
        keep_default_na=False
    )

    return prepare_dataframe(df)


def validate(df):
    """Backward-compatible validation function."""
    return prepare_dataframe(df)


# ==================================================
# FILTERING
# ==================================================

def filtered_data():
    df = load_data()

    project = request.args.get("project", "")
    environment = request.args.get("environment", "")
    status = request.args.get("status", "")
    search = request.args.get("search", "").strip()

    if project and "project" in df.columns:
        df = df[df["project"].astype(str) == project]

    if environment and "environment" in df.columns:
        df = df[df["environment"].astype(str) == environment]

    if status and "status" in df.columns:
        df = df[df["status"].astype(str) == status]

    if search:
        searchable_columns = [
            column for column in [
                "deployment_id",
                "project",
                "environment",
                "status"
            ]
            if column in df.columns
        ]

        if searchable_columns:
            mask = pd.Series(False, index=df.index)

            for column in searchable_columns:
                mask |= df[column].astype(str).str.contains(
                    search,
                    case=False,
                    na=False,
                    regex=False
                )

            df = df[mask]

    return df.copy()


# ==================================================
# JSON SERIALIZATION AND HELPERS
# ==================================================

def records_for_json(df):
    output = df.copy()

    for column in output.columns:
        if (
            column in DATE_COLUMNS
            or pd.api.types.is_datetime64_any_dtype(output[column])
        ):
            output[column] = output[column].apply(
                lambda value: (
                    value.strftime("%Y-%m-%d %H:%M:%S")
                    if pd.notna(value)
                    else None
                )
            )

    return output.astype(object).where(
        pd.notna(output), None
    ).to_dict("records")


def unique_values(df, column):
    if column not in df.columns:
        return []

    return sorted(
        df[column].dropna().astype(str).unique().tolist()
    )


def numeric_mean(df, column):
    if column not in df.columns:
        return 0

    values = pd.to_numeric(df[column], errors="coerce")

    if not values.notna().any():
        return 0

    return round(float(values.mean()), 2)


def status_counts(df):
    if "status" not in df.columns:
        return 0, 0

    statuses = df["status"].astype("string").str.lower()

    successful = int(statuses.eq("success").sum())
    failed = int(statuses.eq("failed").sum())

    return successful, failed


def sort_by_date(df):
    output = df.copy()

    if "date" in output.columns:
        output["_sort_date"] = pd.to_datetime(
            output["date"],
            errors="coerce"
        )

        output = output.sort_values(
            "_sort_date",
            ascending=False,
            na_position="last"
        ).drop(columns=["_sort_date"])

    return output


# ==================================================
# HOME
# ==================================================

@app.route("/")
def home():
    return render_template("main.html")


# ==================================================
# AUTHENTICATION API
# ==================================================

@app.route("/api/auth/session")
def auth_session():
    user = current_user()

    return jsonify({
        "authenticated": user is not None,
        "user": user
    })


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json(silent=True) or {}

    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if len(username) < 3 or len(username) > 40:
        return jsonify({
            "success": False,
            "error": "Username must contain 3 to 40 characters."
        }), 400

    if not re.fullmatch(r"[A-Za-z0-9_.-]+", username):
        return jsonify({
            "success": False,
            "error": "Username can only contain letters, numbers, dots, underscores and hyphens."
        }), 400

    if email and (
        len(email) > 254
        or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
    ):
        return jsonify({
            "success": False,
            "error": "Enter a valid email address."
        }), 400

    if len(password) < 8:
        return jsonify({
            "success": False,
            "error": "Password must contain at least 8 characters."
        }), 400

    password_hash = generate_password_hash(password)

    try:
        with get_db() as connection:
            cursor = connection.execute(
                """
                INSERT INTO users (username, email, password_hash)
                VALUES (?, ?, ?)
                """,
                (username, email or None, password_hash)
            )
            connection.commit()

        return jsonify({
            "success": True,
            "message": "Account created successfully."
        })

    except sqlite3.IntegrityError:
        return jsonify({
            "success": False,
            "error": "That username or email is already registered."
        }), 409


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(silent=True) or {}

    identifier = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

    if not identifier or not password:
        return jsonify({
            "success": False,
            "error": "Enter your username and password."
        }), 400

    with get_db() as connection:
        user = connection.execute(
            """
            SELECT id, username, email, password_hash
            FROM users
            WHERE username = ? OR email = ?
            """,
            (identifier, identifier.lower())
        ).fetchone()

    if not user or not check_password_hash(
        user["password_hash"], password
    ):
        return jsonify({
            "success": False,
            "error": "Incorrect username or password."
        }), 401

    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]

    return jsonify({
        "success": True,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"]
        }
    })


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()

    return jsonify({
        "success": True,
        "message": "Logged out successfully."
    })


# ==================================================
# DASHBOARD API
# ==================================================

@app.route("/api/dashboard")
@login_required
def dashboard():
    try:
        df = filtered_data()
        all_data = load_data()

        total = len(df)
        successful, failed = status_counts(df)

        success_rate = (
            round(successful / total * 100, 1)
            if total else 0
        )

        average_duration = numeric_mean(
            df,
            "duration_minutes"
        )

        health = round(success_rate)

        risk = (
            "HEALTHY" if health >= 85 else
            "WARNING" if health >= 60 else
            "CRITICAL"
        )

        output = sort_by_date(df)

        return jsonify({
            "success": True,

            "metrics": {
                "total": total,
                "successful": successful,
                "failed": failed,
                "success_rate": success_rate,
                "avg_duration": average_duration,
                "health_score": health,
                "risk": risk
            },

            "filters": {
                "projects": unique_values(all_data, "project"),
                "environments": unique_values(
                    all_data, "environment"
                ),
                "statuses": unique_values(all_data, "status")
            },

            "columns": list(output.columns),
            "deployments": records_for_json(output)
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "error": str(error)
        }), 400


# ==================================================
# SMART CSV UPLOAD
# ==================================================

@app.route("/api/upload", methods=["POST"])
@login_required
def upload():
    global active_data

    try:
        if "file" not in request.files:
            return jsonify({
                "success": False,
                "error": "No file received."
            }), 400

        file = request.files["file"]

        if not file.filename:
            return jsonify({
                "success": False,
                "error": "Please select a CSV file."
            }), 400

        if not file.filename.lower().endswith(".csv"):
            return jsonify({
                "success": False,
                "error": "Please upload a CSV file."
            }), 400

        # Read fields as text to preserve IDs such as 0012.
        raw_data = pd.read_csv(
            file,
            dtype=str,
            keep_default_na=False
        )

        df = prepare_dataframe(raw_data)

        active_data = df.copy()

        available_columns = list(df.columns)

        return jsonify({
            "success": True,
            "message": "CSV analyzed successfully.",
            "records": len(df),
            "columns": available_columns,
            "optional_columns_skipped": [
                column for column in [
                    "deployment_id",
                    "project",
                    "environment",
                    "duration_minutes",
                    "status",
                    "tests_passed",
                    "commit_count",
                    "changed_files",
                    "date"
                ]
                if column not in available_columns
            ]
        })

    except pd.errors.EmptyDataError:
        return jsonify({
            "success": False,
            "error": "The uploaded CSV file is empty."
        }), 400

    except Exception as error:
        return jsonify({
            "success": False,
            "error": str(error)
        }), 400


# ==================================================
# RESTORE DEFAULT DATASET
# ==================================================

@app.route("/api/reset-dataset", methods=["POST"])
@login_required
def reset_dataset():
    global active_data

    active_data = None

    return jsonify({
        "success": True,
        "message": "Default dataset restored."
    })


# ==================================================
# RISK ANALYSIS API
# ==================================================

@app.route("/api/risk-analysis")
@login_required
def risk_analysis():
    try:
        df = filtered_data().reset_index(drop=True)

        projects = []
        risks = []
        recommendations = []

        high = 0
        medium = 0
        low = 0
        slow_count = 0

        if df.empty:
            return jsonify({
                "success": True,
                "projects": [],
                "risks": [],
                "recommendations": [],
                "summary": {
                    "high": 0,
                    "medium": 0,
                    "low": 0,
                    "median_duration": 0,
                    "slow_count": 0
                }
            })

        has_status = "status" in df.columns
        has_project = "project" in df.columns
        has_duration = "duration_minutes" in df.columns
        has_files = "changed_files" in df.columns

        durations = (
            pd.to_numeric(df["duration_minutes"], errors="coerce")
            if has_duration
            else pd.Series(float("nan"), index=df.index)
        )

        changed_files = (
            pd.to_numeric(df["changed_files"], errors="coerce")
            if has_files
            else pd.Series(float("nan"), index=df.index)
        )

        median_duration = (
            float(durations.median())
            if durations.notna().any()
            else None
        )

        median_files = (
            float(changed_files.median())
            if changed_files.notna().any()
            else None
        )

        # Project failure patterns.
        if has_project and has_status:
            for project_name, group in df.groupby(
                "project",
                dropna=False
            ):
                group_status = group["status"].astype(str).str.lower()

                project_total = len(group)
                project_failed = int(group_status.eq("failed").sum())

                failure_rate = (
                    round(project_failed / project_total * 100, 1)
                    if project_total else 0
                )

                projects.append({
                    "project": str(project_name),
                    "total": project_total,
                    "failed": project_failed,
                    "failure_rate": failure_rate,
                    "repeated_failures": project_failed >= 2
                })

            projects.sort(
                key=lambda item: (
                    item["failed"],
                    item["failure_rate"]
                ),
                reverse=True
            )

        # Risk scores based only on available data.
        for index, row in df.iterrows():
            score = 0
            reasons = []

            status_value = (
                str(row["status"]).lower()
                if has_status and pd.notna(row["status"])
                else "unknown"
            )

            if status_value == "failed":
                score += 60
                reasons.append("Deployment failed")

            duration_value = durations.loc[index]

            if (
                median_duration is not None
                and median_duration > 0
                and pd.notna(duration_value)
                and duration_value > median_duration * 1.5
            ):
                score += 25
                reasons.append("Unusually long deployment")

            files_value = changed_files.loc[index]

            if (
                median_files is not None
                and median_files > 0
                and pd.notna(files_value)
                and files_value > median_files * 1.5
            ):
                score += 15
                reasons.append("Large number of changed files")

            score = min(score, 100)

            if score >= 60:
                level = "HIGH"
                high += 1
            elif score >= 25:
                level = "MEDIUM"
                medium += 1
            else:
                level = "LOW"
                low += 1

            deployment_id = (
                row["deployment_id"]
                if "deployment_id" in df.columns
                else index
            )

            project_name = (
                row["project"]
                if has_project
                else "Unknown"
            )

            duration_display = (
                round(float(duration_value), 2)
                if pd.notna(duration_value)
                else None
            )

            risks.append({
                "deployment_id": str(deployment_id),
                "project": str(project_name),
                "status": (
                    str(row["status"])
                    if has_status else "Not available"
                ),
                "duration": duration_display,
                "score": score,
                "level": level,
                "reasons": reasons or [
                    "No major risk indicators in available fields"
                ]
            })

        risks.sort(
            key=lambda item: item["score"],
            reverse=True
        )

        if median_duration is not None and median_duration > 0:
            slow_count = int(
                (
                    durations > median_duration * 1.5
                ).sum()
            )

        for project in projects:
            if project["repeated_failures"]:
                recommendations.append({
                    "priority": "HIGH",
                    "title": f"Investigate {project['project']}",
                    "detail": (
                        f"{project['failed']} failed deployments detected. "
                        "Review available deployment records and logs."
                    )
                })

            elif project["failure_rate"] > 0:
                recommendations.append({
                    "priority": "MEDIUM",
                    "title": f"Review {project['project']}",
                    "detail": (
                        f"Observed failure rate: "
                        f"{project['failure_rate']}%."
                    )
                })

        if slow_count:
            recommendations.append({
                "priority": "MEDIUM",
                "title": "Investigate slow deployments",
                "detail": (
                    f"{slow_count} deployments exceeded "
                    "1.5 times the median duration."
                )
            })

        if not recommendations:
            recommendations.append({
                "priority": "LOW",
                "title": "No major issues detected",
                "detail": (
                    "No major risk indicators were found "
                    "in the available columns."
                )
            })

        return jsonify({
            "success": True,
            "projects": projects,
            "risks": risks,
            "recommendations": recommendations,
            "summary": {
                "high": high,
                "medium": medium,
                "low": low,
                "median_duration": (
                    round(median_duration, 2)
                    if median_duration is not None
                    else 0
                ),
                "slow_count": slow_count
            }
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "error": str(error)
        }), 400


# ==================================================
# DEPLOYMENT FORENSICS
# ==================================================

@app.route("/api/forensics")
@login_required
def deployment_forensics():
    try:
        df = filtered_data().reset_index(drop=True)

        if "status" not in df.columns:
            return jsonify({
                "success": True,
                "summary": {
                    "total_failures": 0,
                    "failure_rate": 0
                },
                "timeline": [],
                "probable_causes": [],
                "comparison": {
                    "available": False,
                    "latest": None,
                    "previous": None,
                    "message": "The CSV does not contain a status column."
                }
            })

        statuses = df["status"].astype(str).str.lower()
        failures = df[statuses.eq("failed")].copy()

        total = len(df)
        failure_count = len(failures)

        failure_rate = (
            round(failure_count / total * 100, 1)
            if total else 0
        )

        # Build failure history.
        timeline = []

        for _, row in sort_by_date(failures).iterrows():
            detail = None

            for column in ERROR_COLUMNS:
                if column in failures.columns and pd.notna(row[column]):
                    value = str(row[column]).strip()

                    if value:
                        detail = value
                        break

            deployment_id = (
                str(row["deployment_id"])
                if "deployment_id" in failures.columns
                else "Not available"
            )

            timeline.append({
                "deployment_id": deployment_id,
                "project": (
                    str(row["project"])
                    if "project" in failures.columns
                    else "Not available"
                ),
                "environment": (
                    str(row["environment"])
                    if "environment" in failures.columns
                    else "Not available"
                ),
                "date": (
                    str(row["date"])
                    if "date" in failures.columns
                    and pd.notna(row["date"])
                    else "Not available"
                ),
                "failure_detail": (
                    detail if detail
                    else "No error details supplied in CSV."
                )
            })

        # Probable causes are heuristics based on available fields.
        probable_causes = []

        error_text = " ".join(
            " ".join(
                failures[column].dropna().astype(str).tolist()
            )
            for column in ERROR_COLUMNS
            if column in failures.columns
        )
        error_text = error_text.lower()

        heuristic_rules = [
            (
                "Dependency or package issue",
                ["dependency", "package", "module not found", "import error"],
                "The supplied failure text contains dependency-related terms."
            ),
            (
                "Build or compilation issue",
                ["build failed", "compilation", "compile error", "build error"],
                "The supplied failure text contains build-related terms."
            ),
            (
                "Network or connection issue",
                ["connection refused", "timeout", "network", "dns"],
                "The supplied failure text contains connection-related terms."
            ),
            (
                "Configuration issue",
                ["configuration", "config error", "environment variable", "missing variable"],
                "The supplied failure text contains configuration-related terms."
            ),
            (
                "Test failure",
                ["test failed", "tests failed", "assertion error", "unit test"],
                "The supplied failure text contains test-related terms."
            )
        ]

        for cause, keywords, evidence in heuristic_rules:
            if any(keyword in error_text for keyword in keywords):
                probable_causes.append({
                    "cause": cause,
                    "type": "HEURISTIC",
                    "evidence": evidence,
                    "confidence": "Pattern match"
                })

        # Test counts can indicate test-related failures.
        if "tests_failed" in failures.columns:
            failed_tests = pd.to_numeric(
                failures["tests_failed"],
                errors="coerce"
            )

            if (failed_tests > 0).any() and not any(
                item["cause"] == "Test failure"
                for item in probable_causes
            ):
                probable_causes.append({
                    "cause": "Test failure",
                    "type": "HEURISTIC",
                    "evidence": (
                        "One or more failed records contain a positive "
                        "tests_failed value."
                    ),
                    "confidence": "Data indicator"
                })

        if (
            "duration_minutes" in failures.columns
            and "duration_minutes" in df.columns
        ):
            all_durations = pd.to_numeric(
                df["duration_minutes"],
                errors="coerce"
            )

            failed_durations = pd.to_numeric(
                failures["duration_minutes"],
                errors="coerce"
            )

            median_duration = (
                all_durations.median()
                if all_durations.notna().any()
                else None
            )

            if (
                median_duration is not None
                and median_duration > 0
                and (failed_durations > median_duration * 1.5).any()
            ):
                probable_causes.append({
                    "cause": "Long-running deployment",
                    "type": "HEURISTIC",
                    "evidence": (
                        "Some failed deployments took more than "
                        "1.5 times the overall median duration."
                    ),
                    "confidence": "Statistical indicator"
                })

        if not probable_causes and failure_count:
            probable_causes.append({
                "cause": "Insufficient diagnostic information",
                "type": "HEURISTIC",
                "evidence": (
                    "Failure records exist, but the available CSV fields "
                    "do not establish a more specific pattern."
                ),
                "confidence": "Limited evidence"
            })

        # Compare earlier and more recent records.
        comparison = {
            "available": False,
            "latest": None,
            "previous": None,
            "message": "Not enough records for a historical comparison."
        }

        if len(df) >= 2:
            ordered = df.copy()

            if "date" in ordered.columns:
                ordered["_comparison_date"] = pd.to_datetime(
                    ordered["date"],
                    errors="coerce"
                )

                if ordered["_comparison_date"].notna().any():
                    ordered = ordered.sort_values(
                        "_comparison_date",
                        ascending=True,
                        na_position="first"
                    )

                ordered = ordered.drop(columns=["_comparison_date"])

            split_at = len(ordered) // 2

            previous_period = ordered.iloc[:split_at]
            latest_period = ordered.iloc[split_at:]

            def period_metrics(period):
                period_success, period_failed = status_counts(period)
                period_total = len(period)

                return {
                    "total": period_total,
                    "failed": period_failed,
                    "failure_rate": (
                        round(period_failed / period_total * 100, 1)
                        if period_total else 0
                    ),
                    "average_duration": numeric_mean(
                        period,
                        "duration_minutes"
                    )
                }

            comparison = {
                "available": True,
                "latest": period_metrics(latest_period),
                "previous": period_metrics(previous_period),
                "message": (
                    "The dataset was divided into earlier and more recent "
                    "record groups for comparison. This is a descriptive "
                    "comparison, not proof of a cause."
                )
            }

        return jsonify({
            "success": True,
            "summary": {
                "total_failures": failure_count,
                "failure_rate": failure_rate
            },
            "timeline": timeline,
            "probable_causes": probable_causes,
            "comparison": comparison
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "error": str(error)
        }), 400


# ==================================================
# ERROR HANDLERS
# ==================================================

@app.errorhandler(413)
def file_too_large(error):
    return jsonify({
        "success": False,
        "error": "The uploaded file exceeds the 16 MB limit."
    }), 413


# ==================================================
# START APPLICATION
# ==================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
