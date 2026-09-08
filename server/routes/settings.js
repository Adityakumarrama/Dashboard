import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { logAction, getClientIp } from '../services/auditService.js';
import supabaseAdmin from '../config/supabase.js';
import { isSafeKey } from '../utils/helpers.js';

const router = Router();

/**
 * GET /api/settings
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    let rows = [];
    try {
      rows = await queryAll('SELECT * FROM competition_settings');
    } catch (pgErr) {
      console.warn('Postgres query failed in GET /api/settings, falling back to Supabase REST:', pgErr.message);
      const { data, error: supaErr } = await supabaseAdmin.from('competition_settings').select('*');
      if (supaErr) throw supaErr;
      rows = data || [];
    }

    const settings = Object.create(null);
    for (const row of rows) {
      if (!isSafeKey(row.key)) continue;
      try {
        settings[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
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

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: 'settings object required', code: 'VALIDATION_ERROR' });
    }

    const updatedKeys = [];
    for (const [key, value] of Object.entries(settings)) {
      // Guard against prototype pollution
      if (!isSafeKey(key)) continue;

      try {
        await query(
          `INSERT INTO competition_settings (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, JSON.stringify(value)]
        );
      } catch (pgErr) {
        console.warn('Postgres query failed in PUT /api/settings, falling back to Supabase REST:', pgErr.message);
        const { error: supaErr } = await supabaseAdmin
          .from('competition_settings')
          .upsert({
            key,
            value: value,
            updated_at: new Date().toISOString()
          }, { onConflict: 'key' });
        if (supaErr) throw supaErr;
      }
      updatedKeys.push(key);
    }

    try {
      await logAction(req.user.id, 'settings.updated', 'settings', null,
        { keys: Object.keys(settings) }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error in PUT /api/settings:', logErr.message);
    }

    // Return updated settings
    let rows = [];
    try {
      rows = await queryAll('SELECT * FROM competition_settings');
    } catch {
      const { data } = await supabaseAdmin.from('competition_settings').select('*');
      rows = data || [];
    }

    const result = {};
    for (const row of rows) {
      try {
        result[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      } catch {
        result[row.key] = row.value;
      }
    }

    res.json({ settings: result });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings', code: 'INTERNAL_ERROR' });
  }
});

export default router;
