/**
 * Build a paginated query string and params
 */
export function buildPaginationQuery(page = 1, limit = 25) {
  const safePage = Math.max(1, parseInt(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 25));
  const offset = (safePage - 1) * safeLimit;
  return { limit: safeLimit, offset, page: safePage };
}

/**
 * Build pagination response metadata
 */
export function paginationMeta(totalCount, page, limit) {
  const totalPages = Math.ceil(totalCount / limit);
  return {
    total: totalCount,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Sanitize string input - trim and collapse whitespace, strip control chars and null bytes
 */
export function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove control chars
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Escape dangerous HTML characters to prevent XSS
 */
export function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  const htmlEntities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return str.replace(/[&<>"'/]/g, match => htmlEntities[match] || match);
}

/**
 * Defend against CSV Formula Injection (CWE-1236)
 * If a cell begins with =, +, -, @, tab, or carriage return, prepend a single quote
 */
export function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  const trimmed = str.trimStart();
  if (trimmed.length > 0 && ['=', '+', '-', '@', '\t', '\r', '%'].includes(trimmed[0])) {
    return `'${str}`;
  }
  return str;
}

/**
 * Check if an object property key is safe from prototype pollution
 */
export function isSafeKey(key) {
  if (typeof key !== 'string') return false;
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  return !dangerous.includes(key.toLowerCase().trim());
}

/**
 * Validate strong password:
 * - At least 8 characters
 * - At least one letter
 * - At least one digit
 */
export function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (!/[A-Za-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  return { valid: true };
}

/**
 * Sanitize filename to prevent directory traversal and null byte injections
 */
export function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') return 'upload';
  const clean = name.replace(/\0/g, '');
  const base = clean.split(/[/\\]/).filter(Boolean).pop() || 'upload';
  return base
    .replace(/^\.+/, '') // remove leading dots
    .replace(/[^a-zA-Z0-9._-]/g, '_') // allow only safe chars
    || 'upload';
}

/**
 * Generate a simple unique ID suffix
 */
export function generateId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}-${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Format a date for display
 */
export function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toISOString();
}

/**
 * Pick allowed fields from an object
 */
export function pick(obj, fields) {
  const result = {};
  for (const field of fields) {
    if (obj[field] !== undefined) {
      result[field] = obj[field];
    }
  }
  return result;
}

/**
 * Check if a value is a valid UUID
 */
export function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str.trim());
}

/**
 * Extract the highest numerical suffix from existing team codes
 * to continue the serial number sequence seamlessly
 */
export function getNextTeamSequence(existingCodes = []) {
  let maxSeq = 0;
  const list = Array.isArray(existingCodes) ? existingCodes : Array.from(existingCodes || []);
  for (const code of list) {
    if (!code) continue;
    const match = String(code).trim().match(/(?:_|-)(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  return Math.max(maxSeq + 1, list.length + 1);
}

/**
 * Generate a standardized team code in format: SIH_<TEAM_NAME_FIRST_4_CHARS>_<SR_NUMBER>
 * E.g., Team 1 ("BioByte") -> "SIH_BIOB_01"
 *       Team 2 ("SolveSphere") -> "SIH_SOLV_02"
 *       Team 10 ("THE GLADIATORS") -> "SIH_THEG_10"
 */
export function generateTeamCode(teamName, sequenceOrExisting = 1) {
  if (!teamName || typeof teamName !== 'string') {
    teamName = 'TEAM';
  }
  const clean = teamName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const namePart = (clean.slice(0, 4) || 'TEAM').padEnd(4, 'X');
  const prefix = `SIH_${namePart}_`;

  let seq = 1;
  if (typeof sequenceOrExisting === 'number') {
    seq = sequenceOrExisting;
  } else if (Array.isArray(sequenceOrExisting) || sequenceOrExisting instanceof Set) {
    seq = getNextTeamSequence(sequenceOrExisting);
  }

  const numStr = String(seq).padStart(2, '0');
  return `${prefix}${numStr}`;
}
