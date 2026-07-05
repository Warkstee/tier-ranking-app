/**
 * Share Modal Module
 *
 * Handles generating and displaying shareable read-only links for rankings.
 * Allows users to copy the link to their clipboard.
 */

import { state, els } from "./state.js";
import { apiFetch } from "./auth.js";
import { showToast } from "./utils.js";

/**
 * Opens the share modal and generates a share link for the current ranking.
 */
export function openShareModal() {
  if (!state.currentRankingName) {
    showToast("Save the ranking first before sharing.");
    return;
  }

  els.shareModal.hidden = false;
  els.shareLinkInput.value = "";
  els.shareCopyBtn.textContent = "Copy";
  els.shareCopyBtn.classList.remove("copied");
  hideShareError();

  generateShareLink();
}

/**
 * Closes the share modal.
 */
export function closeShareModal() {
  els.shareModal.hidden = true;
}

/**
 * Generates a share link by calling the API.
 */
async function generateShareLink() {
  try {
    const res = await apiFetch(`/api/share/${state.currentRankingName}`, {
      method: "POST"
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to generate share link" }));
      showShareError(err.error || "Failed to generate share link");
      return;
    }

    const { url } = await res.json();
    const fullUrl = `${window.location.origin}${url}`;
    els.shareLinkInput.value = fullUrl;
    els.shareLinkInput.select();
  } catch (err) {
    console.error("Share link generation failed:", err);
    showShareError("Network error. Please try again.");
  }
}

/**
 * Copies the share link to the clipboard.
 */
export function copyShareLink() {
  const url = els.shareLinkInput.value;
  if (!url) return;

  navigator.clipboard.writeText(url).then(() => {
    els.shareCopyBtn.textContent = "Copied!";
    els.shareCopyBtn.classList.add("copied");
    setTimeout(() => {
      els.shareCopyBtn.textContent = "Copy";
      els.shareCopyBtn.classList.remove("copied");
    }, 2000);
  }).catch(() => {
    // Fallback for older browsers
    els.shareLinkInput.select();
    document.execCommand("copy");
    els.shareCopyBtn.textContent = "Copied!";
    els.shareCopyBtn.classList.add("copied");
    setTimeout(() => {
      els.shareCopyBtn.textContent = "Copy";
      els.shareCopyBtn.classList.remove("copied");
    }, 2000);
  });
}

/**
 * Shows an error message in the share modal.
 * @param {string} message - The error message to display
 */
function showShareError(message) {
  els.shareError.textContent = message;
  els.shareError.hidden = false;
}

/**
 * Hides the error message in the share modal.
 */
function hideShareError() {
  els.shareError.hidden = true;
}

/**
 * Wires up share modal event listeners.
 */
export function wireShareModalControls() {
  els.shareCopyBtn.addEventListener("click", copyShareLink);
  els.shareClose.addEventListener("click", closeShareModal);
  els.shareCancel.addEventListener("click", closeShareModal);

  // Close on backdrop click
  els.shareModal.addEventListener("click", (event) => {
    if (event.target === els.shareModal) {
      closeShareModal();
    }
  });
}
