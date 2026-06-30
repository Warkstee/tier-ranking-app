/**
 * Authentication Module
 * 
 * Handles user authentication, session management, and auth UI.
 * Provides functions for login, signup, logout, and checking auth status.
 */

import { state, els } from './state.js';
import { cancelPendingSave } from './config.js';

// Auth state
let currentUser = null;
let authMode = 'login'; // 'login' or 'signup'

/**
 * Initialize authentication
 * Checks if user is already authenticated and updates UI accordingly
 * @returns {Promise<boolean>} True if authenticated, false otherwise
 */
export async function initAuth() {
  // Wire up auth UI event listeners
  wireAuthUI();
  
  // Check if user is already authenticated
  const user = await getCurrentUser();
  
  if (user) {
    currentUser = user;
    showApp();
    return true;
  } else {
    showAuthUI();
    return false;
  }
}

/**
 * Wire up auth UI event listeners
 */
function wireAuthUI() {
  // Auth form submission
  els.authForm.addEventListener('submit', handleAuthSubmit);
  
  // Submit button click (button is outside form, so manually trigger submission)
  els.authSubmit.addEventListener('click', (e) => {
    e.preventDefault();
    els.authForm.requestSubmit();
  });
  
  // Auth mode toggle (login/signup)
  els.authToggle.addEventListener('click', toggleAuthMode);
  
  // Logout button
  els.userLogout.addEventListener('click', handleLogout);
}

/**
 * Handle auth form submission
 * @param {Event} event - Form submit event
 */
async function handleAuthSubmit(event) {
  event.preventDefault();
  
  const username = els.authUsername.value.trim();
  const password = els.authPassword.value;
  
  if (!username || !password) {
    showAuthError('Please enter username and password');
    return;
  }
  
  // Disable submit button
  els.authSubmit.disabled = true;
  els.authSubmit.textContent = authMode === 'login' ? 'Signing in...' : 'Creating account...';
  
  try {
    if (authMode === 'login') {
      await login(username, password);
    } else {
      await signup(username, password);
    }
    
    // Get current user after successful auth
    const user = await getCurrentUser();
    if (user) {
      currentUser = user;
      showApp();
      // Dispatch event so app.js can initialize controls
      window.dispatchEvent(new CustomEvent('auth:authenticated'));
    } else {
      showAuthError('Authentication failed. Please try again.');
    }
  } catch (error) {
    console.error('Auth error:', error);
    showAuthError(error.message || 'Authentication failed. Please try again.');
  } finally {
    // Re-enable submit button
    els.authSubmit.disabled = false;
    els.authSubmit.textContent = authMode === 'login' ? 'Sign In' : 'Sign Up';
  }
}

/**
 * Toggle between login and signup modes
 */
function toggleAuthMode() {
  authMode = authMode === 'login' ? 'signup' : 'login';
  
  // Update UI
  els.authTitle.textContent = authMode === 'login' ? 'Sign In' : 'Sign Up';
  els.authSubmit.textContent = authMode === 'login' ? 'Sign In' : 'Sign Up';
  els.authToggleText.textContent = authMode === 'login' ? "Don't have an account?" : 'Already have an account?';
  els.authToggle.textContent = authMode === 'login' ? 'Sign Up' : 'Sign In';
  
  // Update password autocomplete
  els.authPassword.autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  
  // Clear any errors
  hideAuthError();
}

/**
 * Login with username and password
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<void>}
 */
async function login(username, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }
}

/**
 * Signup with username and password
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<void>}
 */
async function signup(username, password) {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Signup failed');
  }
}

/**
 * Logout current user
 */
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Logout error:', error);
  }
  
  // Cancel any pending autosave to prevent saving stale data under a different user
  cancelPendingSave();
  state.currentRankingName = null;
  
  currentUser = null;
  showAuthUI();
}

/**
 * Get current authenticated user
 * @returns {Promise<Object|null>} User object or null if not authenticated
 */
async function getCurrentUser() {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'include',
    });
    
    if (!response.ok) {
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Get current user error:', error);
    return null;
  }
}

/**
 * Show authentication UI (login/signup overlay)
 */
function showAuthUI() {
  els.authOverlay.hidden = false;
  els.appShell.style.display = 'none';
  els.userInfo.hidden = true;
  
  // Clear form
  els.authForm.reset();
  hideAuthError();
  
  // Focus username field
  setTimeout(() => els.authUsername.focus(), 100);
}

/**
 * Show main application (hide auth UI)
 */
function showApp() {
  els.authOverlay.hidden = true;
  els.appShell.style.display = '';
  
  // Update user info display
  if (currentUser) {
    els.userUsername.textContent = currentUser.username;
    els.userInfo.hidden = false;
  }
}

/**
 * Show authentication error message
 * @param {string} message - Error message to display
 */
function showAuthError(message) {
  els.authError.textContent = message;
  els.authError.hidden = false;
}

/**
 * Hide authentication error message
 */
function hideAuthError() {
  els.authError.hidden = true;
  els.authError.textContent = '';
}

/**
 * Check if user is currently authenticated
 * @returns {boolean} True if authenticated
 */
export function isAuthenticated() {
  return currentUser !== null;
}

/**
 * Get current user object
 * @returns {Object|null} Current user or null
 */
export function getCurrentUserObject() {
  return currentUser;
}

/**
 * Wrapper around fetch() that includes credentials and handles 401 responses
 * All API calls should use this instead of raw fetch()
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function apiFetch(url, options = {}) {
  // Always include credentials (cookies) for authentication
  options.credentials = 'include';
  
  const response = await fetch(url, options);
  
  // Handle 401 Unauthorized - redirect to login
  if (response.status === 401) {
    currentUser = null;
    showAuthUI();
    throw new Error('Authentication required. Please log in.');
  }
  
  return response;
}
