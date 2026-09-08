import {
  sanitize,
  escapeHtml,
  escapeCsvCell,
  isSafeKey,
  validatePasswordStrength,
  sanitizeFileName,
  isValidUUID,
  generateTeamCode,
} from '../utils/helpers.js';
import { validateUuidParams } from '../middleware/validateUuid.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('\n🔒 RUNNING SECURITY CONTROLS TEST SUITE\n');

// 1. UUID Validation
console.log('1. Testing UUID Validation Middleware:');
assert(isValidUUID('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'), 'Valid UUID should be recognized');
assert(!isValidUUID('1234-invalid'), 'Malformed UUID string should be rejected');
assert(!isValidUUID("'; DROP TABLE teams; --"), 'SQL injection string should not be valid UUID');
assert(!isValidUUID(null), 'Null value should not be valid UUID');

const mockRes = () => {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.jsonData = data;
    return res;
  };
  return res;
};

const middleware = validateUuidParams('id', 'teamId');
let nextCalled = false;
middleware({ params: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', teamId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' } }, mockRes(), () => { nextCalled = true; });
assert(nextCalled === true, 'Middleware calls next() for valid UUID parameters');

let failRes = mockRes();
let failNext = false;
middleware({ params: { id: 'not-a-uuid' } }, failRes, () => { failNext = true; });
assert(failNext === false && failRes.statusCode === 400 && failRes.jsonData?.code === 'INVALID_UUID',
  'Middleware halts and returns 400 for invalid UUID parameter');

// 2. CSV Formula Injection Escaping (CWE-1236)
console.log('\n2. Testing CSV Formula Injection Escaping (CWE-1236):');
assert(escapeCsvCell("=CMD|' /C calc'!A0") === "'=CMD|' /C calc'!A0", 'Formula = is prepended with single quote');
assert(escapeCsvCell('+12345') === "'+12345", 'Formula + is prepended with single quote');
assert(escapeCsvCell('-SUM(A1:A10)') === "'-SUM(A1:A10)", 'Formula - is prepended with single quote');
assert(escapeCsvCell('@HYPERLINK("http://evil.com")') === "'@HYPERLINK(\"http://evil.com\")", 'Formula @ is prepended with single quote');
assert(escapeCsvCell('Team Alpha') === 'Team Alpha', 'Harmless text is not modified');
assert(escapeCsvCell(95.5) === '95.5', 'Numeric score value is not modified');

// 3. Password Strength Validation
console.log('\n3. Testing Password Strength Policy:');
assert(!validatePasswordStrength('12345').valid, 'Password < 8 characters rejected');
assert(!validatePasswordStrength('passwordonly').valid, 'Password with only letters rejected');
assert(!validatePasswordStrength('12345678').valid, 'Password with only numbers rejected');
assert(validatePasswordStrength('Admin2026!').valid, 'Strong alphanumeric password accepted');

// 4. HTML Entity Escaping & XSS Sanitization
console.log('\n4. Testing Input Sanitization & Anti-XSS:');
const rawInput = '  Hello \0 World  <script>alert("XSS")</script>  ';
const sanitized = sanitize(rawInput);
assert(!sanitized.includes('\0'), 'Null bytes stripped from input');
assert(sanitized.startsWith('Hello'), 'Input whitespace trimmed');

const escaped = escapeHtml('<script>alert("XSS")</script>');
assert(escaped === '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;', 'Dangerous HTML entities properly escaped');

// 5. Prototype Pollution Protection
console.log('\n5. Testing Prototype Pollution Protection:');
assert(!isSafeKey('__proto__'), '__proto__ key is rejected');
assert(!isSafeKey('constructor'), 'constructor key is rejected');
assert(!isSafeKey('prototype'), 'prototype key is rejected');
assert(isSafeKey('competition_name'), 'Legitimate configuration key is accepted');

// 6. Filename Sanitization & Extension Safety
console.log('\n6. Testing File Upload Sanitization & Extension Safety:');
assert(sanitizeFileName('../../etc/passwd.csv') === 'passwd.csv', 'Path traversal stripped and base file isolated');
assert(sanitizeFileName('file\0name.csv') === 'filename.csv', 'Null bytes stripped from filename');
assert(sanitizeFileName('C:\\Windows\\System32\\cmd.exe.csv') === 'cmd.exe.csv', 'Windows drive path stripped from filename');

// 7. Team Code Generation Format (SIH_<4 chars of team name>_01)
console.log('\n7. Testing Team Code Format Generation (SIH_<4_CHARS>_01):');
assert(generateTeamCode('CodeCrafters') === 'SIH_CODE_01', 'First 4 characters of team name capitalized and suffixed with _01');
assert(generateTeamCode('Cyber Warriors') === 'SIH_CYBE_01', 'Spaces ignored and first 4 characters used');
assert(generateTeamCode('AI') === 'SIH_AIXX_01', 'Names under 4 characters are padded with X');
assert(generateTeamCode('CodeCrafters', ['SIH_CODE_01']) === 'SIH_CODE_02', 'Duplicate codes increment sequence counter to _02');
assert(generateTeamCode('CodeCrafters', ['SIH_CODE_01', 'SIH_CODE_02']) === 'SIH_CODE_03', 'Sequential counter increments to _03');
assert(generateTeamCode(null) === 'SIH_TEAM_01', 'Null team name falls back to SIH_TEAM_01');

console.log(`\n============================================================`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log(`============================================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
