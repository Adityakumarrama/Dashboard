import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireAny } from '../middleware/rbac.js';
import { queryOne, queryAll } from '../config/database.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

/**
 * GET /api/stats/admin
 * Admin dashboard statistics
 */
router.get('/admin', authenticate, requireAdmin, async (req, res) => {
  try {
    try {
      const [
        totalTeams, totalJury, totalUsers,
        totalEvaluations, submittedEvaluations,
        avgScore, recentActivity, juryProgress, recentTeams
      ] = await Promise.all([
        queryOne('SELECT COUNT(*) as count FROM teams'),
        queryOne("SELECT COUNT(*) as count FROM users WHERE role = 'JURY' AND status = 'active'"),
        queryOne('SELECT COUNT(*) as count FROM users WHERE status = \'active\''),
        queryOne('SELECT COUNT(*) as count FROM jury_assignments'),
        queryOne("SELECT COUNT(*) as count FROM evaluations WHERE status = 'submitted'"),
        queryOne("SELECT AVG(total_score) as avg FROM evaluations WHERE status = 'submitted'"),
        queryAll(
          `SELECT al.action, al.entity_type, al.created_at, u.full_name as user_name, al.details
           FROM audit_logs al
           LEFT JOIN users u ON al.user_id = u.id
           ORDER BY al.created_at DESC LIMIT 10`
        ),
        queryAll(
          `SELECT u.id, u.full_name, u.judge_id,
            COUNT(ja.id) as assigned,
            COUNT(CASE WHEN e.status = 'submitted' THEN 1 END) as completed,
            COUNT(CASE WHEN e.status IS NULL OR e.status != 'submitted' THEN 1 END) as pending,
            MAX(e.submitted_at) as last_activity
           FROM users u
           LEFT JOIN jury_assignments ja ON ja.user_id = u.id
           LEFT JOIN evaluations e ON e.team_id = ja.team_id AND e.user_id = u.id
           WHERE u.role = 'JURY' AND u.status = 'active'
           GROUP BY u.id, u.full_name, u.judge_id
           ORDER BY u.full_name`
        ),
        queryAll('SELECT * FROM teams ORDER BY created_at DESC LIMIT 5'),
      ]);

      const totalRequired = parseInt(totalEvaluations?.count || 0);
      const totalSubmitted = parseInt(submittedEvaluations?.count || 0);
      const completionPercent = totalRequired > 0 ? ((totalSubmitted / totalRequired) * 100).toFixed(1) : 0;

      return res.json({
        kpi: {
          totalTeams: parseInt(totalTeams?.count || 0),
          totalJury: parseInt(totalJury?.count || 0),
          totalUsers: parseInt(totalUsers?.count || 0),
          evaluationsRequired: totalRequired,
          evaluationsSubmitted: totalSubmitted,
          evaluationsPending: totalRequired - totalSubmitted,
          completionPercent: parseFloat(completionPercent),
          averageScore: avgScore?.avg ? parseFloat(parseFloat(avgScore.avg).toFixed(1)) : 0,
        },
        recentActivity: recentActivity || [],
        juryProgress: (juryProgress || []).map(j => ({
          ...j,
          assigned: parseInt(j.assigned || 0),
          completed: parseInt(j.completed || 0),
          pending: parseInt(j.pending || 0),
          progress: parseInt(j.assigned || 0) > 0 ? ((parseInt(j.completed || 0) / parseInt(j.assigned || 1)) * 100).toFixed(1) : 0,
        })),
        recentTeams: recentTeams || [],
      });
    } catch (pgErr) {
      console.warn('Postgres query failed in /api/stats/admin, falling back to Supabase REST client:', pgErr.message);

      const [teamsRes, juryRes, usersRes] = await Promise.all([
        supabaseAdmin.from('teams').select('id', { count: 'exact', head: true }),
        supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('role', 'JURY'),
        supabaseAdmin.from('users').select('id', { count: 'exact', head: true }),
      ]);

      return res.json({
        kpi: {
          totalTeams: teamsRes.count || 0,
          totalJury: juryRes.count || 0,
          totalUsers: usersRes.count || 0,
          evaluationsRequired: 0,
          evaluationsSubmitted: 0,
          evaluationsPending: 0,
          completionPercent: 0,
          averageScore: 0,
        },
        recentActivity: [],
        juryProgress: [],
        recentTeams: [],
      });
    }
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: error.message || 'Failed to get admin stats', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/stats/jury
 * Jury dashboard statistics
 */
router.get('/jury', authenticate, requireAny, async (req, res) => {
  try {
    const userId = req.user.id;

    const [assignedCount, completedCount, pendingTeams] = await Promise.all([
      queryOne('SELECT COUNT(*) as count FROM jury_assignments WHERE user_id = $1', [userId]),
      queryOne(
        "SELECT COUNT(*) as count FROM evaluations WHERE user_id = $1 AND status = 'submitted'",
        [userId]
      ),
      queryAll(
        `SELECT t.*, ja.assigned_at,
          CASE WHEN e.id IS NOT NULL THEN e.status ELSE 'not_started' END as eval_status,
          e.total_score, e.id as evaluation_id
         FROM jury_assignments ja
         JOIN teams t ON ja.team_id = t.id
         LEFT JOIN evaluations e ON e.team_id = t.id AND e.user_id = $1
         WHERE ja.user_id = $1
         ORDER BY
           CASE WHEN e.status = 'submitted' THEN 2
                WHEN e.status = 'draft' THEN 0
                ELSE 1 END,
           t.team_code`,
        [userId]
      ),
    ]);

    const assigned = parseInt(assignedCount.count);
    const completed = parseInt(completedCount.count);
    const pending = assigned - completed;
    const progress = assigned > 0 ? ((completed / assigned) * 100).toFixed(1) : 0;

    res.json({
      kpi: {
        assigned,
        completed,
        pending,
        progress: parseFloat(progress),
      },
      teams: pendingTeams,
    });
  } catch (error) {
    console.error('Jury stats error:', error);
    res.status(500).json({ error: 'Failed to get jury stats', code: 'INTERNAL_ERROR' });
  }
});

export default router;
