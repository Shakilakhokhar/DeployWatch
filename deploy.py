
from pathlib import Path
import os
from flask import Flask, render_template, jsonify, request
import pandas as pd

BASE = Path(__file__).resolve().parent
DATA_FILE = BASE / "data" / "deployments.csv"
UPLOAD_DIR = BASE / "data" / "incoming"

REQUIRED = [
    "deployment_id", "project", "environment", "duration_minutes",
    "status", "tests_passed", "commit_count", "changed_files", "date"
]

app = Flask(
    __name__,
    template_folder="templets",
    static_folder="templets/static",
    static_url_path="/static"
)

active_data = None


def validate(df):
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError("Missing columns: " + ", ".join(missing))
    if df.empty:
        raise ValueError("CSV file is empty.")

    df = df.copy()
    df["duration_minutes"] = pd.to_numeric(
        df["duration_minutes"], errors="coerce"
    )
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["status"] = df["status"].astype(str).str.strip().str.title()

    invalid = (
        df["duration_minutes"].isna()
        | (df["duration_minutes"] <= 0)
        | df["date"].isna()
        | ~df["status"].isin(["Success", "Failed"])
    )

    if invalid.any():
        raise ValueError("Invalid duration, date, or deployment status.")

    for col in ["tests_passed", "commit_count", "changed_files"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    return df


def load_data():
    if active_data is not None:
        return active_data.copy()

    if not DATA_FILE.exists():
        raise FileNotFoundError(f"Dataset not found: {DATA_FILE}")

    return validate(pd.read_csv(DATA_FILE))



def filtered_data():
    df = load_data()

    project = request.args.get("project")
    environment = request.args.get("environment")
    status = request.args.get("status")
    search = request.args.get("search", "").strip()

    if project:
        df = df[df["project"] == project]

    if environment:
        df = df[df["environment"] == environment]

    if status:
        df = df[df["status"] == status]

    if search:
        mask = (
            df["deployment_id"].astype(str).str.contains(
                search, case=False, na=False
            )
            | df["project"].astype(str).str.contains(
                search, case=False, na=False
            )
        )
        df = df[mask]

    return df


@app.route("/")
def home():
    return render_template("main.html")


@app.route("/api/dashboard")
def dashboard():
    try:
        df = filtered_data()

        total = len(df)
        success = int((df["status"] == "Success").sum())
        failed = int((df["status"] == "Failed").sum())
        rate = round(success / total * 100, 1) if total else 0
        duration = round(float(df["duration_minutes"].mean()), 2) if total else 0

        health = round(rate)
        risk = "HEALTHY" if health >= 85 else (
            "WARNING" if health >= 60 else "CRITICAL"
        )

        output = df.copy()
        output["date"] = output["date"].dt.strftime("%Y-%m-%d")

        all_data = load_data()

        return jsonify({
            "success": True,
            "metrics": {
                "total": total,
                "successful": success,
                "failed": failed,
                "success_rate": rate,
                "avg_duration": duration,
                "health_score": health,
                "risk": risk
            },
            "filters": {
                "projects": sorted(all_data["project"].dropna().unique().tolist()),
                "environments": sorted(
                    all_data["environment"].dropna().unique().tolist()
                ),
                "statuses": ["Success", "Failed"]
            },
            "deployments": output.sort_values(
                "date", ascending=False
            ).to_dict("records")
        })

    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 400

        total = len(df)
        success = int((df["status"] == "Success").sum())
        failed = int((df["status"] == "Failed").sum())
        rate = round(success / total * 100, 1) if total else 0
        duration = round(float(df["duration_minutes"].mean()), 2) if total else 0

        health = round(rate)
        risk = "HEALTHY" if health >= 85 else (
            "WARNING" if health >= 60 else "CRITICAL"
        )

        output = df.copy()
        output["date"] = output["date"].dt.strftime("%Y-%m-%d")

        all_data = load_data()

        return jsonify({
            "success": True,
            "metrics": {
                "total": total,
                "successful": success,
                "failed": failed,
                "success_rate": rate,
                "avg_duration": duration,
                "health_score": health,
                "risk": risk
            },
            "filters": {
                "projects": sorted(all_data["project"].dropna().unique().tolist()),
                "environments": sorted(
                    all_data["environment"].dropna().unique().tolist()
                ),
                "statuses": ["Success", "Failed"]
            },
            "deployments": output.sort_values(
                "date", ascending=False
            ).to_dict("records")
        })

    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 400

@app.route("/api/upload", methods=["POST"])
def upload():
    global active_data

    try:
        if "file" not in request.files:
            return jsonify({"success": False, "error": "No file received"}), 400

        file = request.files["file"]

        if not file.filename.lower().endswith(".csv"):
            return jsonify({"success": False, "error": "Please upload a CSV file"}), 400

        df = pd.read_csv(file)
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        validate(df)
        active_data = df.copy()

        return jsonify({
            "success": True,
            "message": "Dataset uploaded successfully"
        })

    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 400


@app.route("/api/reset-dataset", methods=["POST"])
def reset_dataset():
    global active_data
    active_data = None
    return jsonify(success=True, message="Default dataset restored.")

@app.route("/api/risk-analysis")
def risk_analysis():
    try:
        df = filtered_data()

        if df.empty:
            return jsonify({
                "success": True,
                "projects": [],
                "risks": [],
                "recommendations": [],
                "summary": {"high": 0, "medium": 0, "low": 0}
            })

        median_duration = float(df["duration_minutes"].median())
        median_files = float(df["changed_files"].median())

        # 1. FAILURE PATTERN DETECTION
        project_analysis = []

        for project, group in df.groupby("project"):
            total = len(group)
            failed = int((group["status"] == "Failed").sum())
            failure_rate = round((failed / total) * 100, 1)

            project_analysis.append({
                "project": str(project),
                "total": total,
                "failed": failed,
                "failure_rate": failure_rate,
                "repeated_failures": failed >= 2
            })

        project_analysis.sort(
            key=lambda x: (x["failed"], x["failure_rate"]),
            reverse=True
        )

        # 2. DEPLOYMENT RISK CLASSIFICATION
        risks = []
        high = medium = low = 0

        for _, row in df.iterrows():
            score = 0
            reasons = []

            if row["status"] == "Failed":
                score += 60
                reasons.append("Deployment failed")

            if row["duration_minutes"] > median_duration * 1.5:
                score += 25
                reasons.append("Unusually long deployment")

            if row["changed_files"] > median_files * 1.5:
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

            risks.append({
                "deployment_id": str(row["deployment_id"]),
                "project": str(row["project"]),
                "status": str(row["status"]),
                "duration": round(float(row["duration_minutes"]), 2),
                "score": score,
                "level": level,
                "reasons": reasons or ["No major risk indicators"]
            })

        risks.sort(key=lambda x: x["score"], reverse=True)

        # 3. PERFORMANCE ANALYSIS
        slow_deployments = [
            item for item in risks
            if item["duration"] > median_duration * 1.5
        ]

        # 4. SMART RECOMMENDATIONS
        recommendations = []

        for project in project_analysis:
            if project["repeated_failures"]:
                recommendations.append({
                    "priority": "HIGH",
                    "title": f"Investigate {project['project']}",
                    "detail": (
                        f"{project['failed']} failed deployments detected. "
                        "Review logs, recent changes and test results."
                    )
                })
            elif project["failure_rate"] > 0:
                recommendations.append({
                    "priority": "MEDIUM",
                    "title": f"Review {project['project']}",
                    "detail": (
                        f"Failure rate is {project['failure_rate']}%. "
                        "Inspect the failed deployment records."
                    )
                })

        if slow_deployments:
            recommendations.append({
                "priority": "MEDIUM",
                "title": "Investigate slow deployments",
                "detail": (
                    f"{len(slow_deployments)} deployments took more than "
                    "1.5 times the median deployment duration."
                )
            })

        if not recommendations:
            recommendations.append({
                "priority": "LOW",
                "title": "No major issues detected",
                "detail": "Continue monitoring deployment performance."
            })

        return jsonify({
            "success": True,
            "projects": project_analysis,
            "risks": risks,
            "recommendations": recommendations,
            "summary": {
                "high": high,
                "medium": medium,
                "low": low,
                "median_duration": round(median_duration, 2),
                "slow_count": len(slow_deployments)
            }
        })

    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 400



if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
