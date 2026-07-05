/**
 * Undo Module
 * 
 * Provides single-step undo functionality for tier moves and score changes.
 * Captures a snapshot of a candidate's state before mutation, allowing
 * the most recent action to be undone via Ctrl+Z (Cmd+Z on Mac).
 */

import { state, markDirty } from "./state.js";
import { renderTierBoard, renderUnranked } from "./render.js";
import { syncConfigFromState } from "./config.js";

/**
 * Stores the last action snapshot for undo.
 * Contains the candidate ID, tier ID, and scores before the most recent mutation.
 * @type {Object|null}
 */
let lastAction = null;

/**
 * Saves a snapshot of a candidate's current state before mutation.
 * Overwrites any previous snapshot, ensuring only the most recent action can be undone.
 * @param {Object} candidate - The candidate object to snapshot
 * @param {string} candidate.id - The candidate's unique identifier
 * @param {string|null} candidate.tierId - The candidate's current tier assignment
 * @param {Object} candidate.scores - The candidate's current scores by facet
 */
export function saveUndo(candidate) {
  lastAction = {
    candidateId: candidate.id,
    tierId: candidate.tierId,
    scores: { ...candidate.scores }
  };
}

/**
 * Restores the last snapshot if one exists.
 * Reverts the candidate's tier and scores to their previous state,
 * then re-renders the UI and syncs the configuration.
 */
export function undo() {
  if (!lastAction) return;

  const candidate = state.candidates.find(c => c.id === lastAction.candidateId);
  if (!candidate) {
    lastAction = null;
    return;
  }

  // Restore state
  candidate.tierId = lastAction.tierId;
  candidate.scores = { ...lastAction.scores };

  // Clear the undo snapshot
  lastAction = null;

  // Re-render board and sidebar
  renderTierBoard();
  renderUnranked();

  // If detail modal is open for this candidate, re-render modal scores
  if (state.selectedId === candidate.id) {
    import("./modal.js").then(({ renderModal }) => renderModal(candidate));
  }

  // If compare modal is open and this candidate is being compared, re-render it
  if (state.compareIds.left === candidate.id || state.compareIds.right === candidate.id) {
    import("./compare-modal.js").then(({ renderCompareModal }) => renderCompareModal());
  }

  // Sync config and mark as dirty
  syncConfigFromState();
  markDirty();
}

/**
 * Clears the undo snapshot.
 * Called when a new configuration is loaded to prevent undoing actions
 * from a previous session.
 */
export function clearUndo() {
  lastAction = null;
}
