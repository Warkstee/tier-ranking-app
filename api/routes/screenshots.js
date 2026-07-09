/**
 * Screenshots route handlers
 */
import { mkdir } from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { join } from "path";
import Busboy from "busboy";
import { getDb } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sanitizeRankingName } from "../utils/security.js";

const SCREENSHOT_DIR = "/usr/share/nginx/html/assets/screenshots";
const SCREENSHOT_MAX_SIZE = 2 * 1024 * 1024; // 2MB

export async function handleScreenshotsRoutes(req, res) {
  /**
   * @swagger
   * /api/screenshots/{name}:
   *   post:
   *     summary: Upload a screenshot for a ranking
   *     description: >
   *       Accepts a multipart file upload containing a PNG screenshot
   *       of the ranking board. The screenshot is saved to the server
   *       and the ranking's screenshot path is updated in the database.
   *     tags: [Screenshots]
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
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               screenshot:
   *                 type: string
   *                 format: binary
   *                 description: The PNG screenshot file
   *     responses:
   *       200:
   *         description: Screenshot uploaded successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 path:
   *                   type: string
   *                   description: Relative path to the screenshot
   *                   example: "./assets/screenshots/1/my-ranking.png"
   *       400:
   *         description: Invalid ranking name, no file, or invalid file type
   *       401:
   *         description: Authentication required
   *       404:
   *         description: Ranking not found
   *       500:
   *         description: Upload failed
   */
  if (req.method === "POST" && req.url.startsWith("/api/screenshots/")) {
    const user = requireAuth(req, res);
    if (!user) return;

    const name = sanitizeRankingName(req.url.split("/api/screenshots/")[1]);
    if (!name) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid ranking name" }));
      return;
    }

    try {
      // Verify ranking exists
      const db = getDb();
      const ranking = db.prepare(
        "SELECT id FROM rankings WHERE user_id = ? AND name = ?"
      ).get(user.userId, name);

      if (!ranking) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Ranking not found" }));
        return;
      }

      // Create user-specific screenshot directory
      const userScreenshotDir = join(SCREENSHOT_DIR, String(user.userId));
      await mkdir(userScreenshotDir, { recursive: true });

      const busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: SCREENSHOT_MAX_SIZE, files: 1 },
      });

      let uploadedPath = null;
      let fileError = null;

      busboy.on("file", (fieldname, file, info) => {
        const { mimeType } = info;

        if (mimeType !== "image/png") {
          fileError = `Invalid MIME type: ${mimeType}. Only PNG is allowed.`;
          file.resume();
          return;
        }

        const filename = `${name}.png`;
        const fullPath = join(userScreenshotDir, filename);
        uploadedPath = `./assets/screenshots/${user.userId}/${filename}`;

        file.on("limit", () => {
          fileError = "File size limit exceeded (max 2MB)";
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

        // Update ranking's screenshot path
        db.prepare(
          "UPDATE rankings SET screenshot = ? WHERE user_id = ? AND name = ?"
        ).run(uploadedPath, user.userId, name);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, path: uploadedPath }));
      });

      busboy.on("error", (err) => {
        console.error("Screenshot upload error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Upload failed" }));
      });

      req.pipe(busboy);
    } catch (err) {
      console.error("Screenshot upload error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upload failed" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}
