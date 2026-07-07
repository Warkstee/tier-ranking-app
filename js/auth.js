/**
 * Authentication Module
 * 
 * Handles user authentication, session management, and auth UI.
 * Provides functions for login, signup, logout, and checking auth status.
 */

import { state, els } from './state.js';
import { cancelPendingSave } from './config-parser.js';

// Auth state
let currentUser = null;

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
  // Login form submission
  els.loginForm.addEventListener('submit', handleLoginSubmit);
  els.loginSubmit.addEventListener('click', (e) => {
    e.preventDefault();
    els.loginForm.requestSubmit();
  });
  
  // Signup form submission
  els.signupForm.addEventListener('submit', handleSignupSubmit);
  els.signupSubmit.addEventListener('click', (e) => {
    e.preventDefault();
    els.signupForm.requestSubmit();
  });
  
  // Switch between modals
  els.showSignup.addEventListener('click', showSignupModal);
  els.showLogin.addEventListener('click', showLoginModal);
  
  // Logout button
  els.userLogout.addEventListener('click', handleLogout);
}

/**
 * Handle login form submission
 * @param {Event} event - Form submit event
 */
async function handleLoginSubmit(event) {
  event.preventDefault();
  
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  
  if (!username || !password) {
    showLoginError('Please enter username and password');
    return;
  }
  
  // Disable submit button
  els.loginSubmit.disabled = true;
  els.loginSubmit.textContent = 'Signing in...';
  
  try {
    await login(username, password);
    
    // Get current user after successful auth
    const user = await getCurrentUser();
    if (user) {
      currentUser = user;
      showApp();
      // Dispatch event so app.js can initialize controls
      window.dispatchEvent(new CustomEvent('auth:authenticated'));
    } else {
      showLoginError('Authentication failed. Please try again.');
    }
  } catch (error) {
    console.error('Auth error:', error);
    showLoginError(error.message || 'Login failed. Please try again.');
  } finally {
    // Re-enable submit button
    els.loginSubmit.disabled = false;
    els.loginSubmit.textContent = 'Sign In';
  }
}

/**
 * Handle signup form submission
 * @param {Event} event - Form submit event
 */
async function handleSignupSubmit(event) {
  event.preventDefault();
  
  const username = els.signupUsername.value.trim();
  const password = els.signupPassword.value;
  const passwordConfirm = els.signupPasswordConfirm.value;
  
  if (!username || !password) {
    showSignupError('Please enter username and password');
    return;
  }
  
  if (password !== passwordConfirm) {
    showSignupError('Passwords do not match');
    return;
  }
  
  // Disable submit button
  els.signupSubmit.disabled = true;
  els.signupSubmit.textContent = 'Creating account...';
  
  try {
    await signup(username, password);
    
    // Get current user after successful auth
    const user = await getCurrentUser();
    if (user) {
      currentUser = user;
      showApp();
      // Dispatch event so app.js can initialize controls
      window.dispatchEvent(new CustomEvent('auth:authenticated'));
    } else {
      showSignupError('Authentication failed. Please try again.');
    }
  } catch (error) {
    console.error('Auth error:', error);
    showSignupError(error.message || 'Signup failed. Please try again.');
  } finally {
    // Re-enable submit button
    els.signupSubmit.disabled = false;
    els.signupSubmit.textContent = 'Sign Up';
  }
}

/**
 * Show signup modal
 */
function showSignupModal() {
  els.loginOverlay.hidden = true;
  els.signupOverlay.hidden = false;
  els.signupForm.reset();
  hideSignupError();
  setTimeout(() => els.signupUsername.focus(), 100);
}

/**
 * Show login modal
 */
function showLoginModal() {
  els.signupOverlay.hidden = true;
  els.loginOverlay.hidden = false;
  els.loginForm.reset();
  hideLoginError();
  setTimeout(() => els.loginUsername.focus(), 100);
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
 * Show authentication UI (login overlay)
 */
function showAuthUI() {
  els.loginOverlay.hidden = false;
  els.signupOverlay.hidden = true;
  els.appShell.style.display = 'none';
  els.userInfo.hidden = true;
  
  // Clear forms
  els.loginForm.reset();
  els.signupForm.reset();
  hideLoginError();
  hideSignupError();
  
  // Focus username field
  setTimeout(() => els.loginUsername.focus(), 100);
}

/**
 * Show main application (hide auth UI)
 */
function showApp() {
  els.loginOverlay.hidden = true;
  els.signupOverlay.hidden = true;
  els.appShell.style.display = '';
  
  // Update user info display
  if (currentUser) {
    els.userUsername.textContent = currentUser.username;
    els.userInfo.hidden = false;
  }
}

/**
 * Show login error message
 * @param {string} message - Error message to display
 */
function showLoginError(message) {
  els.loginError.textContent = message;
  els.loginError.hidden = false;
}

/**
 * Hide login error message
 */
function hideLoginError() {
  els.loginError.hidden = true;
  els.loginError.textContent = '';
}

/**
 * Show signup error message
 * @param {string} message - Error message to display
 */
function showSignupError(message) {
  els.signupError.textContent = message;
  els.signupError.hidden = false;
}

/**
 * Hide signup error message
 */
function hideSignupError() {
  els.signupError.hidden = true;
  els.signupError.textContent = '';
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
