/**
 * Configuration Parsing, Export & Persistence
 *
 * Handles loading, parsing, exporting, and persisting the tier ranking
 * configuration. This is the data-layer module — it serializes/deserializes
 * state and communicates with the backend API.
 */

import { state, els } from "./state.js";
import { toNumber, clamp, uniqueId, humanizeId, configId, slugify, showToast } from "./utils.js";
import { apiFetch } from "./auth.js";

/**
 * Parses JSON configuration text into the application's data model.
 * @param {string} text - The JSON configuration text to parse
 * @returns {Object} Parsed configuration with title, tiers, criteria, and candidates
 */
export function parseConfig(text) {
  return parseJsonConfig(text);
}

/**
 * Parses JSON configuration text into the application's data model.
 * @param {string} text - JSON configuration text
 * @returns {Object} Parsed configuration with title, tiers, criteria, and candidates
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
  const min = toNumber(data.min, 0);
  const max = Math.max(1, toNumber(data.max, 10));
  const rawCandidates = Array.isArray(data.candidates) ? data.candidates : [];
  let criteria = normalizeRubric(data.rubric);

  // Parse tiers: support new format [{id, name}] and detect old format ["S", "A", ...]
  let tiers;
  if (Array.isArray(data.tiers) && data.tiers.length) {
    // Detect old format: array of strings
    if (typeof data.tiers[0] === "string") {
      throw new Error(
        "This ranking file uses an outdated tier format. " +
        "Tiers must now be objects with 'id' and 'name' properties. " +
        "Please update the file or create a new ranking."
      );
    }
    // New format: array of {id, name, position} objects
    tiers = data.tiers.map((tier) => ({
      id: String(tier.id || `tier-${Math.random().toString(36).slice(2, 8)}`),
      name: String(tier.name || "Unnamed"),
      position: toNumber(tier.position, 1)
    }));
  } else {
    tiers = [
      { id: "tier-1", name: "S", position: 1 },
      { id: "tier-2", name: "A", position: 2 },
      { id: "tier-3", name: "B", position: 3 },
      { id: "tier-4", name: "C", position: 4 },
      { id: "tier-5", name: "D", position: 5 },
      { id: "tier-6", name: "F", position: 6 }
    ];
  }

  if (!rawCandidates.length) {
    // Empty candidates list is valid (e.g. newly created ranking)
  }

  if (!criteria.length) {
    criteria = inferCriteriaFromScores(rawCandidates);
  }

  // Build set of valid tier IDs for normalization
  const tierIdSet = new Set(tiers.map((t) => t.id));

  const candidates = rawCandidates.map((item, index) => {
    const candidate = item && typeof item === "object" ? item : {};
    const name = String(candidate.name || `Candidate ${index + 1}`);
    const rawScores = candidate.scores && typeof candidate.scores === "object" ? candidate.scores : {};
    const scores = {};
    criteria.forEach((criterion) => {
      const rawValue = rawScores[criterion.id] ?? rawScores[criterion.name];
      const type = criterion.type || "numeric";
      
      // Handle boolean criteria: convert to true/false
      if (type === "boolean-scoring" || type === "boolean-constraint") {
        // Handle both boolean values and integer values (0/1) from database
        if (typeof rawValue === 'boolean') {
          scores[criterion.id] = rawValue;
        } else {
          // Convert integer to boolean (1 -> true, 0 -> false)
          scores[criterion.id] = toNumber(rawValue, 0) === 1;
        }
      } else {
        // Numeric criteria: clamp to min/max range
        scores[criterion.id] = clamp(toNumber(rawValue, min), min, max);
      }
    });
    // Normalize tierId: use candidate.tierId if valid, otherwise null (Unranked)
    let tierId = null;
    if (candidate.tierId && tierIdSet.has(candidate.tierId)) {
      tierId = candidate.tierId;
    } else if (candidate.tier) {
      // Legacy field: try to match by name
      const matched = tiers.find((t) => t.name.toLowerCase() === String(candidate.tier).toLowerCase());
      if (matched) tierId = matched.id;
    }
    return {
      id: candidate.id || `${slugify(name)}-${index + 1}`,
      name,
      image: String(candidate.image || "./assets/candidates/atlas.svg"),
      description: String(candidate.description || ""),
      tierId,
      scores
    };
  });

  // Parse AHP comparisons if present
  const ahpComparisons = data.ahpComparisons && typeof data.ahpComparisons === "object" ? data.ahpComparisons : {};

  return { title, tiers, min, max, criteria, candidates, ahpComparisons };
}



/**
 * Exports the current configuration state as JSON.
 * @returns {string} JSON-formatted configuration text
 */
export function exportConfig() {
  return exportJson();
}

/**
 * Exports the current configuration state as JSON.
 * @returns {string} JSON-formatted configuration text
 */
export function exportJson() {
  const rubric = state.criteria.map((criterion) => ({
    id: criterion.id,
    name: criterion.name,
    weight: criterion.weight,
    type: criterion.type || "numeric"
  }));

  const candidates = state.candidates.map((candidate) => ({
    name: candidate.name,
    image: candidate.image,
    description: candidate.description,
    tierId: candidate.tierId || null,
    scores: state.criteria.reduce((scores, criterion) => {
      scores[criterion.id] = candidate.scores[criterion.id] ?? 0;
      return scores;
    }, {})
  }));

  return JSON.stringify({
    title: state.title,
    tiers: state.tiers,
    min: state.min ?? 0,
    max: state.max ?? 10,
    rubric,
    candidates,
    ahpComparisons: state.ahpComparisons || {}
  }, null, 2);
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
 * Cancels any pending autosave operation.
 * Should be called when logging out to prevent saving stale data under a different user.
 */
export function cancelPendingSave() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
}

/**
 * Persists the current configuration to the backend API.
 * If no ranking name is set, auto-saves to a default ranking named "untitled".
 * @returns {Promise<void>}
 */
export async function persistConfig() {
  try {
    // If no ranking name is set, auto-save to "untitled"
    if (!state.currentRankingName) {
      state.currentRankingName = "untitled";
      // Update the save icon tooltip
      const saveIcon = document.querySelector("[data-save-icon]");
      if (saveIcon) {
        saveIcon.title = state.currentRankingName;
      }
    }
    
    const data = {
      title: state.title,
      tiers: state.tiers,
      criteria: state.criteria,
      candidates: state.candidates,
      min: state.min,
      max: state.max,
      ahpComparisons: state.ahpComparisons || {}
    };
    
    const response = await apiFetch(`/api/rankings/${encodeURIComponent(state.currentRankingName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
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
  return state.configText;
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
 * Normalizes a rubric configuration into a standardized criteria array.
 * Handles both array and object formats for the rubric.
 * @param {Array|Object} rubric - The rubric configuration to normalize
 * @returns {Array} Array of normalized criterion objects
 */
function normalizeRubric(rubric) {
  const seen = new Set();
  const entries = Array.isArray(rubric)
    ? rubric.map((item, index) => [item?.id || item?.key || `criterion_${index + 1}`, item])
    : Object.entries(rubric || {});

  return entries.map(([rawId, rawValue]) => {
    const value = rawValue && typeof rawValue === "object" ? rawValue : { label: rawValue };
    const label = value.label || value.name || humanizeId(rawId);
    const id = uniqueId(configId(rawId || label), seen);
    return {
      id,
      name: String(label),
      weight: toNumber(value.weight, 1),
      type: value.type || "numeric"
    };
  }).filter((criterion) => criterion.name);
}

/**
 * Infers criteria from candidate score keys when no rubric is defined.
 * @param {Array} candidates - Array of candidate objects
 * @returns {Array} Array of inferred criterion objects
 */
function inferCriteriaFromScores(candidates) {
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
