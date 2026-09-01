import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { logAction, getClientIp } from '../services/auditService.js';

const router = Router();

/**
 * GET /api/scoring
 * List all scoring criteria
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { active_only } = req.query;
    const whereClause = active_only === 'true' ? 'WHERE is_active = true' : '';
    const criteria = await queryAll(`SELECT * FROM scoring_criteria ${whereClause} ORDER BY sort_order, created_at`);
    res.json({ criteria });
  } catch (error) {
    console.error('List criteria error:', error);
    res.status(500).json({ error: 'Failed to list scoring criteria', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/scoring
 * Create scoring criterion
 */
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, description, max_score, weight, sort_order } = req.body;

    if (!name || !max_score) {
      return res.status(400).json({ error: 'Name and max_score are required', code: 'VALIDATION_ERROR' });
    }

    const criterion = await queryOne(
      `INSERT INTO scoring_criteria (name, description, max_score, weight, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description || null, max_score, weight || 1.0, sort_order || 0]
    );

    await logAction(req.user.id, 'criteria.created', 'scoring_criteria', criterion.id,
      { name: criterion.name }, getClientIp(req));

    res.status(201).json({ criterion });
  } catch (error) {
    console.error('Create criterion error:', error);
    res.status(500).json({ error: 'Failed to create criterion', code: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/scoring/:id
 * Update scoring criterion
 */
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const existing = await queryOne('SELECT * FROM scoring_criteria WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Criterion not found', code: 'NOT_FOUND' });
    }

    const { name, description, max_score, weight, sort_order, is_active } = req.body;

    const criterion = await queryOne(
      `UPDATE scoring_criteria SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        max_score = COALESCE($3, max_score),
        weight = COALESCE($4, weight),
        sort_order = COALESCE($5, sort_order),
        is_active = COALESCE($6, is_active)
       WHERE id = $7 RETURNING *`,
      [name, description, max_score, weight, sort_order, is_active, req.params.id]
    );

    await logAction(req.user.id, 'criteria.updated', 'scoring_criteria', criterion.id,
      { before: existing, after: criterion }, getClientIp(req));

    res.json({ criterion });
  } catch (error) {
    console.error('Update criterion error:', error);
    res.status(500).json({ error: 'Failed to update criterion', code: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/scoring/reorder
 * Batch update sort orders
 */
router.put('/reorder', authenticate, requireAdmin, async (req, res) => {
  try {
    const { orders } = req.body; // [{ id, sort_order }]

    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'orders array required', code: 'VALIDATION_ERROR' });
    }

    for (const { id, sort_order } of orders) {
      await query('UPDATE scoring_criteria SET sort_order = $1 WHERE id = $2', [sort_order, id]);
    }

    const criteria = await queryAll('SELECT * FROM scoring_criteria ORDER BY sort_order');
    res.json({ criteria });
  } catch (error) {
    console.error('Reorder criteria error:', error);
    res.status(500).json({ error: 'Failed to reorder criteria', code: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/scoring/:id
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const criterion = await queryOne('SELECT * FROM scoring_criteria WHERE id = $1', [req.params.id]);
    if (!criterion) {
      return res.status(404).json({ error: 'Criterion not found', code: 'NOT_FOUND' });
    }

    // Check if any evaluations use this criterion
    const usageCount = await queryOne(
      'SELECT COUNT(*) as count FROM evaluation_scores WHERE criteria_id = $1',
      [req.params.id]
    );

    if (parseInt(usageCount.count) > 0) {
      // Soft delete — deactivate instead
      await query('UPDATE scoring_criteria SET is_active = false WHERE id = $1', [req.params.id]);
      await logAction(req.user.id, 'criteria.deactivated', 'scoring_criteria', req.params.id,
        { name: criterion.name, reason: 'has_evaluations' }, getClientIp(req));
      return res.json({ message: 'Criterion deactivated (has existing evaluations)', deactivated: true });
    }

    await query('DELETE FROM scoring_criteria WHERE id = $1', [req.params.id]);

    await logAction(req.user.id, 'criteria.deleted', 'scoring_criteria', req.params.id,
      { name: criterion.name }, getClientIp(req));

    res.json({ message: 'Criterion deleted successfully' });
  } catch (error) {
    console.error('Delete criterion error:', error);
    res.status(500).json({ error: 'Failed to delete criterion', code: 'INTERNAL_ERROR' });
  }
});

export default router;
