/**
 * Rankings route handlers
 */
import { getDb } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sanitizeRankingName } from "../utils/security.js";
import { readBody } from "../utils/request.js";
import { reconstructRankingData } from "../utils/ranking-builder.js";

export async function handleRankingsRoutes(req, res) {
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
   *                   title:
   *                     type: string
   *                     nullable: true
   *                     description: The ranking title
   *                     example: "My Tier Ranking"
   *                   modifiedAt:
   *                     type: string
   *                     format: date-time
   *                     description: ISO 8601 timestamp of last modification
   *                     example: "2026-06-28T10:30:00.000Z"
   *       401:
   *         description: Authentication required
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
   *       401:
   *         description: Authentication required
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
   *       401:
   *         description: Authentication required
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
          'INSERT INTO criteria (ranking_id, client_id, name, weight, type) VALUES (?, ?, ?, ?, ?)'
        );
        for (const criterion of (data.criteria || [])) {
          const info = insertCriteria.run(rankingId, criterion.id, criterion.name, criterion.weight, criterion.type || 'numeric');
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
            candidate.name, candidate.image ?? null,
            candidate.description ?? null, candidate.notes ?? null
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
              // Convert boolean scores to integers (true -> 1, false -> 0)
              const numericScore = typeof scoreValue === 'boolean' 
                ? (scoreValue ? 1 : 0) 
                : scoreValue;
              insertScore.run(dbCandidateId, dbCriteriaId, numericScore);
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
   *       401:
   *         description: Authentication required
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
}
