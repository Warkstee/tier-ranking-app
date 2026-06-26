/**
 * Configuration Management
 * 
 * Handles loading, parsing, exporting, and persisting the tier ranking configuration.
 * Supports JSON and Markdown formats, with automatic syncing to the backend API.
 */

import { state, els, DEFAULT_CONFIG } from "./state.js";
import { toNumber, clamp, uniqueId, humanizeId, configId, slugify, formatNumber, cell, showToast } from "./utils.js";

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
  const rawCandidates = Array.isArray(data.candidates) ? data.candidates : [];
  let facets = normalizeRubric(data.rubric);

  if (!rawCandidates.length) {
    throw new Error("tier-ranking.json needs a candidates list.");
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
      scores[facet.id] = clamp(toNumber(rawScores[facet.id] ?? rawScores[facet.name], 0), 0, facet.max);
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

  return { title, tiers, facets, candidates };
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
    weight: toNumber(row.Weight ?? row.weight, 1),
    max: Math.max(1, toNumber(row.Max ?? row.max, 10))
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
      scores[facet.id] = clamp(toNumber(row[facet.name], 0), 0, facet.max);
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
    min: 0,
    max: state.facets[0]?.max || 10,
    rubric,
    candidates
  }, null, 2);
}

/**
 * Exports the current configuration state as Markdown.
 * @returns {string} Markdown-formatted configuration text
 */
export function exportMarkdown() {
  const facetHeader = "| Facet | Weight | Max |\n| --- | ---: | ---: |";
  const facetRows = state.facets
    .map((facet) => `| ${cell(facet.name)} | ${formatNumber(facet.weight)} | ${formatNumber(facet.max)} |`)
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
      weight: toNumber(value.weight, 1),
      max: Math.max(1, toNumber(value.max, 10))
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
    weight: 1,
    max: 10
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
