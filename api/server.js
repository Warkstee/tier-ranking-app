/**
 * Config API Server
 *
 * A minimal Node.js HTTP server.
 * 
 * Exposes endpoints for managing tier ranking boards:
 * - GET/POST/DELETE /api/rankings/:name for managing named rankings
 * - POST /api/uploadimg for uploading candidate images to /app/assets/candidates/
 */
import { createServer } from "http";
import { initDatabase } from "./db.js";
import { handleAuthRoutes } from "./routes/auth.js";
import { handleRankingsRoutes } from "./routes/rankings.js";
import { handleScreenshotsRoutes } from "./routes/screenshots.js";
import { handleUploadRoutes } from "./routes/upload.js";
import { handleShareRoutes } from "./routes/share.js";
import { handleHealthRoute, handleStatsRoute } from "./routes/health.js";

// Initialize database on startup
initDatabase();

const PORT = 3001;

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/auth/')) {
      return handleAuthRoutes(req, res);
    }
    if (req.url.startsWith('/api/rankings')) {
      return handleRankingsRoutes(req, res);
    }
    if (req.url.startsWith('/api/screenshots')) {
      return handleScreenshotsRoutes(req, res);
    }
    if (req.url.startsWith('/api/upload')) {
      return handleUploadRoutes(req, res);
    }
    if (req.url.startsWith('/api/share') || req.url.startsWith('/api/shared')) {
      return handleShareRoutes(req, res);
    }
    if (req.url === '/api/health') {
      return handleHealthRoute(req, res);
    }
    if (req.url === '/api/stats') {
      return handleStatsRoute(req, res);
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    console.error("Unhandled error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});