import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { logAction, getClientIp } from '../services/auditService.js';

const router = Router();

/**
 * GET /api/settings
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await queryAll('SELECT * FROM competition_settings');
    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    res.json({ settings });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings', code: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/settings
 */
router.put('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object required', code: 'VALIDATION_ERROR' });
    }

    for (const [key, value] of Object.entries(settings)) {
      await query(
        `INSERT INTO competition_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    }

    await logAction(req.user.id, 'settings.updated', 'settings', null,
      { keys: Object.keys(settings) }, getClientIp(req));

    // Return updated settings
    const rows = await queryAll('SELECT * FROM competition_settings');
    const result = {};
    for (const row of rows) {
      try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
    }

    res.json({ settings: result });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings', code: 'INTERNAL_ERROR' });
  }
});

export default router;
