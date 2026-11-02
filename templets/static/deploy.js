
document.addEventListener("DOMContentLoaded", () => {
    const $ = id => document.getElementById(id);

    let deployments = [];
    let statusChart = null;
    let durationChart = null;
    let searchTimer;

    const columns = [
        "deployment_id", "project", "environment", "duration_minutes",
        "status", "tests_passed", "commit_count", "changed_files", "date"
    ];

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;",
            '"': "&quot;", "'": "&#39;"
        })[char]);
    }

    function showMessage(id, text, error = false) {
        const element = $(id);
        if (!element) return;
        element.textContent = text;
        element.classList.toggle("error-message", error);
    }

    // Navigation
    function showPage(name) {
        document.querySelectorAll(".page").forEach(page => {
            page.classList.toggle("active", page.id === name);
        });

        document.querySelectorAll("[data-page]").forEach(button => {
            button.classList.toggle("active", button.dataset.page === name);
        });
    }

    document.querySelectorAll("[data-page]").forEach(button => {
        button.addEventListener("click", () => showPage(button.dataset.page));
    });

    document.querySelectorAll("[data-goto]").forEach(button => {
        button.addEventListener("click", () => showPage(button.dataset.goto));
    });

    // Filters
    function getFilters() {
        const params = new URLSearchParams();

        if ($("projectFilter").value)
            params.set("project", $("projectFilter").value);

        if ($("environmentFilter").value)
            params.set("environment", $("environmentFilter").value);

        if ($("statusFilter").value)
            params.set("status", $("statusFilter").value);

        if ($("searchInput").value.trim())
            params.set("search", $("searchInput").value.trim());

        return params.toString();
    }

    function populateSelect(id, values, label) {
        const select = $(id);
        const oldValue = select.value;

        select.innerHTML = `<option value="">${label}</option>` +
            values.map(value =>
                `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`
            ).join("");

        if (values.includes(oldValue)) select.value = oldValue;
    }

    // Tables
    function renderTable(id, data) {
        const body = $(id);

        if (!data.length) {
            body.innerHTML = `<tr><td colspan="9">No records found.</td></tr>`;
            return;
        }

        body.innerHTML = data.map(item => `
            <tr>
                <td>${escapeHTML(item.deployment_id)}</td>
                <td>${escapeHTML(item.project)}</td>
                <td>${escapeHTML(item.environment)}</td>
                <td>${escapeHTML(item.duration_minutes)}</td>
                <td><span class="status-badge ${item.status === "Success" ? "success" : "failed"}">${escapeHTML(item.status)}</span></td>
                <td>${escapeHTML(item.tests_passed)}</td>
                <td>${escapeHTML(item.commit_count)}</td>
                <td>${escapeHTML(item.changed_files)}</td>
                <td>${escapeHTML(item.date)}</td>
            </tr>
        `).join("");
    }

    // Charts
    function updateCharts(data) {
        if (!window.Chart) return;

        const success = data.filter(x => x.status === "Success").length;
        const failed = data.length - success;

        if (statusChart) statusChart.destroy();

        statusChart = new Chart($("statusChart"), {
            type: "doughnut",
            data: {
                labels: ["Success", "Failed"],
                datasets: [{
                    data: [success, failed],
                    backgroundColor: ["#222222", "#b8b8b1"],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } }
            }
        });

        const projects = {};

        data.forEach(item => {
            const name = item.project || "Unknown";
            if (!projects[name]) projects[name] = { total: 0, count: 0 };

            projects[name].total += Number(item.duration_minutes) || 0;
            projects[name].count++;
        });

        if (durationChart) durationChart.destroy();

        durationChart = new Chart($("durationChart"), {
            type: "bar",
            data: {
                labels: Object.keys(projects),
                datasets: [{
                    label: "Average Duration",
                    data: Object.values(projects).map(x =>
                        Number((x.total / x.count).toFixed(2))
                    ),
                    backgroundColor: "#555555"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    // Dashboard API
    async function loadDashboard() {
        try {
            const response = await fetch("/api/dashboard?" + getFilters());
            const result = await response.json();

            if (!response.ok || !result.success)
                throw new Error(result.error || "Dashboard loading failed.");

            deployments = result.deployments;
            const m = result.metrics;

            const values = {
                totalDeployments: m.total,
                successfulDeployments: m.successful,
                failedDeployments: m.failed,
                successRate: m.success_rate + "%",
                avgDuration: m.avg_duration + " min",
                analyticsSuccess: m.successful,
                analyticsFailed: m.failed,
                analyticsRate: m.success_rate + "%"
            };

            Object.entries(values).forEach(([id, value]) => {
                if ($(id)) $(id).textContent = value;
            });

            $("healthScore").innerHTML =
                `${escapeHTML(m.health_score)}<small>/100</small>`;

            $("riskPill").textContent = m.risk;
            $("healthFill").style.width = m.health_score + "%";

            $("insights").innerHTML = `
                <div class="insight">${m.successful} successful deployments.</div>
                <div class="insight">${m.failed} failed deployments.</div>
                <div class="insight">Average duration: ${m.avg_duration} minutes.</div>
            `;

            renderTable("overviewTableBody", deployments.slice(0, 8));
            renderTable("deploymentTableBody", deployments);
            renderTable("explorerTableBody", deployments);

            $("deploymentCount").textContent = deployments.length + " RECORDS";
            $("datasetInfo").textContent = deployments.length + " RECORDS";

            $("explorerTableHead").innerHTML = `
                <tr>${columns.map(c => `<th>${escapeHTML(c.toUpperCase())}</th>`).join("")}</tr>
            `;

            populateSelect("projectFilter", result.filters.projects, "ALL PROJECTS");
            populateSelect("environmentFilter", result.filters.environments, "ALL ENVIRONMENTS");
            populateSelect("statusFilter", result.filters.statuses, "ALL STATUSES");

            updateCharts(deployments);
            await loadRiskAnalysis();

        } catch (error) {
            console.error(error);
            showMessage("monitorMessage", error.message, true);
        }
    }

// DEPLOYMENT RISK ANALYSIS ENGINE

async function loadRiskAnalysis() {
    try {
        const response = await fetch("/api/risk-analysis?" + getFilters());
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || "Risk analysis failed.");
        }

        const summary = result.summary;

        // Risk summary cards
        $("highRiskCount").textContent = summary.high;
        $("mediumRiskCount").textContent = summary.medium;
        $("lowRiskCount").textContent = summary.low;

        // Failure pattern detection
        $("failurePatternBody").innerHTML =
            result.projects.length
                ? result.projects.map(project => `
                    <tr>
                        <td>${escapeHTML(project.project)}</td>
                        <td>${project.total}</td>
                        <td>${project.failed}</td>
                        <td>${project.failure_rate}%</td>
                        <td>
                            <span class="risk-level ${
                                project.repeated_failures ? "HIGH" : "LOW"
                            }">
                                ${project.repeated_failures
                                    ? "REPEATED"
                                    : "NORMAL"}
                            </span>
                        </td>
                    </tr>
                `).join("")
                : `<tr><td colspan="5">No project records found.</td></tr>`;

        // Performance analysis
        $("slowDeploymentCount").textContent = summary.slow_count;

        $("medianDuration").textContent =
            `MEDIAN DURATION: ${summary.median_duration} MIN`;

        $("performanceMessage").textContent =
            summary.slow_count > 0
                ? `${summary.slow_count} deployments took more than 1.5 times the median duration. Investigate their logs and build processes.`
                : "No unusually slow deployments detected.";

        // Risk registry
        $("riskTableBody").innerHTML =
            result.risks.length
                ? result.risks.map(item => `
                    <tr>
                        <td>${escapeHTML(item.deployment_id)}</td>
                        <td>${escapeHTML(item.project)}</td>
                        <td>${escapeHTML(item.status)}</td>
                        <td>${item.duration} min</td>
                        <td>${item.score}/100</td>
                        <td>
                            <span class="risk-level ${item.level}">
                                ${item.level}
                            </span>
                        </td>
                        <td>${item.reasons.map(escapeHTML).join(", ")}</td>
                    </tr>
                `).join("")
                : `<tr><td colspan="7">No deployments found.</td></tr>`;

        // Smart recommendations
        $("recommendationsList").innerHTML =
            result.recommendations.map(item => `
                <div class="recommendation-item">
                    <span class="recommendation-priority ${item.priority}">
                        ${escapeHTML(item.priority)}
                    </span>
                    <div>
                        <strong>${escapeHTML(item.title)}</strong>
                        <p>${escapeHTML(item.detail)}</p>
                    </div>
                </div>
            `).join("");

        showMessage(
            "riskAnalysisMessage",
            "Risk analysis completed successfully."
        );

    } catch (error) {
        console.error("Risk analysis error:", error);
        showMessage("riskAnalysisMessage", error.message, true);
    }
}


    // Filter events
    ["projectFilter", "environmentFilter", "statusFilter"].forEach(id => {
        $(id).addEventListener("change", loadDashboard);
    });

    $("searchInput").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadDashboard, 300);
    });

    $("refreshBtn").addEventListener("click", loadDashboard);

    // CSV upload
    $("uploadForm").addEventListener("submit", async event => {
        event.preventDefault();

        const file = $("csvFile").files[0];

        if (!file) {
            showMessage("uploadMessage", "Please select a CSV file.", true);
            return;
        }

        const formData = new FormData();
        formData.append("file", file);

        try {
            showMessage("uploadMessage", "Uploading CSV...");

            const response = await fetch("/api/upload", {
                method: "POST",
                body: formData
            });

            const result = await response.json();

            if (!response.ok || !result.success)
                throw new Error(result.error || "Upload failed.");

            showMessage(
                "uploadMessage",
                `${result.message} Records: ${result.records}`
            );

            ["projectFilter", "environmentFilter", "statusFilter", "searchInput"]
                .forEach(id => $(id).value = "");

            await loadDashboard();

        } catch (error) {
            showMessage("uploadMessage", error.message, true);
        }
    });

    $("resetDatasetBtn").addEventListener("click", async () => {
        const response = await fetch("/api/reset-dataset", { method: "POST" });
        const result = await response.json();
        showMessage("uploadMessage", result.message);
        await loadDashboard();
    });

    // Download helper
    function downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = filename;
        link.click();

        URL.revokeObjectURL(url);
    }

    // CSV export
    $("exportCsvBtn").addEventListener("click", () => {
        if (!deployments.length) {
            showMessage("reportMessage", "No data to export.", true);
            return;
        }

        const csv = [
            columns.join(","),
            ...deployments.map(row =>
                columns.map(col =>
                    `"${String(row[col] ?? "").replace(/"/g, '""')}"`
                ).join(",")
            )
        ].join("\r\n");

        downloadFile(csv, "deploywatch-report.csv", "text/csv");
        showMessage("reportMessage", "CSV exported successfully.");
    });

    // HTML report export
    $("exportHtmlBtn").addEventListener("click", () => {
        if (!deployments.length) {
            showMessage("reportMessage", "No data to export.", true);
            return;
        }

        const tableRows = deployments.map(row =>
            `<tr>${columns.map(col => `<td>${escapeHTML(row[col])}</td>`).join("")}</tr>`
        ).join("");

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>DeployWatch Report</title>
                <style>
                    body{font-family:Arial;padding:30px;color:#111}
                    h1{letter-spacing:3px}
                    table{border-collapse:collapse;width:100%}
                    td,th{border:1px solid #ccc;padding:9px;text-align:left}
                    th{background:#111;color:white}
                </style>
            </head>
            <body>
                <h1>DEPLOYWATCH</h1>
                <p>BLACK//OPS — Deployment Intelligence Report</p>
                <table>
                    <thead><tr>${columns.map(c => `<th>${c}</th>`).join("")}</tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </body>
            </html>
        `;

        downloadFile(html, "deploywatch-report.html", "text/html");
        showMessage("reportMessage", "HTML report exported successfully.");
    });

    // Dataset check
    $("checkMonitorBtn").addEventListener("click", async () => {
        showMessage("monitorMessage", "Checking dataset...");
        await loadDashboard();
        showMessage(
            "monitorMessage",
            `Dataset check completed. ${deployments.length} records loaded.`
        );
    });

    showPage("overview");
    loadDashboard();
});
