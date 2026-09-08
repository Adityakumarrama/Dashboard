import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { logAction, getClientIp } from '../services/auditService.js';
import supabaseAdmin from '../config/supabase.js';
import { validateUuidParams } from '../middleware/validateUuid.js';

const router = Router();

/**
 * GET /api/scoring
 * List all scoring criteria
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { active_only } = req.query;
    let criteria = [];
    try {
      const whereClause = active_only === 'true' ? 'WHERE is_active = true' : '';
      criteria = await queryAll(`SELECT * FROM scoring_criteria ${whereClause} ORDER BY sort_order, created_at`);
    } catch (pgErr) {
      console.warn('Postgres query failed in GET /api/scoring, falling back to Supabase REST:', pgErr.message);
      let queryBuilder = supabaseAdmin.from('scoring_criteria').select('*').order('sort_order', { ascending: true });
      if (active_only === 'true') {
        queryBuilder = queryBuilder.eq('is_active', true);
      }
      const { data, error } = await queryBuilder;
      if (error) throw error;
      criteria = data || [];
    }
    res.json({ criteria });
  } catch (error) {
    console.error('List criteria error:', error);
    res.status(500).json({ error: error.message || 'Failed to list scoring criteria', code: 'INTERNAL_ERROR' });
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

    let criterion = null;
    try {
      criterion = await queryOne(
        `INSERT INTO scoring_criteria (name, description, max_score, weight, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, description || null, max_score, weight !== undefined ? weight : 1.0, sort_order !== undefined ? sort_order : 0]
      );
    } catch (pgErr) {
      console.warn('Postgres query failed in POST /api/scoring, falling back to Supabase REST:', pgErr.message);
      const { data, error: supaErr } = await supabaseAdmin
        .from('scoring_criteria')
        .insert({
          name,
          description: description || null,
          max_score: Number(max_score),
          weight: weight !== undefined ? Number(weight) : 1.0,
          sort_order: sort_order !== undefined ? Number(sort_order) : 0,
        })
        .select()
        .single();
      if (supaErr) throw supaErr;
      criterion = data;
    }

    try {
      await logAction(req.user.id, 'criteria.created', 'scoring_criteria', criterion.id,
        { name: criterion.name }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error in POST /api/scoring:', logErr.message);
    }

    res.status(201).json({ criterion });
  } catch (error) {
    console.error('Create criterion error:', error);
    res.status(500).json({ error: error.message || 'Failed to create criterion', code: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/scoring/:id
 * Update scoring criterion
 */
router.put('/:id', authenticate, requireAdmin, validateUuidParams('id'), async (req, res) => {
  try {
    let existing = null;
    try {
      existing = await queryOne('SELECT * FROM scoring_criteria WHERE id = $1', [req.params.id]);
    } catch (pgErr) {
      console.warn('Postgres query failed in PUT /api/scoring/:id (existing), falling back to Supabase REST:', pgErr.message);
      const { data, error: supaErr } = await supabaseAdmin
        .from('scoring_criteria')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();
      if (supaErr) throw supaErr;
      existing = data;
    }

    if (!existing) {
      return res.status(404).json({ error: 'Criterion not found', code: 'NOT_FOUND' });
    }

    const { name, description, max_score, weight, sort_order, is_active } = req.body;

    let criterion = null;
    try {
      criterion = await queryOne(
        `UPDATE scoring_criteria SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          max_score = COALESCE($3, max_score),
          weight = COALESCE($4, weight),
          sort_order = COALESCE($5, sort_order),
          is_active = COALESCE($6, is_active),
          updated_at = NOW()
         WHERE id = $7 RETURNING *`,
        [
          name !== undefined ? name : null,
          description !== undefined ? description : null,
          max_score !== undefined ? max_score : null,
          weight !== undefined ? weight : null,
          sort_order !== undefined ? sort_order : null,
          is_active !== undefined ? is_active : null,
          req.params.id
        ]
      );
    } catch (pgErr) {
      console.warn('Postgres query failed in PUT /api/scoring/:id (update), falling back to Supabase REST:', pgErr.message);
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (max_score !== undefined) updateData.max_score = Number(max_score);
      if (weight !== undefined) updateData.weight = Number(weight);
      if (sort_order !== undefined) updateData.sort_order = Number(sort_order);
      if (is_active !== undefined) updateData.is_active = is_active;
      updateData.updated_at = new Date().toISOString();

      const { data, error: supaErr } = await supabaseAdmin
        .from('scoring_criteria')
        .update(updateData)
        .eq('id', req.params.id)
        .select()
        .single();
      if (supaErr) throw supaErr;
      criterion = data;
    }

    try {
      await logAction(req.user.id, 'criteria.updated', 'scoring_criteria', criterion.id,
        { before: existing, after: criterion }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error in PUT /api/scoring/:id:', logErr.message);
    }

    res.json({ criterion });
  } catch (error) {
    console.error('Update criterion error:', error);
    res.status(500).json({ error: error.message || 'Failed to update criterion', code: 'INTERNAL_ERROR' });
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

    let pgFailed = false;
    try {
      for (const { id, sort_order } of orders) {
        await query('UPDATE scoring_criteria SET sort_order = $1 WHERE id = $2', [sort_order, id]);
      }
    } catch (pgErr) {
      console.warn('Postgres query failed in PUT /api/scoring/reorder, falling back to Supabase REST:', pgErr.message);
      pgFailed = true;
      for (const { id, sort_order } of orders) {
        const { error: supaErr } = await supabaseAdmin
          .from('scoring_criteria')
          .update({ sort_order: Number(sort_order) })
          .eq('id', id);
        if (supaErr) throw supaErr;
      }
    }

    let criteria = [];
    if (!pgFailed) {
      try {
        criteria = await queryAll('SELECT * FROM scoring_criteria ORDER BY sort_order');
      } catch {
        pgFailed = true;
      }
    }
    if (pgFailed) {
      const { data, error: supaErr } = await supabaseAdmin
        .from('scoring_criteria')
        .select('*')
        .order('sort_order', { ascending: true });
      if (supaErr) throw supaErr;
      criteria = data || [];
    }

    res.json({ criteria });
  } catch (error) {
    console.error('Reorder criteria error:', error);
    res.status(500).json({ error: error.message || 'Failed to reorder criteria', code: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/scoring/:id
 */
router.delete('/:id', authenticate, requireAdmin, validateUuidParams('id'), async (req, res) => {
  try {
    let criterion = null;
    try {
      criterion = await queryOne('SELECT * FROM scoring_criteria WHERE id = $1', [req.params.id]);
    } catch (pgErr) {
      console.warn('Postgres query failed in DELETE /api/scoring/:id (select), falling back to Supabase REST:', pgErr.message);
      const { data, error: supaErr } = await supabaseAdmin
        .from('scoring_criteria')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();
      if (supaErr) throw supaErr;
      criterion = data;
    }

    if (!criterion) {
      return res.status(404).json({ error: 'Criterion not found', code: 'NOT_FOUND' });
    }

    // Check if any evaluations use this criterion
    let hasEvaluations = false;
    try {
      const usageCount = await queryOne(
        'SELECT COUNT(*) as count FROM evaluation_scores WHERE criteria_id = $1',
        [req.params.id]
      );
      hasEvaluations = parseInt(usageCount?.count || 0) > 0;
    } catch (pgErr) {
      console.warn('Postgres query failed in DELETE /api/scoring/:id (usage check), falling back to Supabase REST:', pgErr.message);
      const { count, error: countErr } = await supabaseAdmin
        .from('evaluation_scores')
        .select('id', { count: 'exact', head: true })
        .eq('criteria_id', req.params.id);
      if (countErr) throw countErr;
      hasEvaluations = (count || 0) > 0;
    }

    if (hasEvaluations) {
      // Soft delete — deactivate instead
      try {
        await query('UPDATE scoring_criteria SET is_active = false WHERE id = $1', [req.params.id]);
      } catch (pgErr) {
        const { error: supaErr } = await supabaseAdmin
          .from('scoring_criteria')
          .update({ is_active: false })
          .eq('id', req.params.id);
        if (supaErr) throw supaErr;
      }
      try {
        await logAction(req.user.id, 'criteria.deactivated', 'scoring_criteria', req.params.id,
          { name: criterion.name, reason: 'has_evaluations' }, getClientIp(req));
      } catch (logErr) {
        console.warn('Audit log error in DELETE /api/scoring/:id:', logErr.message);
      }
      return res.json({ message: 'Criterion deactivated (has existing evaluations)', deactivated: true });
    }

    try {
      await query('DELETE FROM scoring_criteria WHERE id = $1', [req.params.id]);
    } catch (pgErr) {
      const { error: supaErr } = await supabaseAdmin
        .from('scoring_criteria')
        .delete()
        .eq('id', req.params.id);
      if (supaErr) throw supaErr;
    }

    try {
      await logAction(req.user.id, 'criteria.deleted', 'scoring_criteria', req.params.id,
        { name: criterion.name }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error in DELETE /api/scoring/:id:', logErr.message);
    }

    res.json({ message: 'Criterion deleted successfully' });
  } catch (error) {
    console.error('Delete criterion error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete criterion', code: 'INTERNAL_ERROR' });
  }
});

export default router;
