/**
 * Authentication module
 * 
 * Handles password hashing, JWT token generation and verification
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRY = '7d';
const BCRYPT_ROUNDS = 10;

/**
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>} True if password matches
 */
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token for a user
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @returns {string} JWT token
 */
export function generateToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify a JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Set authentication cookie
 * @param {Object} res - HTTP response object
 * @param {string} token - JWT token
 */
export function setAuthCookie(res, token) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const cookieParts = [
    `auth_token=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${7 * 24 * 60 * 60}` // 7 days
  ];
  
  if (isProduction) {
    cookieParts.push('Secure');
  }
  
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

/**
 * Clear authentication cookie
 * @param {Object} res - HTTP response object
 */
export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'auth_token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
}

/**
 * Extract token from request (cookie or Authorization header)
 * @param {Object} req - HTTP request object
 * @returns {string|null} JWT token or null
 */
export function extractToken(req) {
  // Try cookie first
  const cookies = req.headers.cookie || '';
  const authTokenCookie = cookies.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('auth_token='));
  
  if (authTokenCookie) {
    return authTokenCookie.split('=')[1];
  }
  
  // Fall back to Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  return null;
}
