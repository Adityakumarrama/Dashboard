import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { queryAll, queryOne } from '../config/database.js';
import { buildPaginationQuery, paginationMeta } from '../utils/helpers.js';

const router = Router();

/**
 * GET /api/audit
 * List audit logs with pagination and filtering
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page, limit, action, user_id, entity_type, from_date, to_date } = req.query;
    const { limit: safeLimit, offset, page: safePage } = buildPaginationQuery(page, limit);

    let where = [];
    let params = [];
    let paramIdx = 1;

    if (action) {
      where.push(`al.action = $${paramIdx}`);
      params.push(action);
      paramIdx++;
    }
    if (user_id) {
      where.push(`al.user_id = $${paramIdx}`);
      params.push(user_id);
      paramIdx++;
    }
    if (entity_type) {
      where.push(`al.entity_type = $${paramIdx}`);
      params.push(entity_type);
      paramIdx++;
    }
    if (from_date) {
      where.push(`al.created_at >= $${paramIdx}`);
      params.push(from_date);
      paramIdx++;
    }
    if (to_date) {
      where.push(`al.created_at <= $${paramIdx}`);
      params.push(to_date);
      paramIdx++;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await queryOne(`SELECT COUNT(*) as count FROM audit_logs al ${whereClause}`, params);
    const total = parseInt(countResult.count);

    const logs = await queryAll(
      `SELECT al.*, u.full_name as user_name, u.username, u.role as user_role
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, safeLimit, offset]
    );

    // Get available action types for filter
    const actions = await queryAll('SELECT DISTINCT action FROM audit_logs ORDER BY action');

    res.json({
      logs,
      actions: actions.map(a => a.action),
      pagination: paginationMeta(total, safePage, safeLimit),
    });
  } catch (error) {
    console.error('List audit logs error:', error);
    res.status(500).json({ error: 'Failed to list audit logs', code: 'INTERNAL_ERROR' });
  }
});

export default router;
