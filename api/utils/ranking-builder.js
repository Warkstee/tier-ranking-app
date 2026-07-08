/**
 * Ranking data reconstruction utilities
 */
import { getDb } from "../db.js";

/**
 * Reconstruct full ranking data from normalized tables.
 * Queries all child tables and assembles the JSON structure
 * expected by the client.
 */
export function reconstructRankingData(db, rankingId) {
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
    'SELECT client_id, name, weight, type FROM criteria WHERE ranking_id = ?'
  ).all(rankingId).map(c => ({
    id: c.client_id,
    name: c.name,
    weight: c.weight,
    type: c.type || 'numeric'
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
      image: cand.image ?? null,
      description: cand.description ?? null,
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
