import { query } from '../config/database.js';
import supabaseAdmin from '../config/supabase.js';

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
  } catch (pgError) {
    // Fallback to Supabase REST
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        details: details || null,
        ip_address: ipAddress,
      });
    } catch (supaErr) {
      // Audit logging should never break the main operation
      console.error('Audit log error (both PG and REST failed):', pgError.message, supaErr.message);
    }
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
