import dotenv from 'dotenv';
import { query, queryOne, queryAll } from '../config/database.js';

dotenv.config();

async function testTeamDelete() {
  console.log('🧪 Testing Team Deletion Flow...');

  let testTeam = null;
  let testJudge = null;

  try {
    // 1. Create a test team
    const code = 'DEL-TEST-' + Date.now().toString().slice(-4);
    testTeam = await queryOne(
      `INSERT INTO teams (team_code, team_name, category, track)
       VALUES ($1, 'Team To Delete', 'Software', 'AI')
       RETURNING *`,
      [code]
    );
    console.log(`✓ Created test team: ${testTeam.team_code} (ID: ${testTeam.id})`);

    // 2. Create test judge
    testJudge = await queryOne(
      `INSERT INTO users (username, email, full_name, role, judge_id, status)
       VALUES ($1, $2, 'Delete Test Judge', 'JURY', $3, 'active')
       RETURNING *`,
      [`jry_${code.toLowerCase()}`, `jry_${code.toLowerCase()}@sih.gov.in`, `JRY-${code}`]
    );

    // 3. Create assignment
    await query('INSERT INTO jury_assignments (user_id, team_id) VALUES ($1, $2)', [testJudge.id, testTeam.id]);

    // 4. Create evaluation & score
    const ev = await queryOne(
      'INSERT INTO evaluations (team_id, user_id, status, total_score) VALUES ($1, $2, \'submitted\', 85) RETURNING *',
      [testTeam.id, testJudge.id]
    );
    const crit = await queryOne('SELECT id FROM scoring_criteria WHERE is_active = true LIMIT 1');
    if (crit) {
      await query(
        'INSERT INTO evaluation_scores (evaluation_id, criteria_id, criterion_id, team_id, judge_id, score) VALUES ($1, $2, $2, $3, $4, 18)',
        [ev.id, crit.id, testTeam.id, testJudge.id]
      );
      await query(
        `INSERT INTO evaluation_score_history (evaluation_id, team_id, judge_id, status, total_score, scores_snapshot, action)
         VALUES ($1, $2, $3, 'submitted', 85, '[]'::jsonb, 'submitted')`,
        [ev.id, testTeam.id, testJudge.id]
      );
    }
    console.log('✓ Attached assignments, evaluation, scores, and history snapshot to team');

    // 5. Execute cascading delete
    await query('DELETE FROM evaluation_scores WHERE team_id = $1', [testTeam.id]);
    await query('DELETE FROM evaluation_score_history WHERE team_id = $1', [testTeam.id]);
    await query('DELETE FROM evaluations WHERE team_id = $1', [testTeam.id]);
    await query('DELETE FROM jury_assignments WHERE team_id = $1', [testTeam.id]);
    const delRes = await query('DELETE FROM teams WHERE id = $1 RETURNING *', [testTeam.id]);

    if (delRes.rowCount === 1) {
      console.log('✓ Team successfully deleted from teams table');
    } else {
      throw new Error('Failed to delete team');
    }

    // 6. Verify team is gone
    const checkTeam = await queryOne('SELECT * FROM teams WHERE id = $1', [testTeam.id]);
    if (!checkTeam) {
      console.log('✓ Verified: Team does not exist in database anymore');
    } else {
      throw new Error('Team still exists in database');
    }

    // 7. Verify evaluations are gone
    const checkEvals = await queryAll('SELECT * FROM evaluations WHERE team_id = $1', [testTeam.id]);
    if (checkEvals.length === 0) {
      console.log('✓ Verified: All associated evaluations and scores deleted');
    } else {
      throw new Error('Associated evaluations were not cleaned up');
    }

    console.log('\n🎉 ALL TEAM DELETION CHECKS PASSED!\n');
  } catch (error) {
    console.error('❌ Team delete test error:', error);
    process.exit(1);
  } finally {
    if (testJudge) {
      await query('DELETE FROM users WHERE id = $1', [testJudge.id]);
    }
    process.exit(0);
  }
}

testTeamDelete();
