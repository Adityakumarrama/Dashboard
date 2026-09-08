import { isValidUUID } from '../utils/helpers.js';

/**
 * Middleware factory to validate that specified route parameters are valid UUIDs.
 * If any parameter is invalid, returns HTTP 400 Bad Request immediately.
 *
 * @param  {...string} paramNames - Names of req.params to validate as UUIDs (e.g. 'id', 'teamId')
 */
export function validateUuidParams(...paramNames) {
  return (req, res, next) => {
    for (const param of paramNames) {
      const val = req.params[param];
      if (val && !isValidUUID(val)) {
        return res.status(400).json({
          error: `Invalid ${param} identifier format. Must be a valid UUID.`,
          code: 'INVALID_UUID',
          param,
        });
      }
    }
    next();
  };
}

export default validateUuidParams;
