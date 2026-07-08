/**
 * Security utilities for input validation and SSRF protection.
 */
import { basename } from "path";

/**
 * SSRF protection: check if an IP is private/internal
 */
export function isPrivateIP(ip) {
  // IPv4 private ranges
  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0
    if (parts[0] === 0) return true;
    // 100.64.0.0/10 (CGNAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  }
  
  // IPv6 private ranges
  const ipLower = ip.toLowerCase();
  if (ipLower === '::1' || ipLower === '::' || 
      ipLower.startsWith('fc') || ipLower.startsWith('fd') || 
      ipLower.startsWith('fe80') || ipLower === '0:0:0:0:0:0:0:1') {
    return true;
  }
  
  return false;
}

/**
 * Sanitize ranking name for use as filename
 */
export function sanitizeRankingName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

/**
 * Sanitize uploaded filenames to prevent path traversal
 */
export function sanitizeFilename(filename) {
  const base = basename(filename);
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug || slug.includes("..") || slug.includes("/")) {
    return null;
  }

  return slug;
}
