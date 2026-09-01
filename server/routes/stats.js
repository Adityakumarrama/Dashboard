import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireAny } from '../middleware/rbac.js';
import { queryOne, queryAll } from '../config/database.js';

const router = Router();

/**
 * GET /api/stats/admin
 * Admin dashboard statistics
 */
router.get('/admin', authenticate, requireAdmin, async (req, res) => {
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

    const totalRequired = parseInt(totalEvaluations.count);
    const totalSubmitted = parseInt(submittedEvaluations.count);
    const completionPercent = totalRequired > 0 ? ((totalSubmitted / totalRequired) * 100).toFixed(1) : 0;

    res.json({
      kpi: {
        totalTeams: parseInt(totalTeams.count),
        totalJury: parseInt(totalJury.count),
        totalUsers: parseInt(totalUsers.count),
        evaluationsRequired: totalRequired,
        evaluationsSubmitted: totalSubmitted,
        evaluationsPending: totalRequired - totalSubmitted,
        completionPercent: parseFloat(completionPercent),
        averageScore: avgScore.avg ? parseFloat(parseFloat(avgScore.avg).toFixed(1)) : 0,
      },
      recentActivity,
      juryProgress: juryProgress.map(j => ({
        ...j,
        assigned: parseInt(j.assigned),
        completed: parseInt(j.completed),
        pending: parseInt(j.pending),
        progress: j.assigned > 0 ? ((parseInt(j.completed) / parseInt(j.assigned)) * 100).toFixed(1) : 0,
      })),
      recentTeams,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to get admin stats', code: 'INTERNAL_ERROR' });
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
