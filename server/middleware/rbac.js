import { ForbiddenError } from '../utils/errors.js';

/**
 * Role-based access control middleware factory
 * @param  {...string} roles - Allowed roles
 * @returns Express middleware
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}`,
        code: 'FORBIDDEN',
      });
    }

    next();
  };
}

/**
 * Require ADMIN role
 */
export const requireAdmin = requireRole('ADMIN');

/**
 * Require JURY role
 */
export const requireJury = requireRole('JURY');

/**
 * Require either ADMIN or JURY role
 */
export const requireAny = requireRole('ADMIN', 'JURY');
