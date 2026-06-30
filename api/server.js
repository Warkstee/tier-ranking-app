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
import { mkdir } from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { join, basename } from "path";
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
        'SELECT data_json FROM rankings WHERE user_id = ? AND name = ?'
      ).get(user.userId, name);
      
      if (!ranking) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Ranking not found" }));
        return;
      }
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(ranking.data_json);
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
      const body = await readBody(req);
      const data = JSON.parse(body);
      const title = data.title || null;
      
      const db = getDb();
      db.prepare(`
        INSERT INTO rankings (user_id, name, title, data_json, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, name) DO UPDATE SET
          title = excluded.title,
          data_json = excluded.data_json,
          updated_at = datetime('now')
      `).run(user.userId, name, title, body);
      
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

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

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