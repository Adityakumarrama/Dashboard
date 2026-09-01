import { query } from '../config/database.js';

/**
 * Log an auditable action
 */
export async function logAction(userId, action, entityType, entityId, details = null, ipAddress = null) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, action, entityType, entityId, details ? JSON.stringify(details) : null, ipAddress]
    );
  } catch (error) {
    // Audit logging should never break the main operation
    console.error('Audit log error:', error.message);
  }
}

/**
 * Get client IP from request
 */
export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null;
}
