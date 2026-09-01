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
 * Sanitize string input - trim and collapse whitespace
 */
export function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().replace(/\s+/g, ' ');
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
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}
