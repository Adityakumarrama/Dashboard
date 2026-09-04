import { query, queryOne, queryAll, transaction } from '../config/database.js';
import { logAction } from './auditService.js';

/**
 * Scoring Service — Database-First Authoritative Score Calculation Engine
 * PostgreSQL is the SINGLE SOURCE OF TRUTH for all scores, totals, weights,
 * normalizations, team aggregates, and leaderboard rankings.
 */

/**
 * Save / autosave draft scores for an evaluation within a transaction
 * Enforces range limits and allows PostgreSQL to authoritatively calculate totals.
 */
export async function saveEvaluationScores(evaluationId, scores, comments, user) {
  return await transaction(async (client) => {
    // 1. Fetch evaluation
    const evalRes = await client.query('SELECT * FROM evaluations WHERE id = $1', [evaluationId]);
    const evaluation = evalRes.rows[0];

    if (!evaluation) {
      const err = new Error('Evaluation not found');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // Authorization check
    if (user.role === 'JURY' && evaluation.user_id !== user.id) {
      const err = new Error('Access denied');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    // Locked check
    if (evaluation.status === 'submitted') {
      const err = new Error('Cannot edit submitted evaluation. Contact an administrator to reopen.');
      err.code = 'EVALUATION_LOCKED';
      err.status = 400;
      throw err;
    }

    // 2. Fetch all active criteria for validation
    const critRes = await client.query('SELECT * FROM scoring_criteria WHERE is_active = true');
    const criteriaMap = new Map(critRes.rows.map(c => [c.id, c]));

    // 3. Validate and insert/update individual criterion scores
    if (Array.isArray(scores)) {
      for (const item of scores) {
        const criteriaId = item.criteria_id || item.criterion_id;
        const rawScore = item.score;
        const comment = item.comment || null;

        if (!criteriaId) continue;

        const criterion = criteriaMap.get(criteriaId);
        if (!criterion) continue;

        // Strict numeric validation against active criteria limit
        if (rawScore !== null && rawScore !== undefined && rawScore !== '') {
          const numScore = Number(rawScore);
          if (isNaN(numScore) || numScore < 0 || numScore > criterion.max_score) {
            const err = new Error(`Score for ${criterion.name} must be between 0 and ${criterion.max_score}`);
            err.code = 'INVALID_SCORE';
            err.status = 400;
            err.field = criteriaId;
            throw err;
          }

          await client.query(
            `INSERT INTO evaluation_scores (
               evaluation_id, criteria_id, criterion_id, team_id, judge_id, score, comment
             )
             VALUES ($1, $2, $2, $3, $4, $5, $6)
             ON CONFLICT (evaluation_id, criteria_id)
             DO UPDATE SET
               criterion_id = EXCLUDED.criterion_id,
               team_id = EXCLUDED.team_id,
               judge_id = EXCLUDED.judge_id,
               score = EXCLUDED.score,
               comment = EXCLUDED.comment,
               updated_at = NOW()`,
            [evaluationId, criteriaId, evaluation.team_id, evaluation.user_id, numScore, comment]
          );
        } else {
          // If score is null/empty string (cleared by jury)
          await client.query(
            `INSERT INTO evaluation_scores (
               evaluation_id, criteria_id, criterion_id, team_id, judge_id, score, comment
             )
             VALUES ($1, $2, $2, $3, $4, NULL, $5)
             ON CONFLICT (evaluation_id, criteria_id)
             DO UPDATE SET
               score = NULL,
               comment = EXCLUDED.comment,
               updated_at = NOW()`,
            [evaluationId, criteriaId, evaluation.team_id, evaluation.user_id, comment]
          );
        }
      }
    }

    // 4. Update overall comments if provided
    if (comments !== undefined) {
      await client.query(
        'UPDATE evaluations SET comments = $1, updated_at = NOW() WHERE id = $2',
        [comments, evaluationId]
      );
    }

    // 5. Invoke authoritative PostgreSQL calculation function
    await client.query('SELECT * FROM fn_calculate_evaluation_total($1)', [evaluationId]);

    // 6. Fetch authoritative updated evaluation and criterion scores
    const updatedEvalRes = await client.query(
      `SELECT e.*, t.team_code, t.team_name, u.full_name as judge_name, u.judge_id
       FROM evaluations e
       JOIN teams t ON e.team_id = t.id
       JOIN users u ON e.user_id = u.id
       WHERE e.id = $1`,
      [evaluationId]
    );
    const updatedEvaluation = updatedEvalRes.rows[0];

    const scoresRes = await client.query(
      `SELECT es.*, sc.name as criteria_name, sc.description as criteria_description,
              sc.max_score, sc.weight, sc.sort_order
       FROM evaluation_scores es
       JOIN scoring_criteria sc ON (COALESCE(es.criteria_id, es.criterion_id) = sc.id)
       WHERE es.evaluation_id = $1
       ORDER BY sc.sort_order`,
      [evaluationId]
    );
    updatedEvaluation.scores = scoresRes.rows;

    return updatedEvaluation;
  });
}

/**
 * Submit final evaluation and lock
 * Transactionally ensures all criteria are scored, calculates final authoritative totals,
 * archives snapshot in evaluation_score_history, and records audit trail.
 */
export async function submitEvaluation(evaluationId, user, reqIp) {
  return await transaction(async (client) => {
    const evalRes = await client.query('SELECT * FROM evaluations WHERE id = $1', [evaluationId]);
    const evaluation = evalRes.rows[0];

    if (!evaluation) {
      const err = new Error('Evaluation not found');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    }

    if (user.role === 'JURY' && evaluation.user_id !== user.id) {
      const err = new Error('Access denied');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    if (evaluation.status === 'submitted') {
      const err = new Error('Evaluation is already submitted and locked');
      err.code = 'ALREADY_SUBMITTED';
      err.status = 400;
      throw err;
    }

    // 1. Verify all active criteria have been scored
    const missingRes = await client.query(
      `SELECT sc.name, sc.id
       FROM scoring_criteria sc
       LEFT JOIN evaluation_scores es ON (COALESCE(es.criteria_id, es.criterion_id) = sc.id AND es.evaluation_id = $1)
       WHERE sc.is_active = true AND (es.score IS NULL OR es.id IS NULL)`,
      [evaluationId]
    );

    if (missingRes.rows.length > 0) {
      const missingNames = missingRes.rows.map(r => r.name);
      const err = new Error(`All criteria must be scored before final submission. Missing: ${missingNames.join(', ')}`);
      err.code = 'INCOMPLETE_SCORES';
      err.status = 400;
      err.missing = missingNames;
      throw err;
    }

    // 2. Authoritative calculation in PostgreSQL
    await client.query('SELECT * FROM fn_calculate_evaluation_total($1)', [evaluationId]);

    // 3. Mark as submitted and locked
    const submitRes = await client.query(
      `UPDATE evaluations
       SET status = 'submitted', submitted_at = NOW(), locked_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [evaluationId]
    );
    const submittedEval = submitRes.rows[0];

    // 4. Fetch full criterion score snapshot
    const scoresRes = await client.query(
      `SELECT es.*, sc.name as criteria_name, sc.max_score, sc.weight
       FROM evaluation_scores es
       JOIN scoring_criteria sc ON (COALESCE(es.criteria_id, es.criterion_id) = sc.id)
       WHERE es.evaluation_id = $1
       ORDER BY sc.sort_order`,
      [evaluationId]
    );
    const scoresSnapshot = scoresRes.rows;

    // 5. Store snapshot in evaluation_score_history (historical preservation)
    await client.query(
      `INSERT INTO evaluation_score_history (
         evaluation_id, team_id, judge_id, status, total_score, weighted_score,
         normalized_score, scores_snapshot, action, changed_by, reason
       )
       VALUES ($1, $2, $3, 'submitted', $4, $5, $6, $7, 'submitted', $8, 'Final submission by judge')`,
      [
        evaluationId,
        evaluation.team_id,
        evaluation.user_id,
        submittedEval.total_score,
        submittedEval.weighted_score,
        submittedEval.normalized_score,
        JSON.stringify(scoresSnapshot),
        user.id,
      ]
    );

    // 6. Log audit action
    const teamRes = await client.query('SELECT team_code FROM teams WHERE id = $1', [evaluation.team_id]);
    const teamCode = teamRes.rows[0]?.team_code;

    await logAction(
      user.id,
      'evaluation.submitted',
      'evaluation',
      evaluationId,
      { team_code: teamCode, authoritative_total: submittedEval.total_score },
      reqIp
    );

    // 7. Read authoritative team aggregate from v_team_score_aggregates
    const teamAggRes = await client.query(
      'SELECT * FROM v_team_score_aggregates WHERE team_id = $1',
      [evaluation.team_id]
    );

    submittedEval.scores = scoresSnapshot;
    return {
      evaluation: submittedEval,
      teamStats: teamAggRes.rows[0] || null,
    };
  });
}

/**
 * Reopen a submitted evaluation (Admin Only)
 * Preserves audit history snapshot and recalculates aggregates.
 */
export async function reopenEvaluation(evaluationId, adminUser, reason, reqIp) {
  return await transaction(async (client) => {
    const evalRes = await client.query('SELECT * FROM evaluations WHERE id = $1', [evaluationId]);
    const evaluation = evalRes.rows[0];

    if (!evaluation) {
      const err = new Error('Evaluation not found');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    }

    if (evaluation.status !== 'submitted') {
      const err = new Error('Only submitted evaluations can be reopened');
      err.code = 'INVALID_STATUS';
      err.status = 400;
      throw err;
    }

    // 1. Snapshot current submitted scores before reopening
    const scoresRes = await client.query(
      `SELECT es.*, sc.name as criteria_name, sc.max_score, sc.weight
       FROM evaluation_scores es
       JOIN scoring_criteria sc ON (COALESCE(es.criteria_id, es.criterion_id) = sc.id)
       WHERE es.evaluation_id = $1
       ORDER BY sc.sort_order`,
      [evaluationId]
    );

    await client.query(
      `INSERT INTO evaluation_score_history (
         evaluation_id, team_id, judge_id, status, total_score, weighted_score,
         normalized_score, scores_snapshot, action, changed_by, reason
       )
       VALUES ($1, $2, $3, 'reopened', $4, $5, $6, $7, 'reopened', $8, $9)`,
      [
        evaluationId,
        evaluation.team_id,
        evaluation.user_id,
        evaluation.total_score,
        evaluation.weighted_score,
        evaluation.normalized_score,
        JSON.stringify(scoresRes.rows),
        adminUser.id,
        reason || 'Reopened by administrator',
      ]
    );

    // 2. Update status to 'reopened' and unlock
    const reopenedRes = await client.query(
      `UPDATE evaluations
       SET status = 'reopened', locked_at = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [evaluationId]
    );
    const reopenedEval = reopenedRes.rows[0];

    // 3. Log audit action
    const teamRes = await client.query('SELECT team_code FROM teams WHERE id = $1', [evaluation.team_id]);
    const judgeRes = await client.query('SELECT full_name FROM users WHERE id = $1', [evaluation.user_id]);

    await logAction(
      adminUser.id,
      'evaluation.reopened',
      'evaluation',
      evaluationId,
      {
        team_code: teamRes.rows[0]?.team_code,
        judge: judgeRes.rows[0]?.full_name,
        previous_score: evaluation.total_score,
        reason: reason || 'Reopened by administrator',
      },
      reqIp
    );

    // 4. Fetch updated team aggregates from PostgreSQL view
    const teamAggRes = await client.query(
      'SELECT * FROM v_team_score_aggregates WHERE team_id = $1',
      [evaluation.team_id]
    );

    reopenedEval.scores = scoresRes.rows;
    return {
      evaluation: reopenedEval,
      teamStats: teamAggRes.rows[0] || null,
    };
  });
}

/**
 * Fetch authoritative team score statistics directly from PostgreSQL view
 */
export async function getTeamScores(teamId) {
  const row = await queryOne(
    'SELECT * FROM v_team_score_aggregates WHERE team_id = $1',
    [teamId]
  );
  return row;
}

/**
 * Fetch authoritative leaderboard from PostgreSQL view
 */
export async function getLeaderboard({ category, track, search, limit = 50, offset = 0 } = {}) {
  let where = [];
  let params = [];
  let paramIdx = 1;

  if (category) {
    where.push(`category = $${paramIdx}`);
    params.push(category);
    paramIdx++;
  }

  if (track) {
    where.push(`track = $${paramIdx}`);
    params.push(track);
    paramIdx++;
  }

  if (search) {
    where.push(`(team_code ILIKE $${paramIdx} OR team_name ILIKE $${paramIdx} OR organization ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await queryOne(
    `SELECT COUNT(*) as count FROM v_leaderboard ${whereClause}`,
    params
  );
  const total = parseInt(countRes?.count || 0);

  const rows = await queryAll(
    `SELECT * FROM v_leaderboard ${whereClause}
     ORDER BY overall_rank ASC, team_code ASC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, limit, offset]
  );

  return {
    rows,
    total,
  };
}
