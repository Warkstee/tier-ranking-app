/**
 * Configuration Management
 * 
 * Handles loading, parsing, exporting, and persisting the tier ranking configuration.
 * Supports JSON and Markdown formats, with automatic syncing to the backend API.
 * Also manages the config editor draft state and UI interactions.
 */

import { state, els, DEFAULT_CONFIG } from "./state.js";
import { toNumber, clamp, uniqueId, humanizeId, configId, slugify, formatNumber, cell, showToast, escapeHtml } from "./utils.js";
import { renderTierBoard, renderUnranked } from "./render.js";
import { attachReorderable } from "./drag.js";

/**
 * Draft state for the config editor.
 * Holds a snapshot of facets, min, max, and candidate scores while the editor is open.
 * All editor operations modify the draft; changes are only applied to real state on "Apply".
 * The draft persists across X-close and is only cleared on Apply or Cancel.
 * @type {Object|null}
 */
let configDraft = null;

/**
 * Loads configuration from disk, trying configured sources in order.
 * Falls back to bundled default config if all sources fail and fallbackToDefault is true.
 * @param {Object} options - Load options
 * @param {boolean} options.fallbackToDefault - Whether to use bundled config as fallback
 * @returns {Promise<Object>} Config object with text, format, and source properties
 */
export async function loadConfig({ fallbackToDefault = false } = {}) {
  const sources = [
    { path: "./tier-ranking.json", format: "json" }
  ];

  for (const source of sources) {
    try {
      const response = await fetch(`${source.path}?refresh=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) continue;
      return {
        text: await response.text(),
        format: source.format,
        source: source.path.replace("./", "")
      };
    } catch {
      // Try the next config path before falling back to the bundled sample.
    }
  }

  if (fallbackToDefault) {
    showToast("Using bundled config because tier-ranking.json was not fetched.");
    return { text: DEFAULT_CONFIG, format: "json", source: "bundled config" };
  }

  throw new Error("Could not load tier-ranking.json.");
}

/**
 * Parses configuration text based on the specified format.
 * @param {string} text - The configuration text to parse
 * @param {string} format - The format type ("json" or "markdown")
 * @returns {Object} Parsed configuration with title, tiers, facets, and candidates
 */
export function parseConfig(text, format) {
  if (format === "json") {
    return parseJsonConfig(text);
  }
  return parseMarkdownConfig(text);
}

/**
 * Parses JSON configuration text into the application's data model.
 * @param {string} text - JSON configuration text
 * @returns {Object} Parsed configuration with title, tiers, facets, and candidates
 * @throws {Error} If JSON is invalid or candidates list is missing
 */
export function parseJsonConfig(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }

  const title = String(data.title || "S-Tier Ranking Board");
  const tiers = Array.isArray(data.tiers) && data.tiers.length
    ? data.tiers.map((tier) => String(tier))
    : ["S", "A", "B", "C", "D", "F"];
  const min = toNumber(data.min, 0);
  const max = Math.max(1, toNumber(data.max, 10));
  const rawCandidates = Array.isArray(data.candidates) ? data.candidates : [];
  let facets = normalizeRubric(data.rubric);

  if (!rawCandidates.length) {
    // Empty candidates list is valid (e.g. newly created ranking)
  }

  if (!facets.length) {
    facets = inferFacetsFromScores(rawCandidates);
  }

  const candidates = rawCandidates.map((item, index) => {
    const candidate = item && typeof item === "object" ? item : {};
    const name = String(candidate.name || `Candidate ${index + 1}`);
    const rawScores = candidate.scores && typeof candidate.scores === "object" ? candidate.scores : {};
    const scores = {};
    facets.forEach((facet) => {
      scores[facet.id] = clamp(toNumber(rawScores[facet.id] ?? rawScores[facet.name], min), min, max);
    });
    return {
      id: candidate.id || `${slugify(name)}-${index + 1}`,
      name,
      image: String(candidate.image || "./assets/candidates/atlas.svg"),
      description: String(candidate.description || ""),
      tier: normalizeTier(candidate.tier || "Unranked", tiers),
      scores
    };
  });

  return { title, tiers, min, max, facets, candidates };
}

/**
 * Parses Markdown configuration text into the application's data model.
 * @param {string} markdown - Markdown configuration text
 * @returns {Object} Parsed configuration with title, tiers, facets, and candidates
 * @throws {Error} If candidates table is missing
 */
export function parseMarkdownConfig(markdown) {
  const lines = markdown.split(/\r?\n/);
  const titleLine = lines.find((line) => line.trim().startsWith("#"));
  const title = titleLine ? titleLine.trim() : "S-Tier Ranking Board";
  const tiers = parseListSetting(lines, "tiers", ["S", "A", "B", "C", "D", "F"]);
  const facetRows = parseMarkdownTable(lines, "## Facets");
  const primaryCandidateRows = parseMarkdownTable(lines, "## Candidates");
  const candidateRows = primaryCandidateRows.length
    ? primaryCandidateRows
    : parseMarkdownTable(lines, "## Clients");

  let facets = facetRows.map((row) => ({
    id: slugify(row.Facet || row.facet || row.Name || row.name),
    name: row.Facet || row.facet || row.Name || row.name,
    weight: toNumber(row.Weight ?? row.weight, 1)
  })).filter((facet) => facet.name);

  if (!candidateRows.length) {
    throw new Error("The config needs a ## Candidates table.");
  }

  if (!facets.length) {
    const reserved = new Set(["Name", "Image", "Description", "Tier"]);
    facets = Object.keys(candidateRows[0])
      .filter((header) => !reserved.has(header))
      .map((header) => ({ id: slugify(header), name: header, weight: 1, max: 10 }));
  }

  const candidates = candidateRows.map((row, index) => {
    const name = row.Name || row.name || `Candidate ${index + 1}`;
    const scores = {};
    facets.forEach((facet) => {
      scores[facet.id] = clamp(toNumber(row[facet.name], 0), 0, 10);
    });
    return {
      id: `${slugify(name)}-${index + 1}`,
      name,
      image: row.Image || row.image || "./assets/candidates/atlas.svg",
      description: row.Description || row.description || "",
      tier: normalizeTier(row.Tier || row.tier || "Unranked", tiers),
      scores
    };
  });

  return { title, tiers, facets, candidates };
}

/**
 * Exports the current configuration state to the appropriate format.
 * @returns {string} Serialized configuration text
 */
export function exportConfig() {
  if (state.configFormat === "markdown") {
    return exportMarkdown();
  }
  return exportJson();
}

/**
 * Exports the current configuration state as JSON.
 * @returns {string} JSON-formatted configuration text
 */
export function exportJson() {
  const rubric = state.facets.map((facet) => ({
    id: facet.id,
    name: facet.name,
    weight: facet.weight
  }));

  const candidates = state.candidates.map((candidate) => ({
    name: candidate.name,
    image: candidate.image,
    description: candidate.description,
    tier: candidate.tier,
    scores: state.facets.reduce((scores, facet) => {
      scores[facet.id] = candidate.scores[facet.id] ?? 0;
      return scores;
    }, {})
  }));

  return JSON.stringify({
    title: state.title,
    tiers: state.tiers,
    min: state.min ?? 0,
    max: state.max ?? 10,
    rubric,
    candidates
  }, null, 2);
}

/**
 * Exports the current configuration state as Markdown.
 * @returns {string} Markdown-formatted configuration text
 */
export function exportMarkdown() {
  const facetHeader = "| Facet | Weight |\n| --- | ---: |";
  const facetRows = state.facets
    .map((facet) => `| ${cell(facet.name)} | ${formatNumber(facet.weight)} |`)
    .join("\n");

  const scoreHeaders = state.facets.map((facet) => facet.name);
  const candidateHeader = ["Name", "Image", "Description", "Tier", ...scoreHeaders];
  const candidateAlign = ["---", "---", "---", "---", ...scoreHeaders.map(() => "---:")];
  const candidateRows = state.candidates.map((candidate) => {
    const values = [
      candidate.name,
      candidate.image,
      candidate.description,
      candidate.tier,
      ...state.facets.map((facet) => formatNumber(candidate.scores[facet.id] ?? 0))
    ];
    return `| ${values.map(cell).join(" | ")} |`;
  }).join("\n");

return `${state.title}

tiers: [${state.tiers.join(", ")}]

## Facets

${facetHeader}
${facetRows}

## Candidates

| ${candidateHeader.map(cell).join(" | ")} |
| ${candidateAlign.join(" | ")} |
${candidateRows}
`;
}

let saveTimer = 0;

/**
 * Syncs the current state to the configuration text and schedules persistence.
 * Debounces the save operation to avoid excessive API calls.
 */
export function syncConfigFromState() {
  state.configText = exportConfig();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistConfig, 1000);
}

/**
 * Persists the current configuration text to the backend API.
 * Also saves to the current ranking if one is set.
 * @returns {Promise<void>}
 */
export async function persistConfig() {
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: state.configText
    });
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    
    // Also save to current ranking if one is set
    if (state.currentRankingName) {
      const data = {
        title: state.title,
        tiers: state.tiers,
        facets: state.facets,
        candidates: state.candidates,
        min: state.min,
        max: state.max
      };
      
      await fetch(`/api/rankings/${encodeURIComponent(state.currentRankingName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
    }
  } catch (err) {
    console.error("Failed to persist config:", err);
    showToast("Could not save config.");
  }
}

/**
 * Gets the current editable JSON text from the config editor or generates it from state.
 * @returns {string} JSON configuration text
 */
export function getEditableJson() {
  if (state.configFormat === "json") return state.configText;
  return exportJson();
}

/**
 * Sets the status message in the config editor UI.
 * @param {string} message - The status message to display
 * @param {string} tone - The tone/type of the message (e.g., "error", "success")
 */
export function setConfigStatus(message, tone = "") {
  els.configStatus.textContent = message;
  els.configStatus.dataset.tone = tone;
}

/**
 * Formats a configuration error into a user-friendly message.
 * @param {Error} error - The error to format
 * @returns {string} Formatted error message
 */
export function formatConfigError(error) {
  if (error instanceof SyntaxError) {
    return `JSON parse error: ${error.message}`;
  }
  return error.message || "Config could not be applied.";
}

/**
 * Gets the current text from the config editor textarea or generates it from state.
 * @returns {string} Current configuration text
 */
export function currentEditorText() {
  if (!els.configModal.hidden) return els.configEditor.value;
  return getEditableJson();
}

/**
 * Normalizes a rubric configuration into a standardized facet array.
 * Handles both array and object formats for the rubric.
 * @param {Array|Object} rubric - The rubric configuration to normalize
 * @returns {Array} Array of normalized facet objects
 */
function normalizeRubric(rubric) {
  const seen = new Set();
  const entries = Array.isArray(rubric)
    ? rubric.map((item, index) => [item?.id || item?.key || `facet_${index + 1}`, item])
    : Object.entries(rubric || {});

  return entries.map(([rawId, rawValue]) => {
    const value = rawValue && typeof rawValue === "object" ? rawValue : { label: rawValue };
    const label = value.label || value.name || humanizeId(rawId);
    const id = uniqueId(configId(rawId || label), seen);
    return {
      id,
      name: String(label),
      weight: toNumber(value.weight, 1)
    };
  }).filter((facet) => facet.name);
}

/**
 * Infers facets from candidate score keys when no rubric is defined.
 * @param {Array} candidates - Array of candidate objects
 * @returns {Array} Array of inferred facet objects
 */
function inferFacetsFromScores(candidates) {
  const seen = new Set();
  candidates.forEach((candidate) => {
    if (!candidate?.scores || typeof candidate.scores !== "object") return;
    Object.keys(candidate.scores).forEach((key) => seen.add(key));
  });
  return [...seen].map((id) => ({
    id: configId(id),
    name: humanizeId(id),
    weight: 1
  }));
}

/**
 * Normalizes a tier value against the list of valid tiers.
 * Returns "Unranked" if the tier is not found in the list.
 * @param {string} value - The tier value to normalize
 * @param {Array} tiers - Array of valid tier names
 * @returns {string} Normalized tier name
 */
function normalizeTier(value, tiers) {
  const normalized = String(value || "Unranked").trim();
  const match = tiers.find((tier) => tier.toLowerCase() === normalized.toLowerCase());
  if (match) return match;
  return "Unranked";
}

// ============================================================================
// Config Editor Draft Management
// ============================================================================

/**
 * Creates a draft snapshot from the current state for editing.
 * @returns {Object} Draft object with facets, min, max, and candidateScores
 */
export function createDraftFromState() {
  const candidateScores = {};
  state.candidates.forEach((candidate) => {
    candidateScores[candidate.id] = { ...candidate.scores };
  });
  return {
    facets: state.facets.map((f) => ({ ...f })),
    min: state.min ?? 0,
    max: state.max ?? 10,
    candidateScores
  };
}

/**
 * Opens the config editor modal.
 * If a draft already exists (from a previous X-close), it is reused.
 * Otherwise, a fresh draft is created from the current state.
 */
export function openConfigEditor() {
  // Import closeModal from modal.js to avoid circular dependency
  import("./modal.js").then(({ closeModal }) => {
    closeModal();

    // Reuse existing draft or create a new one from current state
    if (!configDraft) {
      configDraft = createDraftFromState();
    }

    els.app.classList.add("config-open");
    els.configMin.value = configDraft.min;
    els.configMax.value = configDraft.max;
    els.configStatus.textContent = "";
    renderFacetEditor();
    updateApplyButtonState();
    els.configModal.hidden = false;
  });
}

/**
 * Renders the facet list inside the config editor modal from the draft.
 */
export function renderFacetEditor() {
  if (!els.facetsList || !configDraft) return;
  els.facetsList.innerHTML = configDraft.facets.map((facet) => `
    <div class="facet-row" data-facet-id="${facet.id}">
      <div class="drag-handle" aria-label="Drag to reorder">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5"/>
          <circle cx="11" cy="3" r="1.5"/>
          <circle cx="5" cy="8" r="1.5"/>
          <circle cx="11" cy="8" r="1.5"/>
          <circle cx="5" cy="13" r="1.5"/>
          <circle cx="11" cy="13" r="1.5"/>
        </svg>
      </div>
      <div class="form-field">
        <label>Name</label>
        <input type="text" value="${escapeHtml(facet.name)}" data-facet-name="${facet.id}" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-field">
        <label>Weight</label>
        <input type="number" value="${facet.weight}" min="0.1" step="0.1" data-facet-weight="${facet.id}" autocomplete="off">
      </div>
      <button type="button" class="btn-delete-facet" data-facet-delete="${facet.id}" aria-label="Delete ${escapeHtml(facet.name)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
        </svg>
      </button>
    </div>
  `).join("");

  // Wire up drag-to-reorder
  attachReorderable(els.facetsList, ".facet-row", (fromIndex, toIndex) => {
    const [moved] = configDraft.facets.splice(fromIndex, 1);
    configDraft.facets.splice(toIndex, 0, moved);
    renderFacetEditor();
    updateApplyButtonState();
  });
}

/**
 * Wires up event listeners for the config editor form fields.
 * Called once during boot, uses event delegation for dynamic facet rows.
 */
export function wireConfigEditorControls() {
  els.configMin.addEventListener("input", handleScoreRangeChange);
  els.configMax.addEventListener("input", handleScoreRangeChange);
  els.facetsList.addEventListener("input", handleFacetFieldChange);
  els.facetsList.addEventListener("click", handleFacetButtonClick);
  els.addFacet.addEventListener("click", addFacet);
}

/**
 * Checks if the draft has unsaved changes compared to the current state.
 * @returns {boolean} True if there are unsaved changes
 */
export function hasUnsavedChanges() {
  if (!configDraft) return false;

  // Check min/max
  if (configDraft.min !== (state.min ?? 0) || configDraft.max !== (state.max ?? 10)) {
    return true;
  }

  // Check facets count
  if (configDraft.facets.length !== state.facets.length) {
    return true;
  }

  // Check each facet
  for (let i = 0; i < configDraft.facets.length; i++) {
    const draftFacet = configDraft.facets[i];
    const stateFacet = state.facets[i];
    if (draftFacet.id !== stateFacet.id || 
        draftFacet.name !== stateFacet.name || 
        draftFacet.weight !== stateFacet.weight) {
      return true;
    }
  }

  // Check candidate scores
  for (const candidate of state.candidates) {
    const draftScores = configDraft.candidateScores[candidate.id] || {};
    const actualScores = candidate.scores;
    
    // Check if any draft facet scores differ
    for (const facet of configDraft.facets) {
      const draftScore = draftScores[facet.id];
      const actualScore = actualScores[facet.id];
      if (draftScore !== actualScore) {
        return true;
      }
    }
    
    // Check if there are scores for facets not in the draft
    for (const scoreKey of Object.keys(actualScores)) {
      if (!configDraft.facets.some((f) => f.id === scoreKey)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Updates the Apply button state based on whether there are unsaved changes.
 */
export function updateApplyButtonState() {
  if (els.applyConfigEdit) {
    els.applyConfigEdit.disabled = !hasUnsavedChanges();
  }
}

/**
 * Handles changes to the min/max score range inputs.
 * Updates the draft only; real state is unchanged until Apply.
 */
export function handleScoreRangeChange() {
  if (!configDraft) return;
  const min = parseInt(els.configMin.value, 10);
  const max = parseInt(els.configMax.value, 10);

  if (isNaN(min) || isNaN(max) || min < 0 || max < 1) return;

  configDraft.min = min;
  configDraft.max = max;

  // Clamp scores in the draft
  configDraft.facets.forEach((facet) => {
    state.candidates.forEach((candidate) => {
      const scores = configDraft.candidateScores[candidate.id];
      if (scores && scores[facet.id] !== undefined) {
        scores[facet.id] = clamp(scores[facet.id], min, max);
      }
    });
  });

  updateApplyButtonState();
}

/**
 * Handles changes to facet name or weight inputs using event delegation.
 * Operates on the draft only; real state is unchanged until Apply.
 */
export function handleFacetFieldChange(event) {
  if (!configDraft) return;
  const target = event.target;
  const facetId = target.dataset.facetName || target.dataset.facetWeight;
  if (!facetId) return;

  const facet = configDraft.facets.find((f) => f.id === facetId);
  if (!facet) return;

  if (target.dataset.facetName !== undefined) {
    const newName = target.value.trim();
    if (!newName) return;

    // Check for duplicate names within the draft
    const isDuplicate = configDraft.facets.some((f) => f.id !== facetId && f.name.toLowerCase() === newName.toLowerCase());
    if (isDuplicate) {
      setConfigStatus(`"${newName}" already exists. Use a different name.`, "error");
      target.value = facet.name;
      return;
    }

    facet.name = newName;
    setConfigStatus("");
  } else if (target.dataset.facetWeight !== undefined) {
    const newWeight = parseFloat(target.value);
    if (!isNaN(newWeight) && newWeight > 0) {
      facet.weight = newWeight;
    }
  }

  updateApplyButtonState();
}

/**
 * Handles click events on facet row buttons (delete) using event delegation.
 * Operates on the draft only; real state is unchanged until Apply.
 */
export function handleFacetButtonClick(event) {
  if (!configDraft) return;
  const deleteBtn = event.target.closest("[data-facet-delete]");
  if (!deleteBtn) return;

  const facetId = deleteBtn.dataset.facetDelete;
  const facet = configDraft.facets.find((f) => f.id === facetId);
  if (!facet) return;

  // Count candidates with non-default scores for this facet in the draft
  const min = configDraft.min;
  const affectedCount = state.candidates.filter((c) => {
    const scores = configDraft.candidateScores[c.id];
    const score = scores ? scores[facetId] : undefined;
    return score !== undefined && score !== min;
  }).length;

  // Show confirmation if any candidate has a meaningful score
  if (affectedCount > 0) {
    const confirmed = window.confirm(
      `${affectedCount} candidate${affectedCount !== 1 ? "s have" : " has"} a score for "${facet.name}". Delete this criterion?`
    );
    if (!confirmed) return;
  }

  // Remove facet from draft
  configDraft.facets = configDraft.facets.filter((f) => f.id !== facetId);

  // Remove scores for this facet from all candidates in the draft
  state.candidates.forEach((candidate) => {
    const scores = configDraft.candidateScores[candidate.id];
    if (scores) {
      delete scores[facetId];
    }
  });

  renderFacetEditor();
  updateApplyButtonState();
}

/**
 * Adds a new facet with default values to the draft.
 * All existing candidates get the minimum score for the new facet in the draft.
 */
export function addFacet() {
  if (!configDraft) return;

  // Generate a unique ID for the new facet
  const baseId = "new-criterion";
  let facetId = baseId;
  let counter = 1;
  while (configDraft.facets.some((f) => f.id === facetId)) {
    facetId = `${baseId}-${counter++}`;
  }

  // Create new facet
  const newFacet = {
    id: facetId,
    name: "New Criterion",
    weight: 1
  };

  configDraft.facets.push(newFacet);

  // Add minimum score for all existing candidates in the draft
  const min = configDraft.min;
  state.candidates.forEach((candidate) => {
    if (!configDraft.candidateScores[candidate.id]) {
      configDraft.candidateScores[candidate.id] = {};
    }
    configDraft.candidateScores[candidate.id][facetId] = min;
  });

  renderFacetEditor();
  updateApplyButtonState();

  // Focus the name input of the new facet row
  const newRow = els.facetsList.querySelector(`[data-facet-id="${facetId}"]`);
  if (newRow) {
    const nameInput = newRow.querySelector("[data-facet-name]");
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }
}

/**
 * Hides the config editor modal without discarding the draft.
 * Used by the X button and Escape key.
 */
export function hideConfigEditor() {
  els.app.classList.remove("config-open");
  els.configModal.hidden = true;
}

/**
 * Closes the config editor modal and discards the draft.
 * Restores state from the last saved config to undo any unsaved changes.
 * Used by the Cancel button.
 */
export function closeConfigEditor() {
  // Discard the draft
  configDraft = null;

  // Restore state from the last saved config
  const saved = parseConfig(state.configText, state.configFormat);
  state.facets = saved.facets;
  state.min = saved.min ?? 0;
  state.max = saved.max ?? 10;

  // Re-render the board to reflect the restored state
  renderTierBoard();
  renderUnranked();

  els.app.classList.remove("config-open");
  els.configModal.hidden = true;
}

/**
 * Syncs the config editor form with the draft if the modal is open.
 */
export function syncOpenConfigEditor() {
  if (els.configModal.hidden) return;
  if (!configDraft) return;
  els.configMin.value = configDraft.min;
  els.configMax.value = configDraft.max;
  renderFacetEditor();
}

/**
 * Applies the draft config to the application state and persists it.
 */
export function applyEditorConfig() {
  if (!configDraft) return;

  const min = configDraft.min;
  const max = configDraft.max;

  // Validate score range
  if (isNaN(min) || isNaN(max) || min < 0 || max < 1 || min >= max) {
    setConfigStatus("Invalid score range. Min must be ≥ 0, Max must be ≥ 1, and Min < Max.", "error");
    return;
  }

  // Validate all facet names and weights in the draft
  const names = new Set();
  for (const facet of configDraft.facets) {
    if (!facet.name.trim()) {
      setConfigStatus("All criteria must have a name.", "error");
      return;
    }
    const normalizedName = facet.name.toLowerCase();
    if (names.has(normalizedName)) {
      setConfigStatus(`Duplicate criterion name: "${facet.name}".`, "error");
      return;
    }
    names.add(normalizedName);
    if (facet.weight <= 0 || isNaN(facet.weight)) {
      setConfigStatus(`Invalid weight for "${facet.name}". Must be greater than 0.`, "error");
      return;
    }
  }

  // Apply draft to state
  state.facets = configDraft.facets;
  state.min = min;
  state.max = max;

  // Apply draft scores to candidates
  state.candidates.forEach((candidate) => {
    const draftScores = configDraft.candidateScores[candidate.id] || {};
    // Set scores for all draft facets
    configDraft.facets.forEach((facet) => {
      candidate.scores[facet.id] = draftScores[facet.id] !== undefined
        ? clamp(draftScores[facet.id], min, max)
        : min;
    });
    // Remove scores for facets no longer in the draft
    Object.keys(candidate.scores).forEach((scoreKey) => {
      if (!configDraft.facets.some((f) => f.id === scoreKey)) {
        delete candidate.scores[scoreKey];
      }
    });
  });

  // Clear the draft
  configDraft = null;

  // Persist and re-render
  syncConfigFromState();
  import("./render.js").then(({ render }) => {
    render();
  });
  setConfigStatus("Applied configuration.", "ok");
  els.app.classList.remove("config-open");
  els.configModal.hidden = true;
  showToast("Applied config.");
}

/**
 * Parses a scalar setting from Markdown lines.
 * @param {Array} lines - Array of Markdown lines
 * @param {string} key - The setting key to find
 * @param {string} fallback - Default value if not found
 * @returns {string} The setting value or fallback
 */
function parseScalarSetting(lines, key, fallback) {
  const prefix = `${key}:`;
  const found = lines.find((line) => line.trim().toLowerCase().startsWith(prefix.toLowerCase()));
  if (!found) return fallback;
  const value = found.slice(found.indexOf(":") + 1).trim();
  return value || fallback;
}

/**
 * Parses a list setting from Markdown lines (e.g., "tiers: [S, A, B]").
 * @param {Array} lines - Array of Markdown lines
 * @param {string} key - The setting key to find
 * @param {Array} fallback - Default array if not found
 * @returns {Array} Array of parsed values or fallback
 */
function parseListSetting(lines, key, fallback) {
  const raw = parseScalarSetting(lines, key, "");
  if (!raw) return fallback;
  const match = raw.match(/^\[(.*)\]$/);
  const source = match ? match[1] : raw;
  const values = source.split(",").map((value) => value.trim()).filter(Boolean);
  return values.length ? values : fallback;
}

/**
 * Parses a Markdown table under a specific heading.
 * @param {Array} lines - Array of Markdown lines
 * @param {string} heading - The heading to search for (e.g., "## Facets")
 * @returns {Array} Array of row objects with column headers as keys
 */
function parseMarkdownTable(lines, heading) {
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (start === -1) return [];
  const table = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line && !table.length) continue;
    if (!line.startsWith("|")) {
      if (table.length) break;
      continue;
    }
    table.push(splitTableRow(line));
  }

  if (table.length < 2) return [];
  const headers = table[0];
  return table.slice(2).map((cells) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

/**
 * Splits a Markdown table row into individual cells.
 * @param {string} line - The table row line
 * @returns {Array} Array of cell values
 */
function splitTableRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
