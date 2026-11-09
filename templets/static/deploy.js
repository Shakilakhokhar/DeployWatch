
document.addEventListener("DOMContentLoaded", () => {
    const $ = id => document.getElementById(id);

    // ==================================================
    // APPLICATION STATE
    // ==================================================

    let deployments = [];
    let columns = [];
    let statusChart = null;
    let durationChart = null;
    let searchTimer = null;
    let currentUser = null;
    let currentPage = "overview";
    let authMode = "login";
    let forensicsLoading = false;

    const DEFAULT_COLUMNS = [
        "deployment_id",
        "project",
        "environment",
        "duration_minutes",
        "status",
        "tests_passed",
        "commit_count",
        "changed_files",
        "date"
    ];

    // ==================================================
    // GENERAL HELPERS
    // ==================================================

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    function showMessage(id, message, error = false) {
        const element = $(id);
        if (!element) return;

        element.textContent = message ?? "";
        element.classList.toggle("error-message", error);
    }

    function setText(id, value) {
        const element = $(id);
        if (element) element.textContent = value ?? "";
    }

    function setHTML(id, html) {
        const element = $(id);
        if (element) element.innerHTML = html;
    }

    function formatValue(value) {
        if (value === null || value === undefined || value === "") {
            return "—";
        }
        return String(value);
    }

    function normalizeStatus(value) {
        return String(value ?? "").trim().toLowerCase();
    }

    function isSuccess(value) {
        return normalizeStatus(value) === "success";
    }

    function isFailed(value) {
        return normalizeStatus(value) === "failed";
    }

    function getErrorMessage(result, fallback) {
        return result?.error || result?.message || fallback;
    }

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options
        });

        let result;

        try {
            result = await response.json();
        } catch {
            throw new Error("The server returned an invalid response.");
        }

        if (response.status === 401) {
            currentUser = null;
            showAuthScreen();
            throw new Error("Your session has expired. Please sign in.");
        }

        if (!response.ok || result.success === false) {
            throw new Error(
                getErrorMessage(result, "The request could not be completed.")
            );
        }

        return result;
    }

    function destroyCharts() {
        if (statusChart) {
            statusChart.destroy();
            statusChart = null;
        }

        if (durationChart) {
            durationChart.destroy();
            durationChart = null;
        }
    }

    // ==================================================
    // AUTHENTICATION INTERFACE
    // ==================================================

    function createAuthScreen() {
        if ($("authOverlay")) return;

        const overlay = document.createElement("div");

        overlay.id = "authOverlay";
        overlay.className = "auth-overlay";

        overlay.innerHTML = `
            <div class="auth-panel">
                <div class="auth-brand">
                    <span class="auth-brand-mark">DW</span>
                    <span>DEPLOYWATCH</span>
                </div>

                <div class="auth-heading">
                    <span class="auth-eyebrow">
                        DEPLOYMENT INTELLIGENCE
                    </span>

                    <h1 id="authHeading">Welcome back.</h1>

                    <p id="authDescription">
                        Sign in to access your deployment dashboard.
                    </p>
                </div>

                <form id="authForm" class="auth-form">

                    <div id="usernameGroup" class="auth-field" hidden>
                        <label for="authUsername">USERNAME</label>

                        <input
                            id="authUsername"
                            type="text"
                            autocomplete="username"
                            minlength="3"
                            maxlength="40"
                            placeholder="Enter username"
                        >
                    </div>

                    <div class="auth-field">
                        <label id="authIdentifierLabel" for="authEmail">
                            USERNAME OR EMAIL
                        </label>

                        <input
                            id="authEmail"
                            type="text"
                            autocomplete="username"
                            placeholder="Enter username or email"
                            required
                        >
                    </div>

                    <div class="auth-field">
                        <label for="authPassword">PASSWORD</label>

                        <input
                            id="authPassword"
                            type="password"
                            autocomplete="current-password"
                            placeholder="Enter password"
                            required
                        >
                    </div>

                    <div id="authConfirmGroup" class="auth-field" hidden>
                        <label for="authConfirmPassword">
                            CONFIRM PASSWORD
                        </label>

                        <input
                            id="authConfirmPassword"
                            type="password"
                            autocomplete="new-password"
                            placeholder="Confirm password"
                        >
                    </div>

                    <p id="authMessage" class="auth-message"></p>

                    <button
                        id="authSubmitBtn"
                        type="submit"
                        class="auth-submit"
                    >
                        SIGN IN
                    </button>
                </form>

                <p class="auth-switch">
                    <span id="authSwitchText">New to DeployWatch?</span>

                    <button id="authSwitchBtn" type="button">
                        Create account
                    </button>
                </p>

                <div class="auth-footer">
                    DEPLOYWATCH // SECURE ACCESS
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        $("authForm").addEventListener("submit", handleAuthSubmit);

        $("authSwitchBtn").addEventListener("click", () => {
            setAuthMode(authMode === "login" ? "register" : "login");
        });
    }

    function setAuthMode(mode) {
        authMode = mode;

        const registering = mode === "register";

        $("authHeading").textContent = registering
            ? "Create your account."
            : "Welcome back.";

        $("authDescription").textContent = registering
            ? "Register to access your deployment intelligence workspace."
            : "Sign in to access your deployment dashboard.";

        $("usernameGroup").hidden = !registering;
        $("authConfirmGroup").hidden = !registering;

        $("authIdentifierLabel").textContent = registering
            ? "EMAIL ADDRESS"
            : "USERNAME OR EMAIL";

        $("authEmail").placeholder = registering
            ? "Enter email address"
            : "Enter username or email";

        $("authPassword").autocomplete = registering
            ? "new-password"
            : "current-password";

        $("authSubmitBtn").textContent = registering
            ? "CREATE ACCOUNT"
            : "SIGN IN";

        $("authSwitchText").textContent = registering
            ? "Already registered?"
            : "New to DeployWatch?";

        $("authSwitchBtn").textContent = registering
            ? "Sign in"
            : "Create account";

        $("authMessage").textContent = "";
        $("authMessage").classList.remove("error-message");

        $("authForm").reset();
    }

    function showAuthScreen() {
        createAuthScreen();

        const overlay = $("authOverlay");

        if (overlay) {
            overlay.classList.remove("auth-hidden");
        }

        setAuthMode("login");

        const account = $("accountControl");

        if (account) {
            account.classList.remove("account-visible");
        }
    }

    function hideAuthScreen() {
        const overlay = $("authOverlay");

        if (overlay) {
            overlay.classList.add("auth-hidden");
        }
    }

    async function handleAuthSubmit(event) {
        event.preventDefault();

        const username = $("authUsername").value.trim();
        const identifier = $("authEmail").value.trim();
        const password = $("authPassword").value;
        const confirmPassword = $("authConfirmPassword").value;

        const message = $("authMessage");
        const button = $("authSubmitBtn");

        message.textContent = "";
        message.classList.remove("error-message");

        if (authMode === "register") {
            if (!username || !identifier || !password) {
                message.textContent = "Please complete all required fields.";
                return;
            }

            if (password !== confirmPassword) {
                message.textContent = "Passwords do not match.";
                message.classList.add("error-message");
                return;
            }

            if (password.length < 8) {
                message.textContent =
                    "Password must contain at least 8 characters.";
                message.classList.add("error-message");
                return;
            }
        }

        button.disabled = true;
        button.textContent = "PLEASE WAIT...";

        try {
            if (authMode === "register") {
                await apiRequest("/api/auth/register", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        username,
                        email: identifier,
                        password
                    })
                });

                setAuthMode("login");

                $("authEmail").value = username;

                message.textContent =
                    "Account created successfully. Please sign in.";

                return;
            }

            // Flask auth_login expects the key "username".
            // It accepts either a username or an email address.
            const result = await apiRequest("/api/auth/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: identifier,
                    password
                })
            });

            currentUser = result.user || null;

            hideAuthScreen();
            updateAccountControl();

            showPage("overview");

            await loadDashboard();

        } catch (error) {
            message.textContent = error.message;
            message.classList.add("error-message");

        } finally {
            button.disabled = false;

            button.textContent = authMode === "register"
                ? "CREATE ACCOUNT"
                : "SIGN IN";
        }
    }

    // ==================================================
    // ACCOUNT CONTROL
    // ==================================================

   function createAccountControl() {
    let control = $("accountControl");

    if (!control) {
        control = document.createElement("div");
        control.id = "accountControl";
        control.className = "account-control";

        const sidebar = document.querySelector(".sidebar");

        if (sidebar) {
            sidebar.appendChild(control);
        } else {
            document.body.appendChild(control);
        }
    }

    if (!$("accountUsername")) {
        const username = document.createElement("span");
        username.id = "accountUsername";
        control.appendChild(username);
    }

    if (!$("logoutBtn")) {
        const button = document.createElement("button");
        button.id = "logoutBtn";
        button.type = "button";
        button.textContent = "LOG OUT";
        control.appendChild(button);
    }

    const logoutButton = $("logoutBtn");

    if (!logoutButton.dataset.bound) {
        logoutButton.addEventListener("click", logout);
        logoutButton.dataset.bound = "true";
    }
}

    function updateAccountControl() {
        createAccountControl();

        setText(
            "accountUsername",
            currentUser?.username || "Account"
        );

        $("accountControl").classList.toggle(
            "account-visible",
            Boolean(currentUser)
        );
    }

    async function logout() {
        const button = $("logoutBtn");

        if (button) button.disabled = true;

        try {
            await apiRequest("/api/auth/logout", {
                method: "POST"
            });

            currentUser = null;
            deployments = [];
            columns = [];

            destroyCharts();

            showAuthScreen();

        } catch (error) {
            console.error("Logout error:", error);

        } finally {
            if (button) button.disabled = false;
        }
    }

    async function checkAuthentication() {
        try {
            const result = await apiRequest("/api/auth/session");

            if (!result.authenticated || !result.user) {
                showAuthScreen();
                return false;
            }

            currentUser = result.user;

            hideAuthScreen();
            updateAccountControl();

            return true;

        } catch (error) {
            console.error("Authentication check:", error);

            showAuthScreen();

            return false;
        }
    }

    // ==================================================
    // NAVIGATION
    // ==================================================

    function showPage(name) {
        const target = $(name);

        if (!target) return;

        currentPage = name;

       document.querySelectorAll(".page-section").forEach(page => {
       page.classList.toggle("active", page.id === name);
        });

        document.querySelectorAll("[data-page]").forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.page === name
            );
        });

        if (name === "forensics") {
            loadForensics();
        }
    }

    document.querySelectorAll("[data-page]").forEach(button => {
        button.addEventListener("click", () => {
            showPage(button.dataset.page);
        });
    });

    document.querySelectorAll("[data-goto]").forEach(button => {
        button.addEventListener("click", () => {
            showPage(button.dataset.goto);
        });
    });

    // ==================================================
    // FILTERS
    // ==================================================

    function getFilters() {
        const params = new URLSearchParams();

        const project = $("projectFilter")?.value;
        const environment = $("environmentFilter")?.value;
        const status = $("statusFilter")?.value;
        const search = $("searchInput")?.value.trim();

        if (project) params.set("project", project);
        if (environment) params.set("environment", environment);
        if (status) params.set("status", status);
        if (search) params.set("search", search);

        return params.toString();
    }

    function populateSelect(id, values, label) {
        const select = $(id);
        if (!select) return;

        const oldValue = select.value;

        select.innerHTML = `
            <option value="">${escapeHTML(label)}</option>

            ${(values || []).map(value => `
                <option value="${escapeHTML(value)}">
                    ${escapeHTML(value)}
                </option>
            `).join("")}
        `;

        if ((values || []).includes(oldValue)) {
            select.value = oldValue;
        }
    }

    // ==================================================
    // SMART CSV ANALYZER: DYNAMIC TABLES
    // ==================================================

    function getAvailableColumns(data) {
        if (columns.length) return columns;

        if (data.length) {
            return Object.keys(data[0]);
        }

        return DEFAULT_COLUMNS;
    }

    function renderTableHead(tableBodyId, selectedColumns) {
        const body = $(tableBodyId);
        const table = body?.closest("table");
        const row = table?.querySelector("thead tr");

        if (!row) return;

        row.innerHTML = selectedColumns.map(column => `
            <th>${escapeHTML(
                column.replace(/_/g, " ").toUpperCase()
            )}</th>
        `).join("");
    }

    function renderTable(id, data, selectedColumns = columns) {
        const body = $(id);
        if (!body) return;

        renderTableHead(id, selectedColumns);

        if (!data.length) {
            body.innerHTML = `
                <tr>
                    <td colspan="${Math.max(selectedColumns.length, 1)}">
                        No records found.
                    </td>
                </tr>
            `;
            return;
        }

        body.innerHTML = data.map(item => `
            <tr>
                ${selectedColumns.map(column => {
                    const value = item[column];

                    if (column === "status") {
                        const statusClass = isSuccess(value)
                            ? "success"
                            : isFailed(value)
                                ? "failed"
                                : "";

                        return `
                            <td>
                                <span class="status-badge ${statusClass}">
                                    ${escapeHTML(formatValue(value))}
                                </span>
                            </td>
                        `;
                    }

                    return `
                        <td>${escapeHTML(formatValue(value))}</td>
                    `;
                }).join("")}
            </tr>
        `).join("");
    }

    function renderDynamicTableHead() {
        const head = $("explorerTableHead");
        if (!head) return;

        head.innerHTML = `
            <tr>
                ${columns.map(column => `
                    <th>${escapeHTML(
                        column.replace(/_/g, " ").toUpperCase()
                    )}</th>
                `).join("")}
            </tr>
        `;
    }

    function renderAllTables(data) {
        columns = getAvailableColumns(data);

        renderDynamicTableHead();

        renderTable(
            "overviewTableBody",
            data.slice(0, 8),
            columns.slice(0, 9)
        );

        renderTable(
            "deploymentTableBody",
            data,
            columns
        );

        renderTable(
            "explorerTableBody",
            data,
            columns
        );
    }

    // ==================================================
    // CHARTS
    // ==================================================

    function updateCharts(data) {
        if (!window.Chart) return;

        const statusCanvas = $("statusChart");
        const durationCanvas = $("durationChart");

        if (!statusCanvas || !durationCanvas) return;

        const success = data.filter(
            item => isSuccess(item.status)
        ).length;

        const failed = data.filter(
            item => isFailed(item.status)
        ).length;

        if (statusChart) statusChart.destroy();

        statusChart = new Chart(statusCanvas, {
            type: "doughnut",

            data: {
                labels: ["Success", "Failed"],

                datasets: [{
                    data: [success, failed],

                    backgroundColor: [
                        "#222222",
                        "#b8b8b1"
                    ],

                    borderWidth: 0
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        position: "bottom"
                    }
                }
            }
        });

        const projects = {};

        data.forEach(item => {
            const name = item.project || "Unknown";
            const duration = Number(item.duration_minutes);

            if (!Number.isFinite(duration)) return;

            if (!projects[name]) {
                projects[name] = {
                    total: 0,
                    count: 0
                };
            }

            projects[name].total += duration;
            projects[name].count++;
        });

        if (durationChart) durationChart.destroy();

        durationChart = new Chart(durationCanvas, {
            type: "bar",

            data: {
                labels: Object.keys(projects),

                datasets: [{
                    label: "Average Duration",

                    data: Object.values(projects).map(project =>
                        Number(
                            (project.total / project.count).toFixed(2)
                        )
                    ),

                    backgroundColor: "#555555"
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        display: false
                    }
                },

                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    // ==================================================
    // DASHBOARD API
    // ==================================================

    async function loadDashboard() {
        try {
            const query = getFilters();

            const result = await apiRequest(
                "/api/dashboard" + (query ? "?" + query : "")
            );

            deployments = Array.isArray(result.deployments)
                ? result.deployments
                : [];

            // Use the actual columns returned by Flask.
            columns = Array.isArray(result.columns)
                ? result.columns
                : getAvailableColumns(deployments);

            const metrics = result.metrics || {};

            const values = {
                totalDeployments: metrics.total ?? 0,
                successfulDeployments: metrics.successful ?? 0,
                failedDeployments: metrics.failed ?? 0,
                successRate: `${metrics.success_rate ?? 0}%`,
                avgDuration: `${metrics.avg_duration ?? 0} min`,
                analyticsSuccess: metrics.successful ?? 0,
                analyticsFailed: metrics.failed ?? 0,
                analyticsRate: `${metrics.success_rate ?? 0}%`
            };

            Object.entries(values).forEach(([id, value]) => {
                setText(id, value);
            });

            if ($("healthScore")) {
                $("healthScore").innerHTML =
                    `${escapeHTML(metrics.health_score ?? 0)}<small>/100</small>`;
            }

            setText("riskPill", metrics.risk ?? "UNKNOWN");

            if ($("healthFill")) {
                const score = Number(metrics.health_score) || 0;

                $("healthFill").style.width =
                    `${Math.max(0, Math.min(100, score))}%`;
            }

            setHTML("insights", `
                <div class="insight">
                    ${Number(metrics.successful) || 0} successful deployments.
                </div>

                <div class="insight">
                    ${Number(metrics.failed) || 0} failed deployments.
                </div>

                <div class="insight">
                    Average duration:
                    ${escapeHTML(metrics.avg_duration ?? 0)} minutes.
                </div>
            `);

            renderAllTables(deployments);

            setText(
                "deploymentCount",
                `${deployments.length} RECORDS`
            );

            setText(
                "datasetInfo",
                `${deployments.length} RECORDS`
            );

            const filters = result.filters || {};

            populateSelect(
                "projectFilter",
                filters.projects || [],
                "ALL PROJECTS"
            );

            populateSelect(
                "environmentFilter",
                filters.environments || [],
                "ALL ENVIRONMENTS"
            );

            populateSelect(
                "statusFilter",
                filters.statuses || [],
                "ALL STATUSES"
            );

            updateCharts(deployments);

            await loadRiskAnalysis();

            if (currentPage === "forensics") {
                await loadForensics();
            }

        } catch (error) {
            console.error("Dashboard error:", error);

            showMessage(
                "monitorMessage",
                error.message,
                true
            );
        }
    }

    // ==================================================
    // DEPLOYMENT RISK ANALYSIS
    // ==================================================

    async function loadRiskAnalysis() {
        try {
            const query = getFilters();

            const result = await apiRequest(
                "/api/risk-analysis" + (query ? "?" + query : "")
            );

            const summary = result.summary || {};

            setText("highRiskCount", summary.high ?? 0);
            setText("mediumRiskCount", summary.medium ?? 0);
            setText("lowRiskCount", summary.low ?? 0);

            const projects = result.projects || [];

            setHTML(
                "failurePatternBody",

                projects.length
                    ? projects.map(project => `
                        <tr>
                            <td>${escapeHTML(project.project)}</td>
                            <td>${project.total ?? 0}</td>
                            <td>${project.failed ?? 0}</td>
                            <td>${project.failure_rate ?? 0}%</td>

                            <td>
                                <span class="risk-level ${
                                    project.repeated_failures
                                        ? "HIGH"
                                        : "LOW"
                                }">
                                    ${
                                        project.repeated_failures
                                            ? "REPEATED"
                                            : "NORMAL"
                                    }
                                </span>
                            </td>
                        </tr>
                    `).join("")

                    : `
                        <tr>
                            <td colspan="5">
                                No project records found.
                            </td>
                        </tr>
                    `
            );

            setText(
                "slowDeploymentCount",
                summary.slow_count ?? 0
            );

            setText(
                "medianDuration",
                `MEDIAN DURATION: ${summary.median_duration ?? 0} MIN`
            );

            setText(
                "performanceMessage",

                (summary.slow_count || 0) > 0
                    ? `${summary.slow_count} deployments took more than 1.5 times the median duration. Investigate their logs and build processes.`
                    : "No unusually slow deployments detected."
            );

            const risks = result.risks || [];

            setHTML(
                "riskTableBody",

                risks.length
                    ? risks.map(item => `
                        <tr>
                            <td>${escapeHTML(item.deployment_id)}</td>
                            <td>${escapeHTML(item.project)}</td>
                            <td>${escapeHTML(item.status)}</td>
                            <td>${formatValue(item.duration)} min</td>
                            <td>${item.score ?? 0}/100</td>

                            <td>
                                <span class="risk-level ${escapeHTML(item.level)}">
                                    ${escapeHTML(item.level)}
                                </span>
                            </td>

                            <td>
                                ${(item.reasons || [])
                                    .map(reason => escapeHTML(reason))
                                    .join(", ")}
                            </td>
                        </tr>
                    `).join("")

                    : `
                        <tr>
                            <td colspan="7">
                                No deployments found.
                            </td>
                        </tr>
                    `
            );

            const recommendations = result.recommendations || [];

            setHTML(
                "recommendationsList",

                recommendations.map(item => `
                    <div class="recommendation-item">
                        <span class="recommendation-priority ${
                            escapeHTML(item.priority)
                        }">
                            ${escapeHTML(item.priority)}
                        </span>

                        <div>
                            <strong>${escapeHTML(item.title)}</strong>
                            <p>${escapeHTML(item.detail)}</p>
                        </div>
                    </div>
                `).join("")
            );

            showMessage(
                "riskAnalysisMessage",
                "Risk analysis completed successfully."
            );

        } catch (error) {
            console.error("Risk analysis error:", error);

            showMessage(
                "riskAnalysisMessage",
                error.message,
                true
            );
        }
    }

    // ==================================================
    // DEPLOYMENT FORENSICS
    // ==================================================

    async function loadForensics() {
        if (forensicsLoading) return;

        forensicsLoading = true;

        try {
            const query = getFilters();

            const result = await apiRequest(
                "/api/forensics" + (query ? "?" + query : "")
            );

            const summary = result.summary || {};

            setText(
                "forensicsFailureCount",
                summary.total_failures ?? 0
            );

            setText(
                "forensicsFailureRate",
                `${summary.failure_rate ?? 0}%`
            );

            // Failure timeline.
            const timeline = result.timeline || [];

            setHTML(
                "forensicsTimelineBody",

                timeline.length
                    ? timeline.map(item => `
                        <tr>
                            <td>${escapeHTML(item.deployment_id)}</td>
                            <td>${escapeHTML(item.project)}</td>
                            <td>${escapeHTML(item.environment)}</td>
                            <td>${escapeHTML(item.date)}</td>

                            <td>
                                <span class="status-badge failed">
                                    FAILED
                                </span>
                            </td>

                            <td>
                                ${escapeHTML(item.failure_detail)}
                            </td>
                        </tr>
                    `).join("")

                    : `
                        <tr>
                            <td colspan="6">
                                No failure records available.
                            </td>
                        </tr>
                    `
            );

            // Probable causes.
            const causes = result.probable_causes || [];

            setHTML(
                "probableCausesList",

                causes.length
                    ? causes.map(item => `
                        <div class="forensics-cause">
                            <div class="forensics-cause-heading">
                                <strong>
                                    ${escapeHTML(item.cause)}
                                </strong>

                                <span class="forensics-tag ${
                                    escapeHTML(item.type)
                                }">
                                    ${escapeHTML(item.type)}
                                </span>
                            </div>

                            <p>${escapeHTML(item.evidence)}</p>

                            <small>
                                Confidence:
                                ${escapeHTML(item.confidence)}
                            </small>
                        </div>
                    `).join("")

                    : `
                        <p>
                            No probable causes identified from available data.
                        </p>
                    `
            );

            // Historical comparison.
            const comparison = result.comparison || {
                available: false,
                message: "Comparison data is unavailable."
            };

            if (
                comparison.available &&
                comparison.latest &&
                comparison.previous
            ) {
                const latest = comparison.latest;
                const previous = comparison.previous;

                setHTML("forensicsComparison", `
                    <div class="comparison-grid">

                        <div class="comparison-card">
                            <span>LATEST PERIOD</span>

                            <h3>${latest.total ?? 0}</h3>

                            <p>Deployments</p>
                            <p>Failures: ${latest.failed ?? 0}</p>

                            <p>
                                Failure rate:
                                ${latest.failure_rate ?? 0}%
                            </p>

                            <p>
                                Average duration:
                                ${formatValue(latest.average_duration)} min
                            </p>
                        </div>

                        <div class="comparison-card">
                            <span>PREVIOUS PERIOD</span>

                            <h3>${previous.total ?? 0}</h3>

                            <p>Deployments</p>
                            <p>Failures: ${previous.failed ?? 0}</p>

                            <p>
                                Failure rate:
                                ${previous.failure_rate ?? 0}%
                            </p>

                            <p>
                                Average duration:
                                ${formatValue(previous.average_duration)} min
                            </p>
                        </div>

                    </div>

                    <p class="comparison-note">
                        ${escapeHTML(comparison.message)}
                    </p>
                `);

            } else {
                setHTML(
                    "forensicsComparison",
                    `<p>${escapeHTML(comparison.message)}</p>`
                );
            }

            showMessage(
                "forensicsMessage",
                "Deployment forensics completed."
            );

        } catch (error) {
            console.error("Forensics error:", error);

            showMessage(
                "forensicsMessage",
                error.message,
                true
            );

        } finally {
            forensicsLoading = false;
        }
    }

    // ==================================================
    // FILTER EVENTS
    // ==================================================

    [
        "projectFilter",
        "environmentFilter",
        "statusFilter"
    ].forEach(id => {
        $(id)?.addEventListener("change", loadDashboard);
    });

    $("searchInput")?.addEventListener("input", () => {
        clearTimeout(searchTimer);

        searchTimer = setTimeout(
            loadDashboard,
            300
        );
    });

    $("refreshBtn")?.addEventListener(
        "click",
        loadDashboard
    );

    // ==================================================
    // CSV UPLOAD
    // ==================================================

    $("uploadForm")?.addEventListener("submit", async event => {
        event.preventDefault();

        const file = $("csvFile")?.files[0];

        if (!file) {
            showMessage(
                "uploadMessage",
                "Please select a CSV file.",
                true
            );
            return;
        }

        const formData = new FormData();
        formData.append("file", file);

        try {
            showMessage(
                "uploadMessage",
                "Uploading and analyzing CSV..."
            );

            const result = await apiRequest("/api/upload", {
                method: "POST",
                body: formData
            });

            const optionalSkipped = result.optional_columns_skipped || [];

            let message =
                `${result.message} Records: ${result.records}. ` +
                `Columns detected: ${(result.columns || []).length}.`;

            if (optionalSkipped.length) {
                message +=
                    ` Optional columns not supplied: ${optionalSkipped.join(", ")}.`;
            }

            showMessage("uploadMessage", message);

            [
                "projectFilter",
                "environmentFilter",
                "statusFilter",
                "searchInput"
            ].forEach(id => {
                if ($(id)) $(id).value = "";
            });

            await loadDashboard();

        } catch (error) {
            showMessage(
                "uploadMessage",
                error.message,
                true
            );
        }
    });

    // ==================================================
    // RESET DATASET
    // ==================================================

    $("resetDatasetBtn")?.addEventListener("click", async () => {
        const button = $("resetDatasetBtn");

        if (button) button.disabled = true;

        try {
            const result = await apiRequest(
                "/api/reset-dataset",
                { method: "POST" }
            );

            showMessage(
                "uploadMessage",
                result.message || "Default dataset restored."
            );

            [
                "projectFilter",
                "environmentFilter",
                "statusFilter",
                "searchInput"
            ].forEach(id => {
                if ($(id)) $(id).value = "";
            });

            await loadDashboard();

        } catch (error) {
            showMessage(
                "uploadMessage",
                error.message,
                true
            );

        } finally {
            if (button) button.disabled = false;
        }
    });

    // ==================================================
    // DOWNLOAD HELPER
    // ==================================================

    function downloadFile(content, filename, type) {
        const blob = new Blob(
            [content],
            { type }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    }

    // ==================================================
    // CSV EXPORT
    // ==================================================

    function csvEscape(value) {
        const text = String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
    }

    $("exportCsvBtn")?.addEventListener("click", () => {
        if (!deployments.length || !columns.length) {
            showMessage(
                "reportMessage",
                "No data to export.",
                true
            );
            return;
        }

        const csv = [
            columns.map(csvEscape).join(","),

            ...deployments.map(row =>
                columns.map(column =>
                    csvEscape(row[column])
                ).join(",")
            )

        ].join("\r\n");

        downloadFile(
            "\uFEFF" + csv,
            "deploywatch-report.csv",
            "text/csv;charset=utf-8"
        );

        showMessage(
            "reportMessage",
            "CSV exported successfully."
        );
    });

    // ==================================================
    // HTML REPORT EXPORT
    // ==================================================

    $("exportHtmlBtn")?.addEventListener("click", () => {
        if (!deployments.length || !columns.length) {
            showMessage(
                "reportMessage",
                "No data to export.",
                true
            );
            return;
        }

        const tableRows = deployments.map(row => `
            <tr>
                ${columns.map(column => `
                    <td>${escapeHTML(row[column])}</td>
                `).join("")}
            </tr>
        `).join("");

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">

                <title>DeployWatch Report</title>

                <style>
                    body {
                        font-family: Arial, sans-serif;
                        padding: 30px;
                        color: #111;
                    }

                    h1 {
                        letter-spacing: 3px;
                    }

                    table {
                        border-collapse: collapse;
                        width: 100%;
                    }

                    td, th {
                        border: 1px solid #ccc;
                        padding: 9px;
                        text-align: left;
                    }

                    th {
                        background: #111;
                        color: white;
                    }
                </style>
            </head>

            <body>
                <h1>DEPLOYWATCH</h1>

                <p>
                    BLACK//OPS — Deployment Intelligence Report
                </p>

                <table>
                    <thead>
                        <tr>
                            ${columns.map(column => `
                                <th>${escapeHTML(column)}</th>
                            `).join("")}
                        </tr>
                    </thead>

                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </body>
            </html>
        `;

        downloadFile(
            html,
            "deploywatch-report.html",
            "text/html"
        );

        showMessage(
            "reportMessage",
            "HTML report exported successfully."
        );
    });

    // ==================================================
    // DATASET CHECK
    // ==================================================

    $("checkMonitorBtn")?.addEventListener("click", async () => {
        showMessage(
            "monitorMessage",
            "Checking dataset..."
        );

        await loadDashboard();

        showMessage(
            "monitorMessage",
            `Dataset check completed. ${deployments.length} records loaded.`
        );
    });

    // ==================================================
    // APPLICATION INITIALIZATION
    // ==================================================

    async function initializeApplication() {
        createAuthScreen();
        createAccountControl();

        const authenticated = await checkAuthentication();

        if (!authenticated) return;

        showPage("overview");

        await loadDashboard();
    }

    initializeApplication();
});
