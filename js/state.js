/**
 * Application State
 * 
 * Centralized state management and DOM element references for the tier ranking application.
 * Contains the default configuration, mutable application state, and cached DOM queries.
 */

import { DEFAULT_CONFIG } from "./default-config.js";
export { DEFAULT_CONFIG };

/**
 * Mutable application state object.
 * @type {Object}
 * @property {string} title - The board title
 * @property {string[]} tiers - Array of tier names (e.g., ["S", "A", "B", "C", "D", "F"])
 * @property {Object[]} facets - Array of scoring facets/criteria
 * @property {Object[]} candidates - Array of candidate objects
 * @property {string|null} selectedId - ID of the currently selected candidate
 * @property {string} configText - Current configuration text

 * @property {string} configSource - Source of the current configuration
 */
export const state = {
  title: "S-Tier Ranking Board",
  tiers: [
    { id: "tier-1", name: "S", position: 1 },
    { id: "tier-2", name: "A", position: 2 },
    { id: "tier-3", name: "B", position: 3 },
    { id: "tier-4", name: "C", position: 4 },
    { id: "tier-5", name: "D", position: 5 },
    { id: "tier-6", name: "F", position: 6 }
  ],
  min: 0,
  max: 10,
  facets: [],
  candidates: [],
  selectedId: null,
  compareIds: { left: null, right: null },
  configText: DEFAULT_CONFIG,

  configSource: "bundled config",
  currentRankingName: null,
  isDirty: false,
  ahpComparisons: {}
};

/**
 * Cached DOM element references for quick access throughout the application.
 * @type {Object}
 */
export const els = {
  app: document.querySelector("[data-app-shell]"),
  appShell: document.querySelector("[data-app-shell]"),
  title: document.querySelector("[data-title]"),
  titleEditBtn: document.querySelector("[data-title-edit]"),
  openConfig: document.querySelector("[data-open-config]"),
  resetConfig: document.querySelector("[data-reset-config]"),
  tierBoard: document.querySelector("[data-tier-board]"),
  unrankedList: document.querySelector("[data-unranked-list]"),
  unrankedCount: document.querySelector("[data-unranked-count]"),
  modal: document.querySelector("[data-modal]"),
  detailCard: document.querySelector("[data-detail-card]"),
  configModal: document.querySelector("[data-config-modal]"),
  configMin: document.querySelector("[data-config-min]"),
  configMax: document.querySelector("[data-config-max]"),
  facetsList: document.querySelector("[data-facets-list]"),
  addFacet: document.querySelector("[data-add-facet]"),
  cancelConfig: document.querySelector("[data-cancel-config]"),
  configStatus: document.querySelector("[data-config-status]"),
  closeConfig: document.querySelector("[data-close-config]"),
  applyConfigEdit: document.querySelector("[data-apply-config]"),
  // AHP modal elements
  ahpModal: document.querySelector("[data-ahp-modal]"),
  ahpCard: document.querySelector(".ahp-panel"),
  ahpCriteriaList: document.querySelector("[data-ahp-criteria-list]"),
  ahpComparisons: document.querySelector("[data-ahp-comparisons]"),
  ahpWeights: document.querySelector("[data-ahp-weights]"),
  ahpStatus: document.querySelector("[data-ahp-status]"),
  closeAhp: document.querySelector("[data-close-ahp]"),
  cancelAhp: document.querySelector("[data-cancel-ahp]"),
  applyAhp: document.querySelector("[data-apply-ahp]"),
  openAddCandidate: document.querySelector("[data-open-add-candidate]"),
  addCandidateModal: document.querySelector("[data-add-candidate-modal]"),
  addCandidateForm: document.querySelector("[data-add-candidate-form]"),
  addNameInput: document.querySelector("[data-add-candidate-name]"),
  addImageInput: document.querySelector("[data-add-candidate-image]"),
  closeAddCandidate: document.querySelector("[data-close-add-candidate]"),
  cancelAddCandidate: document.querySelector("[data-cancel-add-candidate]"),
  submitAddCandidate: document.querySelector("[data-submit-add-candidate]"),
  burgerButton: document.querySelector("[data-burger-menu]"),
  burgerDropdown: document.querySelector("[data-burger-dropdown]"),
  fileNew: document.querySelector("[data-file-new]"),
  fileOpen: document.querySelector("[data-file-open]"),
  fileSave: document.querySelector("[data-file-save]"),
  fileSaveAs: document.querySelector("[data-file-save-as]"),
  fileExport: document.querySelector("[data-file-export]"),
  fileImport: document.querySelector("[data-file-import]"),
  fileImportInput: document.querySelector("[data-file-import-input]"),
  fileDelete: document.querySelector("[data-file-delete]"),
  currentRankingName: document.querySelector("[data-current-ranking-name]"),
  fileName: document.querySelector("[data-file-name]"),
  fileStatus: document.querySelector("[data-file-status]"),
  nameInputModal: document.querySelector("[data-name-input-modal]"),
  nameInputTitle: document.querySelector("[data-name-input-title]"),
  nameInputField: document.querySelector("[data-name-input-field]"),
  nameInputForm: document.querySelector("[data-name-input-form]"),
  closeNameInput: document.querySelector("[data-close-name-input]"),
  cancelNameInput: document.querySelector("[data-cancel-name-input]"),
  rankingFlyout: document.querySelector("[data-ranking-flyout]"),
  rankingFlyoutList: document.querySelector("[data-ranking-flyout-list]"),
  openTierEditor: document.querySelector("[data-open-tier-editor]"),
  tierEditorModal: document.querySelector("[data-tier-editor-modal]"),
  tiersList: document.querySelector("[data-tiers-list]"),
  addTier: document.querySelector("[data-add-tier]"),
  closeTierEditor: document.querySelector("[data-close-tier]"),
  cancelTier: document.querySelector("[data-cancel-tier]"),
  applyTierEditor: document.querySelector("[data-apply-tier]"),
  tierStatus: document.querySelector("[data-tier-status]"),
  // Login elements
  loginOverlay: document.querySelector("[data-login-overlay]"),
  loginForm: document.querySelector("[data-login-form]"),
  loginError: document.querySelector("[data-login-error]"),
  loginUsername: document.querySelector("[data-login-username]"),
  loginPassword: document.querySelector("[data-login-password]"),
  loginSubmit: document.querySelector("[data-login-submit]"),
  showSignup: document.querySelector("[data-show-signup]"),
  // Signup elements
  signupOverlay: document.querySelector("[data-signup-overlay]"),
  signupForm: document.querySelector("[data-signup-form]"),
  signupError: document.querySelector("[data-signup-error]"),
  signupUsername: document.querySelector("[data-signup-username]"),
  signupPassword: document.querySelector("[data-signup-password]"),
  signupPasswordConfirm: document.querySelector("[data-signup-password-confirm]"),
  signupSubmit: document.querySelector("[data-signup-submit]"),
  showLogin: document.querySelector("[data-show-login]"),
  userInfo: document.querySelector("[data-user-info]"),
  userUsername: document.querySelector("[data-user-username]"),
  userLogout: document.querySelector("[data-user-logout]")
};

/**
 * Update the current ranking display in the top bar
 */
export function updateCurrentRankingDisplay() {
  if (state.currentRankingName) {
    els.fileName.textContent = state.currentRankingName;
    els.fileStatus.textContent = state.isDirty ? "Draft" : "Saved";
    els.fileStatus.className = "file-status-pill " + (state.isDirty ? "draft" : "saved");
  } else {
    els.fileName.textContent = "";
    els.fileStatus.textContent = "";
  }
}

/**
 * Mark the current file as dirty (unsaved changes)
 */
export function markDirty() {
  state.isDirty = true;
  updateCurrentRankingDisplay();
}

/**
 * Mark the current file as clean (saved)
 */
export function markClean() {
  state.isDirty = false;
  updateCurrentRankingDisplay();
}
