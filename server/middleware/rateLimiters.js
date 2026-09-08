import rateLimit from 'express-rate-limit';

/**
 * Standard headers for rate limit responses
 */
const defaultHeaders = {
  standardHeaders: true,
  legacyHeaders: false,
};

/**
 * General API Limiter — 500 requests per 15 minutes
 */
export const generalLimiter = rateLimit({
  ...defaultHeaders,
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: {
    error: 'Too many requests, please try again later.',
    code: 'RATE_LIMITED',
  },
});

/**
 * Strict Auth Limiter — 15 login/sync attempts per 15 minutes
 * Defends against credential stuffing and brute-force password guessing
 */
export const authLimiter = rateLimit({
  ...defaultHeaders,
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    error: 'Too many authentication attempts. Please try again after 15 minutes.',
    code: 'AUTH_RATE_LIMITED',
  },
});

/**
 * File Upload Limiter — 15 uploads per 15 minutes
 * Prevents memory buffer exhaustion and Denial-of-Service attacks
 */
export const uploadLimiter = rateLimit({
  ...defaultHeaders,
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    error: 'Upload limit reached. Please wait a few minutes before uploading more files.',
    code: 'UPLOAD_RATE_LIMITED',
  },
});

/**
 * Heavy Export Limiter — 30 CSV/data exports per 15 minutes
 * Prevents database connection exhaustion and excessive query load
 */
export const exportLimiter = rateLimit({
  ...defaultHeaders,
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    error: 'Export rate limit exceeded. Please wait a few minutes before requesting more exports.',
    code: 'EXPORT_RATE_LIMITED',
  },
});

/**
 * Score Submission Limiter — 60 submissions / score updates per 5 minutes
 * Prevents rapid automated tampering or race conditions during judging rounds
 */
export const submissionLimiter = rateLimit({
  ...defaultHeaders,
  windowMs: 5 * 60 * 1000,
  max: 60,
  message: {
    error: 'Score submission rate limit exceeded. Please wait a moment before saving again.',
    code: 'SUBMISSION_RATE_LIMITED',
  },
});
