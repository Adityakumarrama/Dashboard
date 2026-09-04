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

      const [teamsRes, juryRes, usersRes, assignmentsRes, evalsRes, auditRes] = await Promise.all([
        supabaseAdmin.from('teams').select('id, team_code, team_name, category, track, created_at', { count: 'exact' }).order('created_at', { ascending: false }),
        supabaseAdmin.from('users').select('id, full_name, judge_id, email, status', { count: 'exact' }).eq('role', 'JURY').eq('status', 'active'),
        supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabaseAdmin.from('jury_assignments').select('id, user_id, team_id', { count: 'exact' }),
        supabaseAdmin.from('evaluations').select('id, team_id, user_id, status, total_score, submitted_at', { count: 'exact' }),
        supabaseAdmin.from('audit_logs').select('action, entity_type, created_at, user_id, details').order('created_at', { ascending: false }).limit(10),
      ]);

      const totalTeams = teamsRes.count || 0;
      const totalJury = juryRes.count || 0;
      const totalUsers = usersRes.count || 0;
      const totalRequired = assignmentsRes.count || 0;

      const allEvals = evalsRes.data || [];
      const submittedEvals = allEvals.filter(e => e.status === 'submitted');
      const totalSubmitted = submittedEvals.length;
      const totalPending = Math.max(totalRequired - totalSubmitted, 0);
      const completionPercent = totalRequired > 0 ? parseFloat(((totalSubmitted / totalRequired) * 100).toFixed(1)) : 0;

      const submittedScores = submittedEvals.map(e => Number(e.total_score) || 0).filter(s => s > 0);
      const averageScore = submittedScores.length > 0
        ? parseFloat((submittedScores.reduce((a, b) => a + b, 0) / submittedScores.length).toFixed(1))
        : 0;

      // Calculate juryProgress accurately for each active jury member
      const assignments = assignmentsRes.data || [];
      const juries = juryRes.data || [];
      const juryProgress = juries.map(j => {
        const userAssignments = assignments.filter(a => a.user_id === j.id);
        const userEvals = allEvals.filter(e => e.user_id === j.id && e.status === 'submitted');
        const assigned = userAssignments.length;
        const completed = userEvals.length;
        const pending = Math.max(assigned - completed, 0);
        const progress = assigned > 0 ? parseFloat(((completed / assigned) * 100).toFixed(1)) : 0;
        const lastActivity = userEvals.length > 0
          ? userEvals.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0].submitted_at
          : null;
        return {
          id: j.id,
          full_name: j.full_name,
          judge_id: j.judge_id,
          assigned,
          completed,
          pending,
          progress,
          last_activity: lastActivity,
        };
      });

      return res.json({
        kpi: {
          totalTeams,
          totalJury,
          totalUsers,
          evaluationsRequired: totalRequired,
          evaluationsSubmitted: totalSubmitted,
          evaluationsPending: totalPending,
          completionPercent,
          averageScore,
        },
        recentActivity: auditRes.data || [],
        juryProgress,
        recentTeams: (teamsRes.data || []).slice(0, 5),
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

    try {
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

      const assigned = parseInt(assignedCount?.count || 0);
      const completed = parseInt(completedCount?.count || 0);
      const pending = assigned - completed;
      const progress = assigned > 0 ? ((completed / assigned) * 100).toFixed(1) : 0;

      return res.json({
        kpi: {
          assigned,
          completed,
          pending,
          progress: parseFloat(progress),
        },
        teams: pendingTeams || [],
      });
    } catch (pgErr) {
      console.warn('Postgres query failed in /api/stats/jury, falling back to Supabase REST client:', pgErr.message);

      const [assignmentsRes, evalsRes] = await Promise.all([
        supabaseAdmin.from('jury_assignments').select('*, teams(*)').eq('user_id', userId),
        supabaseAdmin.from('evaluations').select('id, team_id, status, total_score').eq('user_id', userId),
      ]);

      const assignments = assignmentsRes.data || [];
      const evals = evalsRes.data || [];
      const evalMap = new Map(evals.map(e => [e.team_id, e]));

      const teams = assignments.map(ja => {
        const ev = evalMap.get(ja.team_id);
        return {
          ...(ja.teams || {}),
          assigned_at: ja.assigned_at,
          eval_status: ev ? ev.status : 'not_started',
          total_score: ev ? ev.total_score : null,
          evaluation_id: ev ? ev.id : null,
        };
      }).sort((a, b) => {
        const order = { draft: 0, not_started: 1, submitted: 2 };
        const orderA = order[a.eval_status] !== undefined ? order[a.eval_status] : 1;
        const orderB = order[b.eval_status] !== undefined ? order[b.eval_status] : 1;
        if (orderA !== orderB) return orderA - orderB;
        return (a.team_code || '').localeCompare(b.team_code || '');
      });

      const assigned = assignments.length;
      const completed = evals.filter(e => e.status === 'submitted').length;
      const pending = assigned - completed;
      const progress = assigned > 0 ? ((completed / assigned) * 100).toFixed(1) : 0;

      return res.json({
        kpi: {
          assigned,
          completed,
          pending,
          progress: parseFloat(progress),
        },
        teams,
      });
    }
  } catch (error) {
    console.error('Jury stats error:', error);
    res.status(500).json({ error: error.message || 'Failed to get jury stats', code: 'INTERNAL_ERROR' });
  }
});

export default router;
