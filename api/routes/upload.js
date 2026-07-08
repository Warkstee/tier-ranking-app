/**
 * Upload route handlers
 */
import { mkdir, stat, writeFile } from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { join, basename } from "path";
import { lookup as dnsLookup } from "dns/promises";
import Busboy from "busboy";
import { requireAuth } from "../middleware/auth.js";
import { isPrivateIP, sanitizeFilename } from "../utils/security.js";
import { readBody } from "../utils/request.js";

const UPLOAD_DIR = "/usr/share/nginx/html/assets/candidates";
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function handleUploadRoutes(req, res) {
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
   *       401:
   *         description: Authentication required
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
   *       401:
   *         description: Authentication required
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
}
