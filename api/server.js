/**
 * Config API Server
 *
 * A minimal Node.js HTTP server.
 * 
 * Exposes POST /api/config endpoint for persisting the tier ranking board's JSON configuration to
 * disk. Writes are performed directly to the mounted tier-ranking.json file, which is shared with the nginx
 * container via a Docker bind mount.
 *
 * Exposes POST /api/uploadimg for uploading candidate images to /app/assets/candidates/.
 */
import { createServer } from "http";
import { writeFile, mkdir } from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { join, basename } from "path";
import Busboy from "busboy";

const PORT = 3001;
const CONFIG_PATH = "/app/tier-ranking.json";
const UPLOAD_DIR = "/app/assets/candidates";
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const server = createServer(async (req, res) => {

  /**
   * @swagger
   * /api/v1/activities:
   *   post:
   *     summary: Ingest activity data
   *     tags: [Activities]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - activityData
   *               - userId
   *             properties:
   *               activityData:
   *                 type: object
   *                 description: The activity data to be ingested
   *               userId:
   *                 type: string
   *                 description: The ID of the user associated with this activity
   *     responses:
   *       201:
   *         description: Activity data ingested successfully
   *       400:
   *         description: Bad request
   */
  if (req.method === "POST" && req.url === "/api/config") {
    try {
      const body = await readBody(req);

      if (!body.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Empty body" }));
        return;
      }

      // Write file
      await writeFile(CONFIG_PATH, body, "utf8");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error("Failed to write config:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to write config" }));
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
    try {
      await mkdir(UPLOAD_DIR, { recursive: true });

      // Debug: log incoming headers
      //console.log("Upload request headers:", req.headers);

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

        const fullPath = join(UPLOAD_DIR, sanitized);
        uploadedPath = `./assets/candidates/${sanitized}`;

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