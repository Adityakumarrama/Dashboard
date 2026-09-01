import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireAny } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { buildPaginationQuery, paginationMeta } from '../utils/helpers.js';
import { logAction, getClientIp } from '../services/auditService.js';

const router = Router();

/**
 * GET /api/evaluations
 * Admin: all evaluations. Jury: own evaluations only.
 */
router.get('/', authenticate, requireAny, async (req, res) => {
  try {
    const { page, limit, status, team_id, user_id } = req.query;
    const { limit: safeLimit, offset, page: safePage } = buildPaginationQuery(page, limit);

    let where = [];
    let params = [];
    let paramIdx = 1;

    // Jury can only see own evaluations
    if (req.user.role === 'JURY') {
      where.push(`e.user_id = $${paramIdx}`);
      params.push(req.user.id);
      paramIdx++;
    } else if (user_id) {
      where.push(`e.user_id = $${paramIdx}`);
      params.push(user_id);
      paramIdx++;
    }

    if (status) {
      where.push(`e.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (team_id) {
      where.push(`e.team_id = $${paramIdx}`);
      params.push(team_id);
      paramIdx++;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await queryOne(
      `SELECT COUNT(*) as count FROM evaluations e ${whereClause}`, params
    );
    const total = parseInt(countResult.count);

    const evaluations = await queryAll(
      `SELECT e.*, t.team_code, t.team_name, t.organization, t.category,
        u.full_name as judge_name, u.judge_id
       FROM evaluations e
       JOIN teams t ON e.team_id = t.id
       JOIN users u ON e.user_id = u.id
       ${whereClause}
       ORDER BY e.updated_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, safeLimit, offset]
    );

    res.json({
      evaluations,
      pagination: paginationMeta(total, safePage, safeLimit),
    });
  } catch (error) {
    console.error('List evaluations error:', error);
    res.status(500).json({ error: 'Failed to list evaluations', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/evaluations/team/:teamId
 * Get all evaluations for a specific team (admin only)
 */
router.get('/team/:teamId', authenticate, requireAdmin, async (req, res) => {
  try {
    const team = await queryOne('SELECT * FROM teams WHERE id = $1', [req.params.teamId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    const evaluations = await queryAll(
      `SELECT e.*, u.full_name as judge_name, u.judge_id
       FROM evaluations e
       JOIN users u ON e.user_id = u.id
       WHERE e.team_id = $1
       ORDER BY e.submitted_at DESC NULLS LAST`,
      [req.params.teamId]
    );

    // Get scores for each evaluation
    for (const eval_ of evaluations) {
      eval_.scores = await queryAll(
        `SELECT es.*, sc.name as criteria_name, sc.max_score, sc.weight, sc.sort_order
         FROM evaluation_scores es
         JOIN scoring_criteria sc ON es.criteria_id = sc.id
         WHERE es.evaluation_id = $1
         ORDER BY sc.sort_order`,
        [eval_.id]
      );
    }

    // Calculate statistics
    const submittedEvals = evaluations.filter(e => e.status === 'submitted');
    const scores = submittedEvals.map(e => parseFloat(e.total_score)).filter(s => !isNaN(s));
    const stats = {
      totalJudges: evaluations.length,
      completedJudges: submittedEvals.length,
      averageScore: scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : null,
      highestScore: scores.length > 0 ? Math.max(...scores) : null,
      lowestScore: scores.length > 0 ? Math.min(...scores) : null,
      medianScore: scores.length > 0 ? getMedian(scores) : null,
    };

    res.json({ team, evaluations, stats });
  } catch (error) {
    console.error('Get team evaluations error:', error);
    res.status(500).json({ error: 'Failed to get evaluations', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/evaluations/:id
 */
router.get('/:id', authenticate, requireAny, async (req, res) => {
  try {
    const evaluation = await queryOne(
      `SELECT e.*, t.team_code, t.team_name, t.problem_statement_id, t.problem_statement_title,
        t.organization, t.category, t.track, t.team_leader, t.team_members,
        u.full_name as judge_name, u.judge_id
       FROM evaluations e
       JOIN teams t ON e.team_id = t.id
       JOIN users u ON e.user_id = u.id
       WHERE e.id = $1`,
      [req.params.id]
    );

    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found', code: 'NOT_FOUND' });
    }

    // Jury can only see own evaluations
    if (req.user.role === 'JURY' && evaluation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
    }

    const scores = await queryAll(
      `SELECT es.*, sc.name as criteria_name, sc.description as criteria_description,
        sc.max_score, sc.weight, sc.sort_order
       FROM evaluation_scores es
       JOIN scoring_criteria sc ON es.criteria_id = sc.id
       WHERE es.evaluation_id = $1
       ORDER BY sc.sort_order`,
      [req.params.id]
    );

    evaluation.scores = scores;
    res.json({ evaluation });
  } catch (error) {
    console.error('Get evaluation error:', error);
    res.status(500).json({ error: 'Failed to get evaluation', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/evaluations
 * Create or get existing draft evaluation for team+jury pair
 */
router.post('/', authenticate, requireAny, async (req, res) => {
  try {
    const { team_id } = req.body;
    const userId = req.user.id;

    if (!team_id) {
      return res.status(400).json({ error: 'team_id is required', code: 'VALIDATION_ERROR' });
    }

    // Verify team exists
    const team = await queryOne('SELECT * FROM teams WHERE id = $1', [team_id]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    // Jury: verify assignment
    if (req.user.role === 'JURY') {
      const assignment = await queryOne(
        'SELECT id FROM jury_assignments WHERE user_id = $1 AND team_id = $2',
        [userId, team_id]
      );
      if (!assignment) {
        return res.status(403).json({ error: 'This team is not assigned to you', code: 'NOT_ASSIGNED' });
      }
    }

    // Check for existing evaluation
    let evaluation = await queryOne(
      'SELECT * FROM evaluations WHERE team_id = $1 AND user_id = $2',
      [team_id, userId]
    );

    if (evaluation) {
      // Return existing with scores
      const scores = await queryAll(
        `SELECT es.*, sc.name as criteria_name, sc.description as criteria_description,
          sc.max_score, sc.weight, sc.sort_order
         FROM evaluation_scores es
         JOIN scoring_criteria sc ON es.criteria_id = sc.id
         WHERE es.evaluation_id = $1
         ORDER BY sc.sort_order`,
        [evaluation.id]
      );
      evaluation.scores = scores;
      return res.json({ evaluation, isExisting: true });
    }

    // Create new draft
    evaluation = await queryOne(
      'INSERT INTO evaluations (team_id, user_id, status) VALUES ($1, $2, \'draft\') RETURNING *',
      [team_id, userId]
    );

    // Initialize with all active criteria
    const criteria = await queryAll('SELECT id FROM scoring_criteria WHERE is_active = true ORDER BY sort_order');
    for (const c of criteria) {
      await query(
        'INSERT INTO evaluation_scores (evaluation_id, criteria_id) VALUES ($1, $2)',
        [evaluation.id, c.id]
      );
    }

    // Fetch with full score data
    const scores = await queryAll(
      `SELECT es.*, sc.name as criteria_name, sc.description as criteria_description,
        sc.max_score, sc.weight, sc.sort_order
       FROM evaluation_scores es
       JOIN scoring_criteria sc ON es.criteria_id = sc.id
       WHERE es.evaluation_id = $1
       ORDER BY sc.sort_order`,
      [evaluation.id]
    );
    evaluation.scores = scores;

    await logAction(userId, 'evaluation.created', 'evaluation', evaluation.id,
      { team_code: team.team_code }, getClientIp(req));

    res.status(201).json({ evaluation, isExisting: false });
  } catch (error) {
    console.error('Create evaluation error:', error);
    res.status(500).json({ error: 'Failed to create evaluation', code: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/evaluations/:id
 * Update draft scores (save draft / autosave)
 */
router.put('/:id', authenticate, requireAny, async (req, res) => {
  try {
    const evaluation = await queryOne('SELECT * FROM evaluations WHERE id = $1', [req.params.id]);

    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found', code: 'NOT_FOUND' });
    }

    // Only the evaluator can edit
    if (req.user.role === 'JURY' && evaluation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
    }

    // Cannot edit submitted evaluations
    if (evaluation.status === 'submitted') {
      return res.status(400).json({ error: 'Cannot edit submitted evaluation', code: 'EVALUATION_LOCKED' });
    }

    const { scores, comments } = req.body;

    // Update individual scores
    if (Array.isArray(scores)) {
      for (const { criteria_id, score, comment } of scores) {
        // Validate score against max
        if (score !== null && score !== undefined) {
          const criterion = await queryOne('SELECT max_score FROM scoring_criteria WHERE id = $1', [criteria_id]);
          if (criterion && (score < 0 || score > criterion.max_score)) {
            return res.status(400).json({
              error: `Score must be between 0 and ${criterion.max_score}`,
              code: 'INVALID_SCORE',
              field: criteria_id,
            });
          }
        }

        await query(
          `INSERT INTO evaluation_scores (evaluation_id, criteria_id, score, comment)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (evaluation_id, criteria_id)
           DO UPDATE SET score = $3, comment = $4`,
          [req.params.id, criteria_id, score, comment || null]
        );
      }
    }

    // Calculate totals
    const scoreRows = await queryAll(
      `SELECT es.score, sc.weight, sc.max_score
       FROM evaluation_scores es
       JOIN scoring_criteria sc ON es.criteria_id = sc.id
       WHERE es.evaluation_id = $1 AND sc.is_active = true`,
      [req.params.id]
    );

    const validScores = scoreRows.filter(s => s.score !== null);
    const totalScore = validScores.reduce((sum, s) => sum + parseFloat(s.score), 0);
    const totalMaxScore = scoreRows.reduce((sum, s) => sum + s.max_score, 0);
    const totalWeight = scoreRows.reduce((sum, s) => sum + parseFloat(s.weight), 0);
    const weightedScore = totalWeight > 0
      ? validScores.reduce((sum, s) => sum + (parseFloat(s.score) * parseFloat(s.weight)), 0) / totalWeight
      : 0;
    const normalizedScore = totalMaxScore > 0 ? (totalScore / totalMaxScore) * 100 : 0;

    await query(
      `UPDATE evaluations SET
        total_score = $1, weighted_score = $2, normalized_score = $3,
        comments = COALESCE($4, comments), status = CASE WHEN status = 'submitted' THEN status ELSE 'draft' END
       WHERE id = $5`,
      [totalScore, weightedScore.toFixed(2), normalizedScore.toFixed(4), comments, req.params.id]
    );

    const updated = await queryOne('SELECT * FROM evaluations WHERE id = $1', [req.params.id]);
    const updatedScores = await queryAll(
      `SELECT es.*, sc.name as criteria_name, sc.max_score, sc.weight, sc.sort_order
       FROM evaluation_scores es
       JOIN scoring_criteria sc ON es.criteria_id = sc.id
       WHERE es.evaluation_id = $1
       ORDER BY sc.sort_order`,
      [req.params.id]
    );
    updated.scores = updatedScores;

    res.json({ evaluation: updated });
  } catch (error) {
    console.error('Update evaluation error:', error);
    res.status(500).json({ error: 'Failed to update evaluation', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/evaluations/:id/submit
 * Submit final evaluation and lock
 */
router.post('/:id/submit', authenticate, requireAny, async (req, res) => {
  try {
    const evaluation = await queryOne('SELECT * FROM evaluations WHERE id = $1', [req.params.id]);

    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found', code: 'NOT_FOUND' });
    }

    if (req.user.role === 'JURY' && evaluation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
    }

    if (evaluation.status === 'submitted') {
      return res.status(400).json({ error: 'Evaluation already submitted', code: 'ALREADY_SUBMITTED' });
    }

    // Validate all criteria have scores
    const missingScores = await queryAll(
      `SELECT sc.name
       FROM evaluation_scores es
       JOIN scoring_criteria sc ON es.criteria_id = sc.id
       WHERE es.evaluation_id = $1 AND sc.is_active = true AND es.score IS NULL`,
      [req.params.id]
    );

    if (missingScores.length > 0) {
      return res.status(400).json({
        error: 'All criteria must be scored before submission',
        code: 'INCOMPLETE_SCORES',
        missing: missingScores.map(s => s.name),
      });
    }

    // Submit and lock
    const submitted = await queryOne(
      `UPDATE evaluations SET status = 'submitted', submitted_at = NOW(), locked_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    const team = await queryOne('SELECT team_code FROM teams WHERE id = $1', [evaluation.team_id]);

    await logAction(req.user.id, 'evaluation.submitted', 'evaluation', submitted.id,
      { team_code: team?.team_code, total_score: submitted.total_score }, getClientIp(req));

    // Fetch with scores
    const scores = await queryAll(
      `SELECT es.*, sc.name as criteria_name, sc.max_score, sc.weight, sc.sort_order
       FROM evaluation_scores es
       JOIN scoring_criteria sc ON es.criteria_id = sc.id
       WHERE es.evaluation_id = $1
       ORDER BY sc.sort_order`,
      [req.params.id]
    );
    submitted.scores = scores;

    res.json({ evaluation: submitted, message: 'Evaluation submitted successfully' });
  } catch (error) {
    console.error('Submit evaluation error:', error);
    res.status(500).json({ error: 'Failed to submit evaluation', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/evaluations/:id/reopen
 * Admin reopens a submitted evaluation
 */
router.post('/:id/reopen', authenticate, requireAdmin, async (req, res) => {
  try {
    const evaluation = await queryOne('SELECT * FROM evaluations WHERE id = $1', [req.params.id]);

    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found', code: 'NOT_FOUND' });
    }

    if (evaluation.status !== 'submitted') {
      return res.status(400).json({ error: 'Only submitted evaluations can be reopened', code: 'INVALID_STATUS' });
    }

    const { reason } = req.body;

    const reopened = await queryOne(
      `UPDATE evaluations SET status = 'reopened', locked_at = NULL
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    const team = await queryOne('SELECT team_code FROM teams WHERE id = $1', [evaluation.team_id]);
    const judge = await queryOne('SELECT full_name FROM users WHERE id = $1', [evaluation.user_id]);

    await logAction(req.user.id, 'evaluation.reopened', 'evaluation', reopened.id,
      {
        team_code: team?.team_code, judge: judge?.full_name,
        previous_score: evaluation.total_score, reason: reason || 'No reason provided'
      },
      getClientIp(req));

    res.json({ evaluation: reopened, message: 'Evaluation reopened' });
  } catch (error) {
    console.error('Reopen evaluation error:', error);
    res.status(500).json({ error: 'Failed to reopen evaluation', code: 'INTERNAL_ERROR' });
  }
});

function getMedian(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2);
}

export default router;
