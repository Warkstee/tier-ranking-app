/**
 * Utility Functions
 * 
 * Core utility functions used throughout the tier ranking application.
 * These are pure or near-pure functions with minimal dependencies,
 * providing common operations for data transformation, formatting, and UI helpers.
 */

/**
 * Converts a value to a number, returning a fallback if the conversion fails.
 * @param {*} value - The value to convert
 * @param {number} fallback - The fallback value if conversion fails
 * @returns {number} The parsed number or fallback
 */
export function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Clamps a value between a minimum and maximum bound.
 * @param {number} value - The value to clamp
 * @param {number} min - The minimum bound
 * @param {number} max - The maximum bound
 * @returns {number} The clamped value
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Formats a number for display, removing unnecessary decimal places.
 * @param {number} value - The number to format
 * @returns {string} Formatted number string
 */
export function formatNumber(value) {
  return Number.isInteger(Number(value)) ? String(Number(value)) : String(Number(value).toFixed(2)).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Generates a unique ID by appending a counter if the base ID already exists in the seen set.
 * @param {string} id - The base ID
 * @param {Set} seen - Set of already-used IDs
 * @returns {string} A unique ID
 */
export function uniqueId(id, seen) {
  const fallback = id || "criterion";
  let next = fallback;
  let counter = 2;
  while (seen.has(next)) {
    next = `${fallback}-${counter}`;
    counter += 1;
  }
  seen.add(next);
  return next;
}

/**
 * Converts an ID string to a human-readable label by replacing separators with spaces
 * and capitalizing words.
 * @param {string} value - The ID to humanize
 * @returns {string} Human-readable label
 */
export function humanizeId(value) {
  return String(value || "Criterion")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Normalizes a config ID, keeping it as-is if it's already alphanumeric with underscores/hyphens,
 * otherwise slugifying it.
 * @param {string} value - The value to normalize
 * @returns {string} Normalized config ID
 */
export function configId(value) {
  const text = String(value || "").trim();
  if (/^[A-Za-z0-9_-]+$/.test(text)) return text;
  return slugify(text);
}

/**
 * Converts a string to a URL-safe slug by lowercasing and replacing non-alphanumeric
 * characters with hyphens.
 * @param {string} value - The string to slugify
 * @returns {string} URL-safe slug
 */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "candidate";
}

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * @param {string} value - The string to escape
 * @returns {string} HTML-escaped string
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Escapes HTML attribute values, including backticks.
 * @param {string} value - The string to escape
 * @returns {string} Attribute-escaped string
 */
export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

/**
 * Escapes a string for use in CSS selectors, using the native CSS.escape if available.
 * @param {string} value - The string to escape
 * @returns {string} CSS-escaped string
 */
export function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

/**
 * Sanitizes a table cell value by replacing pipe characters with slashes and trimming whitespace.
 * @param {string} value - The cell value to sanitize
 * @returns {string} Sanitized cell value
 */
export function cell(value) {
  return String(value ?? "").replace(/\|/g, "/").trim();
}

let toastTimer = 0;

/**
 * Displays a toast notification message that automatically disappears after 2.3 seconds.
 * @param {string} message - The message to display
 */
export function showToast(message) {
  window.clearTimeout(toastTimer);
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.querySelector("[data-app-shell]")?.append(toast);
  toastTimer = window.setTimeout(() => toast.remove(), 2300);
}

/**
 * Generates an SVG data URI with the candidate's initials as a placeholder image.
 * @param {string} name - The candidate name to extract initials from
 * @returns {string} Data URI containing the SVG image
 */
export function generateInitialsSVG(name) {
  const words = name.trim().split(/\s+/);
  const initials = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  
  // Generate a consistent color based on the name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Multiply by a large prime to spread similar names across the hue spectrum
  const hue = Math.abs((hash * 2654435761) % 360);
  const color1 = `hsl(${hue}, 55%, 65%)`;
  const color2 = `hsl(${(hue + 30) % 360}, 50%, 55%)`;
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${color1}"/>
        <stop offset="100%" stop-color="${color2}"/>
      </linearGradient>
    </defs>
    <rect width="200" height="200" fill="url(#bg)"/>
    <rect x="40" y="60" width="120" height="80" rx="16" fill="rgba(0,0,0,0.20)"/>
    <text x="100" y="100" font-size="56" fill="white" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="bold">${initials}</text>
  </svg>`;
  
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
