/**
 * Share route handlers
 */
import { randomUUID } from "crypto";
import { getDb } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sanitizeRankingName } from "../utils/security.js";
import { reconstructRankingData } from "../utils/ranking-builder.js";

export async function handleShareRoutes(req, res) {
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
   *       401:
   *         description: Authentication required
   *       404:
   *         description: Ranking not found
   *       500:
   *         description: Failed to create share link
   */
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
}
