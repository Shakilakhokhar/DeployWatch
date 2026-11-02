# DeployWatch

**Data-Driven Deployment Health Analyzer** built with Streamlit.
DeployWatch reads deployment records, scores the health of your delivery
pipeline, flags risky projects and unusual durations, exports reports and
monitors a folder for new records.

## Features

| Page | What it does |
|------|--------------|
| **Overview** | KPIs, daily trend, health gauge, automated insight, latest deployments, **Health Score (0-100)** with **Healthy / Warning / Critical** risk and automated insights |
| **Deployments** | Full deployment registry with CSV export |
| **Analytics** | Statistical summary, failure trends, risky project ranking, environment failures, unusual duration detection |
| **Data Explorer** | Dataset records, data quality check, CSV export |
| **Reports** | Downloadable HTML health report, ZIP package, CSV summary tables, PNG charts |
| **Monitoring** | Watches `data/incoming/` and merges new CSV files automatically, with alerts and health history |

Sidebar filters (project, environment, status), search and custom CSV upload
apply across the app.

## Requirements

- Python 3.9 or newer
- Packages in `requirements.txt`

## Setup and run

```bash
pip install -r requirements.txt
streamlit run deploy.py
```

Run the command from the project folder, because the app reads
`data/deployments.csv` using a relative path. The app opens at
http://localhost:8501.

## Project structure

```
DeployWatch/
|-- deploy.py                 # the whole app
|-- requirements.txt
|-- README.md
`-- data/
    |-- deployments.csv       # main dataset (required)
    |-- incoming/             # drop new CSV files here (auto-created)
    |-- processed/            # files that were merged
    |-- rejected/             # files that failed validation
    |-- backups/              # dataset backup before every merge
    `-- monitor_log.csv       # import history used by Monitoring
```

## CSV format

Every CSV (main dataset, uploads and incoming files) needs these columns:

| Column | Rule |
|--------|------|
| `deployment_id` | Unique ID, for example `DW-1001` |
| `project` | Project name |
| `environment` | For example `Production`, `Staging`, `Testing` |
| `duration_minutes` | Positive number |
| `status` | Exactly `Success` or `Failed` |
| `tests_passed` | Number |
| `commit_count` | Number |
| `changed_files` | Number |
| `date` | A valid date, for example `2026-11-02` |

A ready example is in `sample_incoming_batch.csv`.

## How the Health Score works

The score is out of 100 and is calculated in `compute_health()`:

| Part | Max points | Based on |
|------|-----------:|----------|
| Success rate | 60 | Share of successful deployments |
| Duration stability | 20 | Share of deployments within 1.5x the median duration |
| Recent trend | 20 | Success rate of the latest 5 deployments |

Risk level: **Healthy** 80 and above, **Warning** 60 to 79, **Critical** below 60.
Change the weights or cutoffs inside `compute_health()` to fit your team.

## Automated monitoring

1. Open the **Monitoring** page.
2. Turn on **AUTO-MONITOR** (checks every 10 seconds) or press
   **CHECK INCOMING FOLDER NOW**.
3. Copy a CSV into `data/incoming/`, or upload one on the same page.
4. DeployWatch validates the file, skips duplicate `deployment_id` values,
   merges the new rows into `data/deployments.csv`, refreshes every metric
   and records alerts (new failures, risk change, score change, rejected
   files).

Notes:

- Auto-monitor runs while the Monitoring page is open in the browser.
- Invalid files are moved to `data/rejected/` and reported as an alert.
- A custom CSV uploaded from the sidebar replaces the dashboard view until
  the app is reloaded. Monitoring always updates the main dataset file.

## Reports

On the **Reports** page, download:

- **Health report (HTML)**: open it in a browser and press `Ctrl+P` to save
  it as a PDF.
- **Full package (ZIP)**: report, CSV tables and charts together.
- **CSV tables**: project summary, environment summary, duration outliers,
  filtered records.
- **PNG charts**: failure trend, deployment trend, project duration,
  environment failures, health gauge.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Dataset loading error` | Check that `data/deployments.csv` exists and has all required columns |
| `streamlit` not recognized | Run `python -m streamlit run deploy.py` |
| `IndentationError` after editing | Use 4 spaces, never tabs |
| HTML shows as plain text | Do not put blank lines or 4+ leading spaces inside `st.markdown` HTML |
| Sidebar arrow missing | Use the latest `deploy.py` (arrow is styled to stay visible) |

## Tech stack

Streamlit, pandas, NumPy, Matplotlib. Design system: BLACK//OPS
(Manrope and Space Mono fonts).