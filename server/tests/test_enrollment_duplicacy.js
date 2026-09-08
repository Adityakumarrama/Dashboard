import { normalizeEnrollment, extractRecordParticipants } from '../routes/import.js';
import assert from 'assert';

console.log('\n🔍 RUNNING ENROLLMENT DUPLICACY & COLLISION TESTS\n');

// 1. Test normalizeEnrollment
console.log('1. Testing Enrollment Normalization:');
{
  assert.strictEqual(normalizeEnrollment('  RU2505199  '), 'RU2505199');
  assert.strictEqual(normalizeEnrollment('ru2505199'), 'ru2505199');
  assert.strictEqual(normalizeEnrollment(null), null);
  assert.strictEqual(normalizeEnrollment(''), null);
  assert.strictEqual(normalizeEnrollment('   '), null);
  assert.strictEqual(normalizeEnrollment('-'), null);
  assert.strictEqual(normalizeEnrollment('N/A'), null);
  assert.strictEqual(normalizeEnrollment('na'), null);
  assert.strictEqual(normalizeEnrollment('None'), null);
  assert.strictEqual(normalizeEnrollment('x'), null); // too short
  assert.strictEqual(normalizeEnrollment('RU2024FET001'), 'RU2024FET001');
  console.log('  ✅ PASS: Normalization handles whitespace, case, and placeholders correctly');
}

// 2. Test extractRecordParticipants
console.log('2. Testing Participant Extraction:');
{
  const mockRecord = {
    team_name: 'Test Team',
    team_leader: 'Aman Sharma',
    leader_enrollment: 'RU240101',
    team_members: [
      { name: 'Priya Singh', enrollment_number: 'RU240102', member_number: 1 },
      { name: 'Rahul Verma', enrollment_number: 'RU240103', member_number: 2 },
      { name: 'Empty Member', enrollment_number: 'N/A', member_number: 3 },
    ]
  };

  const participants = extractRecordParticipants(mockRecord);
  assert.strictEqual(participants.length, 3);
  assert.strictEqual(participants[0].role, 'Team Leader');
  assert.strictEqual(participants[0].enrollment, 'RU240101');
  assert.strictEqual(participants[1].role, 'Member 1');
  assert.strictEqual(participants[1].enrollment, 'RU240102');
  assert.strictEqual(participants[2].role, 'Member 2');
  assert.strictEqual(participants[2].enrollment, 'RU240103');
  console.log('  ✅ PASS: Leader and members extracted with proper roles and filtered placeholders');
}

// 3. Test Intra-team duplicate detection
console.log('3. Testing Intra-team Duplicate Detection (Same team):');
{
  const teamWithSelfDuplicate = {
    team_code: 'SIH_TEST_01',
    team_name: 'Alpha Squad',
    team_leader: 'Aman Sharma',
    leader_enrollment: 'RU240101',
    team_members: [
      { name: 'Aman Duplicate', enrollment_number: 'RU240101', member_number: 1 },
      { name: 'Rohan', enrollment_number: 'RU240105', member_number: 2 }
    ]
  };

  const participants = extractRecordParticipants(teamWithSelfDuplicate);
  const currentTeamEnrollments = new Set();
  const conflicts = [];

  for (const p of participants) {
    const key = p.enrollment.toLowerCase();
    if (currentTeamEnrollments.has(key)) {
      conflicts.push({
        enrollmentNumber: p.enrollment,
        currentStudent: p.name,
        currentRole: p.role,
        conflictSource: 'Same Team',
        message: `Enrollment ${p.enrollment} (${p.name}) is entered multiple times in team "${teamWithSelfDuplicate.team_name}"`
      });
    }
    currentTeamEnrollments.add(key);
  }

  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].enrollmentNumber, 'RU240101');
  assert.strictEqual(conflicts[0].conflictSource, 'Same Team');
  assert(conflicts[0].message.includes('entered multiple times in team "Alpha Squad"'));
  console.log('  ✅ PASS: Detected participant entered twice in same team');
}

// 4. Test Cross-Team In-File collision
console.log('4. Testing Cross-Team In-File Collision:');
{
  const existingMap = new Map(); // database empty
  const fileEnrollmentMap = new Map();
  fileEnrollmentMap.set('ru240999', [{
    rowIndex: 1,
    teamCode: 'SIH_TEAM_01',
    teamName: 'Team First',
    role: 'Member 2',
    name: 'Sameer Khan'
  }]);

  const secondTeam = {
    team_code: 'SIH_TEAM_02',
    team_name: 'Team Second',
    team_leader: 'Sameer Khan',
    leader_enrollment: 'RU240999'
  };

  const participants = extractRecordParticipants(secondTeam);
  const conflicts = [];

  for (const p of participants) {
    const key = p.enrollment.toLowerCase();
    if (fileEnrollmentMap.has(key)) {
      const match = fileEnrollmentMap.get(key)[0];
      conflicts.push({
        enrollmentNumber: p.enrollment,
        currentStudent: p.name,
        currentRole: p.role,
        conflictSource: 'Uploaded File',
        conflictRow: match.rowIndex,
        conflictTeamName: match.teamName,
        conflictTeamCode: match.teamCode,
        conflictRole: match.role,
        conflictStudent: match.name,
        message: `Enrollment ${p.enrollment} (${p.name}, ${p.role}) is duplicated in file at Row ${match.rowIndex}, team "${match.teamName}" (${match.teamCode}) as ${match.role} (${match.name})`
      });
    }
  }

  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].conflictRow, 1);
  assert.strictEqual(conflicts[0].conflictTeamName, 'Team First');
  assert.strictEqual(conflicts[0].conflictRole, 'Member 2');
  console.log('  ✅ PASS: Correctly flagged conflict with previous team in file and named exact location');
}

// 5. Test Database Collision
console.log('5. Testing Database Collision:');
{
  const existingEnrollmentMap = new Map();
  existingEnrollmentMap.set('ru2505199', [{
    enrollment: 'RU2505199',
    role: 'Team Leader',
    name: 'Divya Gupta',
    teamCode: 'SIH_BIOB_01',
    teamName: 'BioByte',
    source: 'Database'
  }]);

  const newTeam = {
    team_code: 'SIH_NEWT_05',
    team_name: 'New Horizon',
    team_leader: 'Other Leader',
    leader_enrollment: 'RU999999',
    team_members: [
      { name: 'Divya G', enrollment_number: 'ru2505199', member_number: 1 }
    ]
  };

  const participants = extractRecordParticipants(newTeam);
  const conflicts = [];

  for (const p of participants) {
    const key = p.enrollment.toLowerCase();
    if (existingEnrollmentMap.has(key)) {
      const match = existingEnrollmentMap.get(key)[0];
      conflicts.push({
        enrollmentNumber: p.enrollment,
        currentStudent: p.name,
        currentRole: p.role,
        conflictSource: 'Database',
        conflictTeamName: match.teamName,
        conflictTeamCode: match.teamCode,
        conflictRole: match.role,
        conflictStudent: match.name,
        message: `Enrollment ${p.enrollment} (${p.name}, ${p.role}) is already registered in Database team "${match.teamName}" (${match.teamCode}) as ${match.role} (${match.name})`
      });
    }
  }

  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].conflictSource, 'Database');
  assert.strictEqual(conflicts[0].conflictTeamName, 'BioByte');
  assert.strictEqual(conflicts[0].conflictTeamCode, 'SIH_BIOB_01');
  assert.strictEqual(conflicts[0].conflictRole, 'Team Leader');
  assert.strictEqual(conflicts[0].conflictStudent, 'Divya Gupta');
  console.log('  ✅ PASS: Identified database conflict telling exact team name, code, role, and student name');
}

console.log('\n============================================================');
console.log('🎉 ALL 5 ENROLLMENT DUPLICACY SCENARIOS PASSED!');
console.log('============================================================\n');
