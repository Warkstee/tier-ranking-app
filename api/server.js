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
import { mkdir, stat, writeFile } from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { join, basename } from "path";
import { randomUUID } from "crypto";
import { lookup as dnsLookup } from "dns/promises";
import Busboy from "busboy";
import { initDatabase, getDb } from "./db.js";
import { 
  hashPassword, 
  verifyPassword, 
  generateToken, 
  verifyToken, 
  setAuthCookie, 
  clearAuthCookie, 
  extractToken 
} from "./auth.js";

// Initialize database on startup
initDatabase();

const PORT = 3001;
const UPLOAD_DIR = "/usr/share/nginx/html/assets/candidates";
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// SSRF protection: check if an IP is private/internal
function isPrivateIP(ip) {
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

// Helper: Sanitize ranking name for use as filename
function sanitizeRankingName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

// Helper: Require authentication - returns user payload or sends 401 and returns null
function requireAuth(req, res) {
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

const server = createServer(async (req, res) => {

  // Auth endpoints
  if (req.method === "POST" && req.url === "/api/auth/signup") {
    try {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      // Validate username
      if (!username || typeof username !== 'string' || username.length < 3 || username.length > 30) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Username must be 3-30 characters" }));
        return;
      }
      
      // Validate username format (alphanumeric only)
      if (!/^[a-zA-Z0-9]+$/.test(username)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Username must be alphanumeric" }));
        return;
      }
      
      // Validate password
      if (!password || typeof password !== 'string' || password.length < 8) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Password must be at least 8 characters" }));
        return;
      }
      
      const db = getDb();
      
      // Check if username already exists
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Username already exists" }));
        return;
      }
      
      // Hash password and create user
      const passwordHash = await hashPassword(password);
      const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
      const userId = result.lastInsertRowid;
      
      // Generate token and set cookie
      const token = generateToken(userId, username);
      setAuthCookie(res, token);
      
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, userId, username }));
    } catch (err) {
      console.error("Signup error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Signup failed" }));
    }
    return;
  }
  
  if (req.method === "POST" && req.url === "/api/auth/login") {
    try {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      if (!username || !password) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Username and password required" }));
        return;
      }
      
      const db = getDb();
      const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
      
      if (!user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid credentials" }));
        return;
      }
      
      const validPassword = await verifyPassword(password, user.password_hash);
      if (!validPassword) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid credentials" }));
        return;
      }
      
      // Generate token and set cookie
      const token = generateToken(user.id, user.username);
      setAuthCookie(res, token);
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, userId: user.id, username: user.username }));
    } catch (err) {
      console.error("Login error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Login failed" }));
    }
    return;
  }
  
  if (req.method === "POST" && req.url === "/api/auth/logout") {
    clearAuthCookie(res);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }
  
  if (req.method === "GET" && req.url === "/api/auth/me") {
    try {
      const token = extractToken(req);
      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not authenticated" }));
        return;
      }
      
      const payload = verifyToken(token);
      if (!payload) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
        return;
      }
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ userId: payload.userId, username: payload.username }));
    } catch (err) {
      console.error("Auth check error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Auth check failed" }));
    }
    return;
  }

  /**
   * @swagger
   * /api/rankings:
   *   get:
   *     summary: List all saved rankings
   *     description: >
   *       Returns a list of all saved rankings with their names and
   *       modification timestamps. Results are sorted by modification
   *       time, with the most recently modified ranking first.
   *     tags: [Rankings]
   *     responses:
   *       200:
   *         description: List of rankings retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   name:
   *                     type: string
   *                     description: The ranking name (sanitized filename without .json extension)
   *                     example: "my-ranking"
   *                   modifiedAt:
   *                     type: string
   *                     format: date-time
   *                     description: ISO 8601 timestamp of last modification
   *                     example: "2026-06-28T10:30:00.000Z"
   *       500:
   *         description: Failed to list rankings
   */
  if (req.method === "GET" && req.url === "/api/rankings") {
    const user = requireAuth(req, res);
    if (!user) return;
    
    try {
      const db = getDb();
      const rankings = db.prepare(
        'SELECT name, title, updated_at FROM rankings WHERE user_id = ? ORDER BY updated_at DESC'
      ).all(user.userId);
      
      const result = rankings.map(r => ({
        name: r.name,
        title: r.title,
        modifiedAt: r.updated_at
      }));
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error("Failed to list rankings:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to list rankings" }));
    }
    return;
  }

  /**
   * @swagger
   * /api/rankings/{name}:
   *   get:
   *     summary: Load a specific ranking
   *     description: >
   *       Retrieves the full JSON data for a specific ranking by name.
   *       The name is sanitized to prevent path traversal attacks.
   *     tags: [Rankings]
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *         description: The ranking name (will be sanitized)
   *         example: "my-ranking"
   *     responses:
   *       200:
   *         description: Ranking data retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               description: The full ranking JSON data
   *       400:
   *         description: Invalid ranking name
   *       404:
   *         description: Ranking not found
   *       500:
   *         description: Failed to load ranking
   */
  if (req.method === "GET" && req.url.startsWith("/api/rankings/")) {
    const user = requireAuth(req, res);
    if (!user) return;
    
    const name = sanitizeRankingName(req.url.split('/api/rankings/')[1]);
    if (!name) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid ranking name" }));
      return;
    }
    
    try {
      const db = getDb();
      const ranking = db.prepare(
        'SELECT id FROM rankings WHERE user_id = ? AND name = ?'
      ).get(user.userId, name);
      
      if (!ranking) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Ranking not found" }));
        return;
      }
      
      const data = reconstructRankingData(db, ranking.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error("Failed to load ranking:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to load ranking" }));
    }
    return;
  }


  /**
   * @swagger
   * /api/rankings/{name}:
   *   post:
   *     summary: Save a ranking
   *     description: >
   *       Saves or updates a ranking with the specified name. The ranking
   *       data is written as JSON to the rankings directory. The name is
   *       sanitized to prevent path traversal attacks.
   *     tags: [Rankings]
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *         description: The ranking name (will be sanitized)
   *         example: "my-ranking"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             description: The ranking data to save
   *     responses:
   *       200:
   *         description: Ranking saved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 name:
   *                   type: string
   *                   description: The sanitized ranking name
   *                   example: "my-ranking"
   *       400:
   *         description: Invalid ranking name
   *       500:
   *         description: Failed to save ranking
   */
  if (req.method === "POST" && req.url.startsWith("/api/rankings/")) {
    const user = requireAuth(req, res);
    if (!user) return;
    
    const name = sanitizeRankingName(req.url.split('/api/rankings/')[1]);
    if (!name) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid ranking name" }));
      return;
    }
    
    try {
      const data = JSON.parse(await readBody(req));
      const db = getDb();
      
      // Save strategy: Delete-then-reinsert within a transaction.
      // The client sends the complete desired state, so we clear all child rows and re-insert. 
      // The transaction guarantees atomicity. If any insert fails, the entire operation rolls back and no data is lost.
      // This is simpler than diffing old vs new and matches the "full replacement" semantics of the save operation.
      const saveRanking = db.transaction(() => {
        // 1. Upsert ranking metadata
        db.prepare(`
          INSERT INTO rankings (user_id, name, title, min_score, max_score, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, name) DO UPDATE SET
            title = excluded.title,
            min_score = excluded.min_score,
            max_score = excluded.max_score,
            updated_at = datetime('now')
        `).run(user.userId, name, data.title || null, data.min ?? 0, data.max ?? 10);
        
        const rankingId = db.prepare(
          'SELECT id FROM rankings WHERE user_id = ? AND name = ?'
        ).get(user.userId, name).id;
        
        // 2. Clear existing child rows (cascade handles scores via candidates)
        db.prepare('DELETE FROM ahp_comparisons WHERE ranking_id = ?').run(rankingId);
        db.prepare('DELETE FROM candidates WHERE ranking_id = ?').run(rankingId);
        db.prepare('DELETE FROM criteria WHERE ranking_id = ?').run(rankingId);
        db.prepare('DELETE FROM tiers WHERE ranking_id = ?').run(rankingId);
        
        // 3. Insert tiers and build client_id -> db id map
        const tierIdMap = {};
        const insertTier = db.prepare(
          'INSERT INTO tiers (ranking_id, client_id, name, position) VALUES (?, ?, ?, ?)'
        );
        for (const tier of (data.tiers || [])) {
          const info = insertTier.run(rankingId, tier.id, tier.name, tier.position);
          tierIdMap[tier.id] = info.lastInsertRowid;
        }
        
        // 4. Insert criteria and build client_id -> db id map
        const criteriaIdMap = {};
        const insertCriteria = db.prepare(
          'INSERT INTO criteria (ranking_id, client_id, name, weight) VALUES (?, ?, ?, ?)'
        );
        for (const criterion of (data.criteria || [])) {
          const info = insertCriteria.run(rankingId, criterion.id, criterion.name, criterion.weight);
          criteriaIdMap[criterion.id] = info.lastInsertRowid;
        }
        
        // 5. Insert candidates and build client_id -> db id map
        const candidateIdMap = {};
        const insertCandidate = db.prepare(
          'INSERT INTO candidates (ranking_id, client_id, tier_id, name, image, description, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        for (const candidate of (data.candidates || [])) {
          const dbTierId = candidate.tierId ? (tierIdMap[candidate.tierId] || null) : null;
          const info = insertCandidate.run(
            rankingId, candidate.id, dbTierId,
            candidate.name, candidate.image || null,
            candidate.description || null, candidate.notes || null
          );
          candidateIdMap[candidate.id] = info.lastInsertRowid;
        }
        
        // 6. Insert scores
        const insertScore = db.prepare(
          'INSERT INTO scores (candidate_id, criteria_id, score) VALUES (?, ?, ?)'
        );
        for (const candidate of (data.candidates || [])) {
          const dbCandidateId = candidateIdMap[candidate.id];
          if (!dbCandidateId || !candidate.scores) continue;
          for (const [criterionClientId, scoreValue] of Object.entries(candidate.scores)) {
            const dbCriteriaId = criteriaIdMap[criterionClientId];
            if (dbCriteriaId) {
              insertScore.run(dbCandidateId, dbCriteriaId, scoreValue);
            }
          }
        }
        
        // 7. Insert AHP comparisons
        const insertAhp = db.prepare(
          'INSERT INTO ahp_comparisons (ranking_id, criterion_a_id, criterion_b_id, favored_id, degree) VALUES (?, ?, ?, ?, ?)'
        );
        const ahpComparisons = data.ahpComparisons || {};
        for (const [pairKey, comparison] of Object.entries(ahpComparisons)) {
          const [idA, idB] = pairKey.split('::');
          insertAhp.run(rankingId, idA, idB, comparison.favoredId || null, comparison.degree || 1);
        }
      });
      
      saveRanking();
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, name }));
    } catch (err) {
      console.error("Failed to save ranking:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to save ranking" }));
    }
    return;
  }


  /**
   * @swagger
   * /api/rankings/{name}:
   *   delete:
   *     summary: Delete a ranking
   *     description: >
   *       Deletes a ranking file by name. The name is sanitized to prevent
   *       path traversal attacks.
   *     tags: [Rankings]
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *         description: The ranking name (will be sanitized)
   *         example: "my-ranking"
   *     responses:
   *       200:
   *         description: Ranking deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *       400:
   *         description: Invalid ranking name
   *       404:
   *         description: Ranking not found
   *       500:
   *         description: Failed to delete ranking
   */
  if (req.method === "DELETE" && req.url.startsWith("/api/rankings/")) {
    const user = requireAuth(req, res);
    if (!user) return;
    
    const name = sanitizeRankingName(req.url.split('/api/rankings/')[1]);
    if (!name) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid ranking name" }));
      return;
    }
    
    try {
      const db = getDb();
      const result = db.prepare(
        'DELETE FROM rankings WHERE user_id = ? AND name = ?'
      ).run(user.userId, name);
      
      if (result.changes === 0) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Ranking not found" }));
        return;
      }
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      console.error("Failed to delete ranking:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to delete ranking" }));
    }
    return;
  }


  /**
   * @swagger
   * /api/uploadimg:
   *   post:
   *     summary: Upload a candidate image
   *     description: >
   *       Accepts a multipart file upload and writes the image to
   *       /app/assets/candidates/. The file is validated for MIME type
   *       and size (max 5MB). The filename is sanitized to prevent
   *       path traversal attacks.
   *     tags: [Upload]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               image:
   *                 type: string
   *                 format: binary
   *                 description: The image file to upload
   *     responses:
   *       200:
   *         description: Image uploaded successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 path:
   *                   type: string
   *                   description: Relative path to the uploaded image
   *                   example: "./assets/candidates/my-image.png"
   *       400:
   *         description: >
   *           Bad request — no file provided, invalid MIME type,
   *           invalid filename, or file size limit exceeded
   *       500:
   *         description: Upload failed
   */
  if (req.method === "POST" && req.url === "/api/uploadimg") {
    const user = requireAuth(req, res);
    if (!user) return;
    
    try {
      // Create user-specific upload directory
      const userUploadDir = join(UPLOAD_DIR, String(user.userId));
      await mkdir(userUploadDir, { recursive: true });

      const busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_FILE_SIZE, files: 1 }
      });

      let uploadedPath = null;
      let fileError = null;

      busboy.on("file", (fieldname, file, info) => {
        const { filename, mimeType } = info;

        if (!filename) {
          fileError = "No filename provided";
          file.resume();
          return;
        }

        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
          fileError = `Invalid MIME type: ${mimeType}`;
          file.resume();
          return;
        }

        const sanitized = sanitizeFilename(filename);
        if (!sanitized) {
          fileError = "Invalid filename";
          file.resume();
          return;
        }

        const fullPath = join(userUploadDir, sanitized);
        uploadedPath = `./assets/candidates/${user.userId}/${sanitized}`;

        file.on("limit", () => {
          fileError = "File size limit exceeded";
        });

        pipeline(file, createWriteStream(fullPath)).catch((err) => {
          fileError = `Failed to write file: ${err.message}`;
        });
      });

      busboy.on("finish", async () => {
        if (fileError) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: fileError }));
          return;
        }

        if (!uploadedPath) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No file uploaded" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: uploadedPath }));
      });

      busboy.on("error", (err) => {
        console.error("Busboy error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Upload failed" }));
      });

      req.pipe(busboy);
    } catch (err) {
      console.error("Upload error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upload failed" }));
    }
    return;
  }


  /**
   * @swagger
   * /api/uploadimgurl:
   *   post:
   *     summary: Upload a candidate image from a URL
   *     description: >
   *       Downloads an image from the provided URL and saves it to
   *       /app/assets/candidates/. The URL is validated for SSRF protection,
   *       and the downloaded content is validated for MIME type and size (max 5MB).
   *       The filename is derived from the URL path or generated from the content type.
   *     tags: [Upload]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               url:
   *                 type: string
   *                 format: uri
   *                 description: The URL of the image to download
   *                 example: "https://example.com/image.png"
   *     responses:
   *       200:
   *         description: Image downloaded and saved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 path:
   *                   type: string
   *                   description: Relative path to the saved image
   *                   example: "./assets/candidates/1/image.png"
   *       400:
   *         description: >
   *           Bad request — invalid URL, private IP, invalid content type,
   *           or file size limit exceeded
   *       408:
   *         description: Request timed out (10s limit)
   *       500:
   *         description: Upload failed
   */
  if (req.method === "POST" && req.url === "/api/uploadimgurl") {
    const user = requireAuth(req, res);
    if (!user) return;
    
    try {
      // Read JSON body
      const body = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }
      
      const { url } = payload;
      if (!url || typeof url !== 'string') {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "URL is required" }));
        return;
      }
      
      // Parse and validate URL
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid URL format" }));
        return;
      }
      
      // Only allow http/https
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Only http and https URLs are allowed" }));
        return;
      }
      
      // Check port (only allow standard ports)
      const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80);
      if (port !== 80 && port !== 443) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Only standard ports (80, 443) are allowed" }));
        return;
      }
      
      // Resolve DNS and check for private IPs (SSRF protection)
      const hostname = parsedUrl.hostname;
      let resolvedIP;
      try {
        const result = await dnsLookup(hostname);
        resolvedIP = result.address;
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Could not resolve hostname: ${hostname}` }));
        return;
      }
      
      if (isPrivateIP(resolvedIP)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "URL resolves to a private/internal IP address" }));
        return;
      }
      
      // Fetch the URL with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'TierRankingApp/1.0'
          }
        });
      } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
          res.writeHead(408, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request timed out (10s limit)" }));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Failed to fetch URL: ${err.message}` }));
        }
        return;
      }
      clearTimeout(timeout);
      
      if (!response.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `URL returned HTTP ${response.status}` }));
        return;
      }
      
      // Validate content-type
      const contentType = response.headers.get('content-type');
      if (!contentType) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "URL did not return a Content-Type header" }));
        return;
      }
      
      // Extract MIME type (ignore parameters like charset)
      const mimeType = contentType.split(';')[0].trim().toLowerCase();
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Invalid content type: ${mimeType}. Allowed: jpeg, png, gif, webp` }));
        return;
      }
      
      // Check content-length if available
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Image too large (${contentLength} bytes). Max: 5MB` }));
        return;
      }
      
      // Read response body with size limit
      const reader = response.body.getReader();
      const chunks = [];
      let totalSize = 0;
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          totalSize += value.length;
          if (totalSize > MAX_FILE_SIZE) {
            await reader.cancel();
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Image too large (exceeded 5MB limit)" }));
            return;
          }
          
          chunks.push(value);
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Failed to read response: ${err.message}` }));
        return;
      }
      
      // Combine chunks into a single buffer
      const imageBuffer = Buffer.concat(chunks);
      
      // Derive filename from URL path
      const urlPath = parsedUrl.pathname;
      const urlFilename = basename(urlPath);
      let sanitized = sanitizeFilename(urlFilename);
      
      if (!sanitized) {
        // Fallback: derive extension from content-type
        const extMap = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/gif': 'gif',
          'image/webp': 'webp'
        };
        const ext = extMap[mimeType] || 'jpg';
        sanitized = `image-${Date.now()}.${ext}`;
      }
      
      // Create user-specific upload directory
      const userUploadDir = join(UPLOAD_DIR, String(user.userId));
      await mkdir(userUploadDir, { recursive: true });
      
      // Handle filename collisions by appending timestamp
      let finalFilename = sanitized;
      let fullPath = join(userUploadDir, finalFilename);
      let collisionCounter = 0;
      
      while (true) {
        try {
          await stat(fullPath);
          // File exists, generate a new name with timestamp
          collisionCounter++;
          const ext = sanitized.includes('.') ? sanitized.slice(sanitized.lastIndexOf('.') + 1) : 'jpg';
          const base = sanitized.includes('.') ? sanitized.slice(0, sanitized.lastIndexOf('.')) : sanitized;
          finalFilename = `${base}-${Date.now()}-${collisionCounter}.${ext}`;
          fullPath = join(userUploadDir, finalFilename);
        } catch {
          // File doesn't exist (stat threw ENOENT), we can use this name
          break;
        }
      }
      
      // Write the file
      await writeFile(fullPath, imageBuffer);
      
      const uploadedPath = `./assets/candidates/${user.userId}/${finalFilename}`;
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: uploadedPath }));
      
    } catch (err) {
      console.error("URL upload error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upload failed" }));
    }
    return;
  }


  /**
   * @swagger
   * /api/share/{name}:
   *   post:
   *     summary: Generate a shareable read-only link
   *     description: >
   *       Creates a unique token that grants public read-only access to a ranking.
   *       The token can be used to access the ranking without authentication via
   *       GET /api/shared/{token}. The link remains active until manually revoked.
   *     tags: [Sharing]
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *         description: The ranking name (will be sanitized)
   *         example: "my-ranking"
   *     responses:
   *       201:
   *         description: Share link created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 token:
   *                   type: string
   *                   format: uuid
   *                   description: The unique share token
   *                   example: "550e8400-e29b-41d4-a716-446655440000"
   *                 url:
   *                   type: string
   *                   description: The shareable URL path
   *                   example: "/shared/550e8400-e29b-41d4-a716-446655440000"
   *       400:
   *         description: Invalid ranking name
   *       404:
   *         description: Ranking not found
   *       500:
   *         description: Failed to create share link
   */
  // POST /api/share/:name — generate a shareable read-only link
  if (req.method === "POST" && req.url.startsWith("/api/share/")) {
    const user = requireAuth(req, res);
    if (!user) return;

    const name = sanitizeRankingName(req.url.split('/api/share/')[1]);
    if (!name) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid ranking name" }));
      return;
    }

    try {
      const db = getDb();
      const ranking = db.prepare(
        'SELECT id FROM rankings WHERE user_id = ? AND name = ?'
      ).get(user.userId, name);

      if (!ranking) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Ranking not found" }));
        return;
      }

      // Check if an active share link already exists for this ranking
      const existing = db.prepare(
        'SELECT token FROM shared_rankings WHERE ranking_id = ? AND is_active = 1'
      ).get(ranking.id);

      if (existing) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token: existing.token, url: `/shared/${existing.token}` }));
        return;
      }

      const token = randomUUID();
      db.prepare(
        'INSERT INTO shared_rankings (token, ranking_id, created_by) VALUES (?, ?, ?)'
      ).run(token, ranking.id, user.userId);

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token, url: `/shared/${token}` }));
    } catch (err) {
      console.error("Failed to create share link:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to create share link" }));
    }
    return;
  }


  /**
   * @swagger
   * /api/shared/{token}:
   *   get:
   *     summary: Access a shared ranking
   *     description: >
   *       Retrieves a ranking via a shareable token. No authentication required.
   *       Returns the ranking data in read-only format. The token must be valid,
   *       active, and not expired.
   *     tags: [Sharing]
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: The share token (UUID format)
   *         example: "550e8400-e29b-41d4-a716-446655440000"
   *     responses:
   *       200:
   *         description: Shared ranking retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 title:
   *                   type: string
   *                   nullable: true
   *                   description: The ranking title
   *                   example: "My Tier Ranking"
   *                 data:
   *                   type: object
   *                   description: The full ranking JSON data
   *       400:
   *         description: Invalid share token format
   *       404:
   *         description: Share link not found
   *       410:
   *         description: Share link has been revoked or has expired
   *       500:
   *         description: Failed to load shared ranking
   */
  if (req.method === "GET" && req.url.startsWith("/api/shared/")) {
    const token = req.url.split('/api/shared/')[1];
    if (!token || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid share token" }));
      return;
    }

    try {
      const db = getDb();
      const share = db.prepare(`
        SELECT sr.is_active, sr.expires_at, sr.ranking_id, r.title
        FROM shared_rankings sr
        JOIN rankings r ON r.id = sr.ranking_id
        WHERE sr.token = ?
      `).get(token);

      if (!share) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Share link not found" }));
        return;
      }

      if (!share.is_active) {
        res.writeHead(410, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "This share link has been revoked" }));
        return;
      }

      if (share.expires_at && new Date(share.expires_at) < new Date()) {
        res.writeHead(410, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "This share link has expired" }));
        return;
      }

      // Reconstruct ranking data from normalized tables
      const data = reconstructRankingData(db, share.ranking_id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ title: share.title, data }));
    } catch (err) {
      console.error("Failed to load shared ranking:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to load shared ranking" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

/**
 * Reconstruct full ranking data from normalized tables.
 * Queries all child tables and assembles the JSON structure
 * expected by the client.
 */
function reconstructRankingData(db, rankingId) {
  // 1. Ranking metadata
  const ranking = db.prepare(
    'SELECT title, min_score, max_score FROM rankings WHERE id = ?'
  ).get(rankingId);

  // 2. Tiers
  const tiers = db.prepare(
    'SELECT client_id, name, position FROM tiers WHERE ranking_id = ? ORDER BY position'
  ).all(rankingId).map(t => ({
    id: t.client_id,
    name: t.name,
    position: t.position
  }));

  // 3. Criteria
  const criteria = db.prepare(
    'SELECT client_id, name, weight FROM criteria WHERE ranking_id = ?'
  ).all(rankingId).map(c => ({
    id: c.client_id,
    name: c.name,
    weight: c.weight
  }));

  // 4. Build a db criteria id -> client id map for score reconstruction
  const criteriaDbToClient = {};
  const criteriaRows = db.prepare(
    'SELECT id, client_id FROM criteria WHERE ranking_id = ?'
  ).all(rankingId);
  for (const c of criteriaRows) {
    criteriaDbToClient[c.id] = c.client_id;
  }

  // 5. Build a db tier id -> client id map for candidate tier assignment
  const tierDbToClient = {};
  const tierRows = db.prepare(
    'SELECT id, client_id FROM tiers WHERE ranking_id = ?'
  ).all(rankingId);
  for (const t of tierRows) {
    tierDbToClient[t.id] = t.client_id;
  }

  // 6. Candidates with their scores
  const candidateRows = db.prepare(
    'SELECT id, client_id, tier_id, name, image, description, notes FROM candidates WHERE ranking_id = ?'
  ).all(rankingId);

  const candidates = candidateRows.map(cand => {
    // Get scores for this candidate
    const scoreRows = db.prepare(
      'SELECT criteria_id, score FROM scores WHERE candidate_id = ?'
    ).all(cand.id);

    const scores = {};
    for (const s of scoreRows) {
      const criterionClientId = criteriaDbToClient[s.criteria_id];
      if (criterionClientId) {
        scores[criterionClientId] = s.score;
      }
    }

    return {
      id: cand.client_id,
      name: cand.name,
      image: cand.image || null,
      description: cand.description || null,
      tierId: cand.tier_id ? (tierDbToClient[cand.tier_id] || null) : null,
      scores
    };
  });

  // 7. AHP comparisons
  const ahpRows = db.prepare(
    'SELECT criterion_a_id, criterion_b_id, favored_id, degree FROM ahp_comparisons WHERE ranking_id = ?'
  ).all(rankingId);

  const ahpComparisons = {};
  for (const row of ahpRows) {
    const pairKey = `${row.criterion_a_id}::${row.criterion_b_id}`;
    ahpComparisons[pairKey] = {
      favoredId: row.favored_id || null,
      degree: row.degree
    };
  }

  return {
    title: ranking.title,
    min: ranking.min_score,
    max: ranking.max_score,
    tiers,
    criteria,
    candidates,
    ahpComparisons
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sanitizeFilename(filename) {
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

server.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});