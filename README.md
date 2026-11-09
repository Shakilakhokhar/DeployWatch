# DeployWatch | Data-Driven Deployment Health Analyzer

**DeployWatch** is a Flask-based deployment intelligence platform that analyzes deployment records, monitors delivery health, identifies deployment risks, and investigates deployment failures.

It provides an interactive web dashboard for exploring deployment metrics, uploading CSV datasets, performing risk analysis, investigating failures, and generating reports.

## Features

### 1. Smart CSV Analyzer
- Upload deployment datasets through the dashboard.
- Automatically inspect and analyze available CSV columns.
- Handle datasets with missing optional metric columns.
- Dynamically display available data in dashboard tables.
- Calculate deployment statistics using available records.
- Validate uploaded datasets before processing.

### 2. Deployment Forensics
- Investigate failed deployments.
- Analyze deployment failure patterns.
- Display failure counts and failure rates.
- Examine deployment timelines.
- Identify probable failure causes.
- Compare deployment outcomes through forensic analysis.

### 3. Login & Registration
- Create a DeployWatch account.
- Sign in using account credentials.
- Maintain authenticated user sessions.
- Log out securely through the application interface.

### 4. Deployment Analytics
- View total, successful, and failed deployments.
- Calculate deployment success rates.
- Visualize deployment performance.
- Analyze deployment durations.
- Explore deployment risk indicators.

### 5. Deployment Risk Analysis
- Analyze deployment reliability.
- Identify risky deployment records.
- Highlight potential deployment issues.
- Review risk analysis results through the dashboard.

### 6. Data Explorer
- Explore deployment records.
- Inspect available dataset columns.
- Review deployment information in tabular form.

### 7. Reports & Export
- Export deployment records as CSV.
- Generate downloadable HTML analytical reports.

### 8. System Monitoring
- Upload deployment datasets.
- Inspect application and analytics status.
- Access dataset management and monitoring controls.

---

## Technology Stack

| Category | Technologies |
|---|---|
| Backend | Python, Flask |
| Frontend | HTML5, CSS3, JavaScript |
| Data Analysis | Pandas, NumPy |
| Visualization | Matplotlib |
| Database | SQLite |
| Containerization | Docker, Docker Compose |
| CI | GitHub Actions |
| Cloud Deployment | Render |
| Version Control | Git, GitHub |

**Design System:** BLACK//OPS, using Manrope and Space Mono typography.

---

## Project Structure

```text
DeployWatch/
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── data/
│   ├── deployments.csv
│   ├── deployments2.csv
│   ├── incoming/
│   ├── backups/
│   └── processed/
│
├── src/
│   ├── analyze_data.py
│   ├── inspect_data.py
│   └── visualize_data.py
│
├── templets/
│   ├── main.html
│   └── static/
│       ├── deploy.js
│       └── style.css
│
├── deploy.py
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .dockerignore
├── .gitignore
└── README.md
```

---

## Requirements

- Python 3.12
- Git
- Docker (optional, for containerized execution)

Dependencies are listed in `requirements.txt`.

## Installation and Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/Shakilakhokhar/DeployWatch.git
cd DeployWatch
```

### 2. Create a virtual environment

Linux / WSL:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the application

```bash
python deploy.py
```

Open the application in your browser:

```text
http://127.0.0.1:5000
```

---

## Running with Docker

DeployWatch supports Docker-based execution.

### Build and start using Docker Compose

```bash
docker compose up --build -d
```

### Check running containers

```bash
docker compose ps
```

### View application logs

```bash
docker compose logs -f
```

### Stop the application

```bash
docker compose down
```

The application is accessible at:

```text
http://localhost:5000
```

---

## Continuous Integration

DeployWatch uses **GitHub Actions** for continuous integration.

The CI workflow:

1. Checks out the repository.
2. Sets up Python 3.12.
3. Installs project dependencies.
4. Checks Python source syntax.
5. Verifies required application files.

Workflow location:

```text
.github/workflows/ci.yml
```

The workflow runs on pushes and pull requests targeting the `main` and `dev` branches.

---

## Cloud Deployment

DeployWatch is configured for Docker-based deployment on **Render**.

- Source: GitHub repository
- Deployment method: Docker
- Application entry point: `deploy.py`
- Port: `5000`
- Deployment source: `main` branch

Live application:

**https://deploywatch-3mzi.onrender.com/**

When automatic deployment is enabled, new