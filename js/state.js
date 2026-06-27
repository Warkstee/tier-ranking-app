/**
 * Application State
 * 
 * Centralized state management and DOM element references for the tier ranking application.
 * Contains the default configuration, mutable application state, and cached DOM queries.
 */

/**
 * Default configuration JSON used when no config file is available.
 * @type {string}
 */
export const DEFAULT_CONFIG = `{
  "title": "#S-Tier Ranking Board",
  "tiers": ["S", "A", "B", "C", "D", "F"],
  "min": 0,
  "max": 10,
  "rubric": [
    {
      "id": "ease",
      "name": "Ease of use",
      "weight": 1
    },
    {
      "id": "performance",
      "name": "Performance",
      "weight": 1
    }
  ],
  "candidates": [
    {
      "name": "Atlas",
      "image": "./assets/candidates/atlas.svg",
      "description": "Polished all-rounder.",
      "tier": "Unranked",
      "scores": {
        "ease": 8,
        "performance": 9
      }
    },
    {
      "name": "Beacon",
      "image": "./assets/candidates/beacon.svg",
      "description": "Friendly and quick to learn.",
      "tier": "Unranked",
      "scores": {
        "ease": 9,
        "performance": 7
      }
    }
  ]
}`;

/**
 * Mutable application state object.
 * @type {Object}
 * @property {string} title - The board title
 * @property {string[]} tiers - Array of tier names (e.g., ["S", "A", "B", "C", "D", "F"])
 * @property {Object[]} facets - Array of scoring facets/criteria
 * @property {Object[]} candidates - Array of candidate objects
 * @property {string|null} selectedId - ID of the currently selected candidate
 * @property {string} configText - Current configuration text
 * @property {string} configFormat - Configuration format ("json" or "markdown")
 * @property {string} configSource - Source of the current configuration
 */
export const state = {
  title: "S-Tier Ranking Board",
  tiers: ["S", "A", "B", "C", "D", "F"],
  min: 0,
  max: 10,
  facets: [],
  candidates: [],
  selectedId: null,
  configText: DEFAULT_CONFIG,
  configFormat: "json",
  configSource: "bundled config",
  currentRankingName: null
};

/**
 * Cached DOM element references for quick access throughout the application.
 * @type {Object}
 */
export const els = {
  app: document.querySelector("[data-app-shell]"),
  title: document.querySelector("[data-title]"),
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
  openAddCandidate: document.querySelector("[data-open-add-candidate]"),
  addCandidateModal: document.querySelector("[data-add-candidate-modal]"),
  addCandidateForm: document.querySelector("[data-add-candidate-form]"),
  addNameInput: document.querySelector("[data-add-candidate-name]"),
  addImageInput: document.querySelector("[data-add-candidate-image]"),
  closeAddCandidate: document.querySelector("[data-close-add-candidate]"),
  cancelAddCandidate: document.querySelector("[data-cancel-add-candidate]"),
  burgerButton: document.querySelector("[data-burger-menu]"),
  burgerDropdown: document.querySelector("[data-burger-dropdown]"),
  fileNew: document.querySelector("[data-file-new]"),
  fileOpen: document.querySelector("[data-file-open]"),
  fileSave: document.querySelector("[data-file-save]"),
  fileSaveAs: document.querySelector("[data-file-save-as]"),
  fileDelete: document.querySelector("[data-file-delete]"),
  currentRankingName: document.querySelector("[data-current-ranking-name]"),
  nameInputModal: document.querySelector("[data-name-input-modal]"),
  nameInputTitle: document.querySelector("[data-name-input-title]"),
  nameInputField: document.querySelector("[data-name-input-field]"),
  nameInputForm: document.querySelector("[data-name-input-form]"),
  closeNameInput: document.querySelector("[data-close-name-input]"),
  cancelNameInput: document.querySelector("[data-cancel-name-input]"),
  openRankingModal: document.querySelector("[data-open-ranking-modal]"),
  openRankingList: document.querySelector("[data-open-ranking-list]"),
  closeOpenRanking: document.querySelector("[data-close-open-ranking]"),
  closeOpenRankingFooter: document.querySelector("[data-close-open-ranking-footer]")
};
