import dotenv from 'dotenv';
import { query, queryOne, queryAll, transaction } from '../config/database.js';
import {
  saveEvaluationScores,
  submitEvaluation,
  reopenEvaluation,
  getTeamScores,
  getLeaderboard,
} from '../services/scoringService.js';

dotenv.config();

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  }
  passedTests++;
  console.log(`  ✓ PASS: ${message}`);
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING CRITICAL SCORE CALCULATION TEST SUITE');
  console.log('====================================================\n');

  let testTeam = null;
  let testJudges = [];
  let testAdmin = null;
  let criteria = [];

  try {
    // -----------------------------------------------------------
    // SETUP TEST DATA
    // -----------------------------------------------------------
    console.log('📋 Step 0: Setting up test fixtures...');

    // Fetch active criteria in sort order
    criteria = await queryAll('SELECT * FROM scoring_criteria WHERE is_active = true ORDER BY sort_order');
    assert(criteria.length >= 5, `At least 5 active scoring criteria present (found ${criteria.length})`);

    // Create or get Admin
    testAdmin = await queryOne("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
    if (!testAdmin) {
      testAdmin = await queryOne(
        `INSERT INTO users (username, email, full_name, role, status)
         VALUES ('test_admin', 'test_admin@sih.gov.in', 'Test Admin', 'ADMIN', 'active')
         RETURNING *`
      );
    }

    // Create Test Team
    const testTeamCode = 'SIH2026-TEST-' + Date.now().toString().slice(-4);
    testTeam = await queryOne(
      `INSERT INTO teams (team_code, team_name, category, track, organization)
       VALUES ($1, 'Test Innovation Team', 'Software', 'Smart Automation', 'National Institute of Tech')
       RETURNING *`,
      [testTeamCode]
    );
    assert(testTeam !== null, `Created test team: ${testTeam.team_code}`);

    // Create 4 Test Judges
    for (const name of ['Judge A', 'Judge B', 'Judge C', 'Judge D']) {
      const code = name.replace(' ', '_').toLowerCase() + '_' + Date.now().toString().slice(-4);
      const judge = await queryOne(
        `INSERT INTO users (username, email, full_name, role, judge_id, status)
         VALUES ($1, $2, $3, 'JURY', $4, 'active')
         RETURNING *`,
        [code, `${code}@sih.gov.in`, `Test ${name}`, `JRY-${code}`]
      );
      testJudges.push(judge);

      // Assign judge to test team
      await query(
        'INSERT INTO jury_assignments (user_id, team_id) VALUES ($1, $2)',
        [judge.id, testTeam.id]
      );
    }
    assert(testJudges.length === 4, 'Created 4 test judges with team assignments');

    // -----------------------------------------------------------
    // TEST CASE 1: Judge A scores 18, 17, 19, 16, 18 = 88
    // -----------------------------------------------------------
    console.log('\n⚖️ Test Case 1: Judge A Evaluation (88 / 100)...');
    const judgeA = testJudges[0];
    const evalA = await queryOne(
      'INSERT INTO evaluations (team_id, user_id, status) VALUES ($1, $2, \'draft\') RETURNING *',
      [testTeam.id, judgeA.id]
    );

    const scoresA = [
      { criteria_id: criteria[0].id, score: 18, comment: 'Great innovation' },
      { criteria_id: criteria[1].id, score: 17, comment: 'Solid tech' },
      { criteria_id: criteria[2].id, score: 19, comment: 'High impact' },
      { criteria_id: criteria[3].id, score: 16, comment: 'Working prototype' },
      { criteria_id: criteria[4].id, score: 18, comment: 'Clear presentation' },
    ];

    // Save draft
    const savedA = await saveEvaluationScores(evalA.id, scoresA, 'Strong team overall', judgeA);
    assert(Number(savedA.total_score) === 88, `Judge A draft total calculated by PostgreSQL = ${savedA.total_score} (expected 88)`);

    // Submit evaluation
    const subResultA = await submitEvaluation(evalA.id, judgeA, '127.0.0.1');
    assert(subResultA.evaluation.status === 'submitted', 'Judge A evaluation successfully locked and marked submitted');
    assert(Number(subResultA.evaluation.total_score) === 88, 'Judge A official total score is 88');

    // Check team aggregate after 1 judge
    const teamStatsA = await getTeamScores(testTeam.id);
    assert(Number(teamStatsA.completed_judges) === 1, 'Completed judges count = 1');
    assert(Number(teamStatsA.aggregate_score) === 88.0, `Team aggregate after Judge A = ${teamStatsA.aggregate_score} (expected 88.00)`);

    // -----------------------------------------------------------
    // TEST CASE 2: Judge B scores 20, 18, 17, 19, 18 = 92
    // -----------------------------------------------------------
    console.log('\n⚖️ Test Case 2: Judge B Evaluation (92 / 100)...');
    const judgeB = testJudges[1];
    const evalB = await queryOne(
      'INSERT INTO evaluations (team_id, user_id, status) VALUES ($1, $2, \'draft\') RETURNING *',
      [testTeam.id, judgeB.id]
    );

    const scoresB = [
      { criteria_id: criteria[0].id, score: 20 },
      { criteria_id: criteria[1].id, score: 18 },
      { criteria_id: criteria[2].id, score: 17 },
      { criteria_id: criteria[3].id, score: 19 },
      { criteria_id: criteria[4].id, score: 18 },
    ];

    await saveEvaluationScores(evalB.id, scoresB, 'Outstanding effort', judgeB);
    const subResultB = await submitEvaluation(evalB.id, judgeB, '127.0.0.1');
    assert(Number(subResultB.evaluation.total_score) === 92, `Judge B total score = ${subResultB.evaluation.total_score} (expected 92)`);

    const teamStatsB = await getTeamScores(testTeam.id);
    assert(Number(teamStatsB.completed_judges) === 2, 'Completed judges count = 2');
    assert(Number(teamStatsB.aggregate_score) === 90.0, `Team aggregate after Judge B = (88 + 92)/2 = ${teamStatsB.aggregate_score} (expected 90.00)`);

    // -----------------------------------------------------------
    // TEST CASE 3: Judge C scores 17, 19, 18, 17, 19 = 90
    // -----------------------------------------------------------
    console.log('\n⚖️ Test Case 3: Judge C Evaluation (90 / 100) -> Team Average Exactly 90.00...');
    const judgeC = testJudges[2];
    const evalC = await queryOne(
      'INSERT INTO evaluations (team_id, user_id, status) VALUES ($1, $2, \'draft\') RETURNING *',
      [testTeam.id, judgeC.id]
    );

    const scoresC = [
      { criteria_id: criteria[0].id, score: 17 },
      { criteria_id: criteria[1].id, score: 19 },
      { criteria_id: criteria[2].id, score: 18 },
      { criteria_id: criteria[3].id, score: 17 },
      { criteria_id: criteria[4].id, score: 19 },
    ];

    await saveEvaluationScores(evalC.id, scoresC, 'Very good team', judgeC);
    const subResultC = await submitEvaluation(evalC.id, judgeC, '127.0.0.1');
    assert(Number(subResultC.evaluation.total_score) === 90, `Judge C total score = ${subResultC.evaluation.total_score} (expected 90)`);

    // Authoritative check: (88 + 92 + 90) / 3 = 90.00
    const teamStatsC = await getTeamScores(testTeam.id);
    assert(Number(teamStatsC.completed_judges) === 3, 'Completed judges count = 3');
    assert(Number(teamStatsC.aggregate_score) === 90.0, `Official PostgreSQL Team Aggregate Score = (88 + 92 + 90) / 3 = ${teamStatsC.aggregate_score} (expected 90.00)`);
    assert(Number(teamStatsC.highest_score) === 92.0, `PostgreSQL Highest Score = ${teamStatsC.highest_score} (expected 92)`);
    assert(Number(teamStatsC.lowest_score) === 88.0, `PostgreSQL Lowest Score = ${teamStatsC.lowest_score} (expected 88)`);

    // Check v_leaderboard authoritative result
    const lbResult = await getLeaderboard({ search: testTeam.team_code });
    assert(lbResult.rows.length === 1, 'Team present in v_leaderboard');
    assert(Number(lbResult.rows[0].aggregate_score) === 90.0, `Leaderboard aggregate score = ${lbResult.rows[0].aggregate_score} (matches 90.00)`);
    assert(Number(lbResult.rows[0].overall_rank) >= 1, `Leaderboard ranking assigned: #${lbResult.rows[0].overall_rank}`);

    // -----------------------------------------------------------
    // TEST CASE 4: Draft Score Isolation Test
    // Judge D enters draft scores: 20, 20, 20, 20, 20 = 100
    // DRAFT MUST NOT AFFECT TEAM AGGREGATE SCORE!
    // -----------------------------------------------------------
    console.log('\n🛡️ Test Case 4: Draft Score Isolation (Judge D enters 100 / 100 draft)...');
    const judgeD = testJudges[3];
    const evalD = await queryOne(
      'INSERT INTO evaluations (team_id, user_id, status) VALUES ($1, $2, \'draft\') RETURNING *',
      [testTeam.id, judgeD.id]
    );

    const scoresD = [
      { criteria_id: criteria[0].id, score: 20 },
      { criteria_id: criteria[1].id, score: 20 },
      { criteria_id: criteria[2].id, score: 20 },
      { criteria_id: criteria[3].id, score: 20 },
      { criteria_id: criteria[4].id, score: 20 },
    ];

    const savedD = await saveEvaluationScores(evalD.id, scoresD, 'Draft in progress', judgeD);
    assert(Number(savedD.total_score) === 100, `Judge D draft score total in DB = ${savedD.total_score} (preview only)`);
    assert(savedD.status === 'draft', 'Judge D evaluation status is still draft');

    // CRITICAL ASSERTION: Team aggregate in PostgreSQL MUST STILL BE 90.00!
    const teamStatsAfterDraft = await getTeamScores(testTeam.id);
    assert(Number(teamStatsAfterDraft.completed_judges) === 3, 'Completed judges count is still 3 (draft ignored)');
    assert(Number(teamStatsAfterDraft.draft_judges) === 1, 'Draft judges count is 1');
    assert(Number(teamStatsAfterDraft.aggregate_score) === 90.0, `CRITICAL: Team Aggregate remains STRICTLY 90.00 despite draft score of 100! (value: ${teamStatsAfterDraft.aggregate_score})`);

    const lbAfterDraft = await getLeaderboard({ search: testTeam.team_code });
    assert(Number(lbAfterDraft.rows[0].aggregate_score) === 90.0, 'Leaderboard aggregate score remains 90.00 (draft has ZERO effect)');

    // -----------------------------------------------------------
    // TEST CASE 5: Security & Zero-Trust Verification
    // -----------------------------------------------------------
    console.log('\n🔒 Test Case 5: Security & Score Validation Limits...');

    // Attempt invalid score: 25 / 20
    let invalidCaught = false;
    try {
      await saveEvaluationScores(evalD.id, [{ criteria_id: criteria[0].id, score: 25 }], '', judgeD);
    } catch (err) {
      invalidCaught = true;
      assert(err.code === 'INVALID_SCORE', `Correctly rejected score 25 > max_score (error: ${err.message})`);
    }
    assert(invalidCaught, 'Score exceeding limit was blocked');

    // Attempt negative score: -5
    let negativeCaught = false;
    try {
      await saveEvaluationScores(evalD.id, [{ criteria_id: criteria[0].id, score: -5 }], '', judgeD);
    } catch (err) {
      negativeCaught = true;
      assert(err.code === 'INVALID_SCORE', `Correctly rejected negative score (error: ${err.message})`);
    }
    assert(negativeCaught, 'Negative score was blocked');

    // -----------------------------------------------------------
    // TEST CASE 6: Incomplete Evaluation Submission Block
    // -----------------------------------------------------------
    console.log('\n🚫 Test Case 6: Incomplete Evaluation Block...');
    // Create new incomplete eval
    const incompleteEval = await queryOne(
      'INSERT INTO evaluations (team_id, user_id, status) VALUES ($1, $2, \'draft\') RETURNING *',
      [testTeam.id, testAdmin.id]
    );
    // Score only 1 criterion
    await saveEvaluationScores(incompleteEval.id, [{ criteria_id: criteria[0].id, score: 15 }], '', testAdmin);

    let incompleteBlocked = false;
    try {
      await submitEvaluation(incompleteEval.id, testAdmin, '127.0.0.1');
    } catch (err) {
      incompleteBlocked = true;
      assert(err.code === 'INCOMPLETE_SCORES', `Correctly blocked submission of incomplete evaluation (${err.message})`);
    }
    assert(incompleteBlocked, 'Incomplete evaluation blocked from submission');

    // -----------------------------------------------------------
    // TEST CASE 7: Score Edit & Admin Reopen Flow
    // -----------------------------------------------------------
    console.log('\n🔄 Test Case 7: Admin Reopen Flow & Score History Audit...');
    // Admin reopens Judge C's evaluation
    const reopenResult = await reopenEvaluation(evalC.id, testAdmin, 'Allowing score refinement', '127.0.0.1');
    assert(reopenResult.evaluation.status === 'reopened', 'Evaluation status changed to reopened');
    assert(reopenResult.evaluation.locked_at === null, 'Evaluation locked_at cleared');

    // Check history table has archived snapshot
    const historyRows = await queryAll(
      'SELECT * FROM evaluation_score_history WHERE evaluation_id = $1 ORDER BY created_at DESC',
      [evalC.id]
    );
    assert(historyRows.length >= 2, `Audit history preserved snapshots (count: ${historyRows.length})`);
    assert(historyRows[0].action === 'reopened', 'Latest history record action is reopened');
    assert(historyRows[1].action === 'submitted', 'Prior history record action is submitted');

    // While reopened, team aggregate only has 2 submitted judges
    const teamStatsDuringReopen = await getTeamScores(testTeam.id);
    assert(Number(teamStatsDuringReopen.completed_judges) === 2, 'Completed judges temporarily adjusted to 2 while reopened');

    // Judge C updates score: 18, 19, 18, 17, 18 = 90
    const scoresCUpdated = [
      { criteria_id: criteria[0].id, score: 18 },
      { criteria_id: criteria[1].id, score: 19 },
      { criteria_id: criteria[2].id, score: 18 },
      { criteria_id: criteria[3].id, score: 17 },
      { criteria_id: criteria[4].id, score: 18 },
    ];
    await saveEvaluationScores(evalC.id, scoresCUpdated, 'Refined after demo review', judgeC);
    const resubmittedC = await submitEvaluation(evalC.id, judgeC, '127.0.0.1');
    assert(Number(resubmittedC.evaluation.total_score) === 90, 'Resubmitted total score is 90');

    // Final team aggregate verified
    const finalTeamStats = await getTeamScores(testTeam.id);
    assert(Number(finalTeamStats.completed_judges) === 3, 'Completed judges restored to 3');
    assert(Number(finalTeamStats.aggregate_score) === 90.0, `Final Team Aggregate Score = ${finalTeamStats.aggregate_score} (exact 90.00)`);

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passedTests} / ${totalTests} TESTS PASSED SUCCESSFULLY!`);
    console.log('PostgreSQL database-first calculation architecture verified.');
    console.log('====================================================\n');
  } catch (error) {
    console.error('\n❌ TEST RUN ABORTED DUE TO ERROR:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    // Clean up test data
    console.log('🧹 Cleaning up test artifacts...');
    if (testTeam) {
      await query('DELETE FROM teams WHERE id = $1', [testTeam.id]);
    }
    for (const judge of testJudges) {
      await query('DELETE FROM users WHERE id = $1', [judge.id]);
    }
    console.log('✓ Test fixtures cleaned up.\n');
    process.exit(0);
  }
}

runTests();
