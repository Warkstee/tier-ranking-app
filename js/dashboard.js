/**
 * Dashboard View
 *
 * Renders a card-based dashboard showing all saved rankings with screenshot
 * thumbnails, metadata, and action icons. Replaces the ranking board as the
 * initial view after authentication.
 */

import { apiFetch } from "./auth.js";
import { state } from "./state.js";
import { openRanking, handleNew, closeBurgerMenu } from "./file-menu.js";
import { initializeApp } from "./app.js";
import { render } from "./render.js";
import { showToast } from "./utils.js";
import { cancelPendingSave } from "./config-parser.js";

/**
 * Show the dashboard view: fetch rankings, render cards, hide the board.
 */
export async function showDashboard() {
  // Cancel any pending autosave to prevent saving incomplete state
  cancelPendingSave();
  
  // Auto-save if there are unsaved changes and a valid ranking name
  if (state.isDirty && state.currentRankingName) {
    try {
      const { saveRankingToServer } = await import("./file-menu.js");
      await saveRankingToServer(state.currentRankingName);
    } catch (error) {
      console.error("Failed to auto-save ranking:", error);
    }
  }

  // Reset state completely when returning to dashboard
  state.title = "S-Tier Ranking Board";
  state.tiers = [
    { id: "tier-1", name: "S", position: 1 },
    { id: "tier-2", name: "A", position: 2 },
    { id: "tier-3", name: "B", position: 3 },
    { id: "tier-4", name: "C", position: 4 },
    { id: "tier-5", name: "D", position: 5 },
    { id: "tier-6", name: "F", position: 6 }
  ];
  state.criteria = [];
  state.candidates = [];
  state.min = 0;
  state.max = 10;
  state.currentRankingName = null;
  state.isDirty = false;

  // Re-render the DOM to reflect the empty state
  render();

  const dashboardView = document.querySelector("[data-dashboard-view]");
  const workspace = document.querySelector(".workspace");

  if (!dashboardView || !workspace) return;

  // Toggle visibility
  dashboardView.hidden = false;
  workspace.hidden = true;

  // Add dashboard-mode class to body to hide board-specific topbar elements
  document.body.classList.add("dashboard-mode");

  // Hide mutation UI that belongs to the board view
  closeBurgerMenu();

  try {
    const response = await apiFetch("/api/rankings");
    if (!response.ok) throw new Error("Failed to fetch rankings");
    const rankings = await response.json();

    renderDashboardGrid(rankings);
  } catch (error) {
    console.error("Failed to load dashboard:", error);
    showToast("Failed to load dashboard.");
  }
}

/**
 * Render the card grid inside the dashboard container.
 */
function renderDashboardGrid(rankings) {
  const dashboardView = document.querySelector("[data-dashboard-view]");
  if (!dashboardView) return;

  // Clear previous content
  dashboardView.innerHTML = "";

  if (rankings.length === 0) {
    renderEmptyState(dashboardView);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "dashboard-grid";

  // Render ranking cards
  for (const ranking of rankings) {
    grid.appendChild(renderDashboardCard(ranking));
  }

  // Append "New ranking" card at the end
  grid.appendChild(renderNewCard());

  dashboardView.appendChild(grid);
}

/**
 * Create a ranking card element.
 */
function renderDashboardCard(ranking) {
  const card = document.createElement("article");
  card.className = "dashboard-card";
  card.dataset.rankingName = ranking.name;

  // Preview area
  const preview = document.createElement("div");
  preview.className = "card-preview";

  if (ranking.screenshot) {
    const img = document.createElement("img");
    // Append cache-busting query param so updated screenshots are always fresh
    const separator = ranking.screenshot.includes("?") ? "&" : "?";
    img.src = `${ranking.screenshot}${separator}t=${Date.now()}`;
    img.alt = `${ranking.title || ranking.name} preview`;
    img.loading = "lazy";
    preview.appendChild(img);
  } else {
    const empty = document.createElement("div");
    empty.className = "card-preview--empty";
    empty.textContent = "No preview";
    preview.appendChild(empty);
  }

  // Body
  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = ranking.title || ranking.name;
  title.title = ranking.title || ranking.name;
  body.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "card-meta";

  if (ranking.created_at) {
    const createdLine = document.createElement("span");
    createdLine.textContent = `Created ${formatDate(ranking.created_at)}`;
    meta.appendChild(createdLine);
  }

  if (ranking.modifiedAt) {
    const modifiedLine = document.createElement("span");
    modifiedLine.textContent = `Updated ${formatDate(ranking.modifiedAt)}`;
    meta.appendChild(modifiedLine);
  }

  body.appendChild(meta);

  // Filename
  const filename = document.createElement("div");
  filename.className = "card-filename";
  filename.textContent = ranking.name;
  filename.title = ranking.name;
  body.appendChild(filename);

  // Actions
  const actions = document.createElement("div");
  actions.className = "card-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "card-action-btn card-action-btn--edit";
  editBtn.setAttribute("aria-label", `Edit ${ranking.title || ranking.name}`);
  editBtn.title = "Edit";
  editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleDashboardEdit(ranking.name);
  });
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "card-action-btn card-action-btn--delete";
  deleteBtn.setAttribute("aria-label", `Delete ${ranking.title || ranking.name}`);
  deleteBtn.title = "Delete";
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleDashboardDelete(ranking.name);
  });
  actions.appendChild(deleteBtn);

  card.appendChild(preview);
  card.appendChild(body);
  card.appendChild(actions);

  // Clicking the card body/preview opens the ranking
  card.addEventListener("click", () => {
    handleDashboardEdit(ranking.name);
  });

  return card;
}

/**
 * Create the "New ranking" card.
 */
function renderNewCard() {
  const card = document.createElement("article");
  card.className = "dashboard-card--new";
  card.setAttribute("aria-label", "Create new ranking");
  card.tabIndex = 0;

  const icon = document.createElement("div");
  icon.className = "new-card-icon";
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span>New Ranking</span>`;

  card.appendChild(icon);

  card.addEventListener("click", handleDashboardNew);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleDashboardNew();
    }
  });

  return card;
}

/**
 * Render the empty state when no rankings exist.
 */
function renderEmptyState(container) {
  const empty = document.createElement("div");
  empty.className = "dashboard-empty";

  empty.innerHTML = `
    <h2>Welcome to your Ranking Dashboard</h2>
    <p>Create your first ranking to start organizing and comparing candidates across custom tiers and criteria.</p>
  `;

  const cta = document.createElement("button");
  cta.type = "button";
  cta.className = "empty-cta";
  cta.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Create your first ranking`;
  cta.addEventListener("click", handleDashboardNew);

  empty.appendChild(cta);
  container.appendChild(empty);
}

/**
 * Open a ranking from the dashboard.
 */
async function handleDashboardEdit(name) {
  hideDashboard();
  await openRanking(name);
  await initializeApp();
}

/**
 * Delete a ranking from the dashboard.
 */
async function handleDashboardDelete(name) {
  const confirmed = confirm(`Delete ranking "${name}"? This cannot be undone.`);
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/rankings/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });

    if (!response.ok) throw new Error("Failed to delete ranking");

    showToast(`Deleted ranking: ${name}`);

    // Re-fetch and re-render
    const listResponse = await apiFetch("/api/rankings");
    if (listResponse.ok) {
      const rankings = await listResponse.json();
      renderDashboardGrid(rankings);
    }
  } catch (error) {
    console.error("Failed to delete ranking:", error);
    showToast("Failed to delete ranking.");
  }
}

/**
 * Create a new ranking from the dashboard.
 */
async function handleDashboardNew() {
  hideDashboard();
  await handleNew(() => {
    // User cancelled - return to dashboard
    showDashboard();
  });
  await initializeApp(true);
}

/**
 * Hide the dashboard and show the ranking board.
 */
export function hideDashboard() {
  const dashboardView = document.querySelector("[data-dashboard-view]");
  const workspace = document.querySelector(".workspace");
  if (dashboardView) dashboardView.hidden = true;
  if (workspace) workspace.hidden = false;
  document.body.classList.remove("dashboard-mode");
}

/**
 * Show the ranking board (alias for hideDashboard).
 */
function showBoard() {
  hideDashboard();
}

/**
 * Format an ISO date string to a human-readable date and time.
 */
function formatDate(isoString) {
  if (!isoString) return "";

  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
