/**
 * Authentication middleware
 */
import { extractToken, verifyToken } from "../auth.js";

/**
 * Require authentication - returns user payload or sends 401 and returns null
 */
export function requireAuth(req, res) {
  const token = extractToken(req);
  
  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Authentication required" }));
    return null;
  }
  
  const payload = verifyToken(token);
  
  if (!payload) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid or expired token" }));
    return null;
  }
  
  return payload;
}
