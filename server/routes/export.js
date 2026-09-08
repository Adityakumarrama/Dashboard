import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { queryAll } from '../config/database.js';
import { escapeCsvCell } from '../utils/helpers.js';

const router = Router();

function toCsv(data, columns) {
  if (!data || data.length === 0) return '';
  const header = columns.join(',');
  const rows = data.map(row =>
    columns.map(col => {
      let val = row[col];
      if (val === null || val === undefined) return '';
      // Escape potential CSV formula injection (=, +, -, @, \t, \r)
      val = escapeCsvCell(val);
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * GET /api/export/teams
 */
router.get('/teams', authenticate, requireAdmin, async (req, res) => {
  try {
    const teams = await queryAll('SELECT * FROM teams ORDER BY team_code');
    const csv = toCsv(teams, [
      'team_code', 'team_name', 'problem_statement_id', 'problem_statement_title',
      'organization', 'category', 'track', 'team_leader', 'team_members',
      'contact_info', 'presentation_status', 'demo_status', 'registration_status', 'created_at'
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="teams_export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Export teams error:', error);
    res.status(500).json({ error: 'Failed to export teams', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/export/users
 */
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await queryAll(
      `SELECT id, username, email, full_name, role, judge_id, status, last_login_at, created_at
       FROM users ORDER BY full_name`
    );
    const csv = toCsv(users, ['username', 'email', 'full_name', 'role', 'judge_id', 'status', 'last_login_at', 'created_at']);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users_export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Export users error:', error);
    res.status(500).json({ error: 'Failed to export users', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/export/assignments
 */
router.get('/assignments', authenticate, requireAdmin, async (req, res) => {
  try {
    const data = await queryAll(
      `SELECT u.full_name as jury_name, u.judge_id, u.email as jury_email,
        t.team_code, t.team_name, t.category, t.track,
        ja.assigned_at
       FROM jury_assignments ja
       JOIN users u ON ja.user_id = u.id
       JOIN teams t ON ja.team_id = t.id
       ORDER BY u.full_name, t.team_code`
    );
    const csv = toCsv(data, ['jury_name', 'judge_id', 'jury_email', 'team_code', 'team_name', 'category', 'track', 'assigned_at']);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="assignments_export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Export assignments error:', error);
    res.status(500).json({ error: 'Failed to export assignments', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/export/evaluations
 */
router.get('/evaluations', authenticate, requireAdmin, async (req, res) => {
  try {
    const data = await queryAll(
      `SELECT t.team_code, t.team_name, t.problem_statement_id,
        u.full_name as judge_name, u.judge_id,
        e.status, e.total_score, e.weighted_score, e.normalized_score,
        e.submitted_at, e.created_at
       FROM evaluations e
       JOIN teams t ON e.team_id = t.id
       JOIN users u ON e.user_id = u.id
       ORDER BY t.team_code, u.full_name`
    );
    const csv = toCsv(data, [
      'team_code', 'team_name', 'problem_statement_id', 'judge_name', 'judge_id',
      'status', 'total_score', 'weighted_score', 'normalized_score', 'submitted_at', 'created_at'
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="evaluations_export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Export evaluations error:', error);
    res.status(500).json({ error: 'Failed to export evaluations', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/export/scores
 * Detailed score breakdown
 */
router.get('/scores', authenticate, requireAdmin, async (req, res) => {
  try {
    const data = await queryAll(
      `SELECT t.team_code, t.team_name, u.full_name as judge_name,
        sc.name as criteria_name, es.score, sc.max_score,
        e.total_score, e.weighted_score, e.submitted_at
       FROM evaluation_scores es
       JOIN evaluations e ON es.evaluation_id = e.id
       JOIN teams t ON e.team_id = t.id
       JOIN users u ON e.user_id = u.id
       JOIN scoring_criteria sc ON es.criteria_id = sc.id
       WHERE e.status = 'submitted'
       ORDER BY t.team_code, u.full_name, sc.sort_order`
    );
    const csv = toCsv(data, [
      'team_code', 'team_name', 'judge_name', 'criteria_name', 'score', 'max_score',
      'total_score', 'weighted_score', 'submitted_at'
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="score_details_export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Export scores error:', error);
    res.status(500).json({ error: 'Failed to export scores', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/export/imports
 */
router.get('/imports', authenticate, requireAdmin, async (req, res) => {
  try {
    const data = await queryAll(
      `SELECT i.*, u.full_name as imported_by
       FROM imports i JOIN users u ON i.user_id = u.id
       ORDER BY i.created_at DESC`
    );
    const csv = toCsv(data, [
      'file_name', 'file_type', 'total_records', 'created_count', 'updated_count',
      'skipped_count', 'failed_count', 'status', 'imported_by', 'created_at'
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="import_history_export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Export imports error:', error);
    res.status(500).json({ error: 'Failed to export imports', code: 'INTERNAL_ERROR' });
  }
});

export default router;
