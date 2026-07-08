/**
 * Health & Stats API Routes
 *
 * - GET /api/health  — system health status with DB connectivity check
 * - GET /api/stats   — aggregate counts (users, rankings)
 *
 * Both endpoints are public (no authentication required).
 */
import { getDb } from "../db.js";

/**
 * Handle GET /api/health
 *
 * Returns system health status including a live database connectivity check.
 * - 200 { status: "ok",       database: "connected",    timestamp }  when DB is reachable
 * - 503 { status: "degraded", database: "disconnected",  timestamp, error }  when DB check fails
 */
export function handleHealthRoute(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const timestamp = new Date().toISOString();

  try {
    const db = getDb();
    db.prepare("SELECT 1").get();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      database: "connected",
      timestamp,
    }));
  } catch (err) {
    console.error("Health check failed:", err);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "degraded",
      database: "disconnected",
      error: err.message,
      timestamp,
    }));
  }
}

/**
 * Handle GET /api/stats
 *
 * Returns aggregate counts for the system: number of users and number of rankings.
 * - 200 { users: <n>, rankings: <n> }
 * - 500 { error: "..." } on failure
 */
export function handleStatsRoute(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const db = getDb();
    const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const rankingCount = db.prepare("SELECT COUNT(*) AS count FROM rankings").get().count;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ users: userCount, rankings: rankingCount }));
  } catch (err) {
    console.error("Stats error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to retrieve stats" }));
  }
}
