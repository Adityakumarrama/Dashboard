import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

import {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  exportLimiter,
  submissionLimiter,
} from './middleware/rateLimiters.js';

// Trust reverse proxies (Vercel, Cloudflare, AWS) for accurate IP resolution in rate-limiting
app.set('trust proxy', 1);

// Prevent fingerprinting
app.disable('x-powered-by');

// ============================================================
// SECURITY HEADERS & CORS
// ============================================================

// Content Security Policy & Security Headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: [
        "'self'",
        "https://*.supabase.co",
        "wss://*.supabase.co",
        ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
        ...(process.env.VITE_SUPABASE_URL ? [process.env.VITE_SUPABASE_URL] : []),
      ],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true,
  xFrameOptions: { action: 'sameorigin' },
}));

// Restrict unused browser device capabilities
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

// Dynamic CORS whitelist
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

if (process.env.FRONTEND_URL) {
  process.env.FRONTEND_URL.split(',').forEach(url => {
    const trimmed = url.trim();
    if (trimmed) defaultAllowedOrigins.push(trimmed);
  });
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (defaultAllowedOrigins.includes(origin)) return callback(null, true);

    try {
      const parsed = new URL(origin);
      if (parsed.hostname.endsWith('.vercel.app')) {
        return callback(null, true);
      }
    } catch {}

    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    callback(new Error(`CORS blocked request from origin: ${origin}`));
  },
  credentials: true,
}));

// Rate limiting (Tiered by endpoint risk level)
app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/import/upload', uploadLimiter);
app.use('/api/export/', exportLimiter);
app.use('/api/evaluations/:id/submit', submissionLimiter);

// Disable HTTP caching for dynamic API routes so clients never see stale data
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Body parsing with safe size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure uploads directory exists safely
try {
  const uploadsDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  // Serverless environments use memory storage
}

// Normalize /api URL prefix for Vercel Serverless Function rewrites
app.use((req, res, next) => {
  if (req.url && !req.url.startsWith('/api') && !req.url.startsWith('/health')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  next();
});

// ============================================================
// API ROUTES
// ============================================================

// Import route modules
import authRoutes from './routes/auth.js';
import teamRoutes from './routes/teams.js';
import userRoutes from './routes/users.js';
import assignmentRoutes from './routes/assignments.js';
import scoringRoutes from './routes/scoring.js';
import evaluationRoutes from './routes/evaluations.js';
import importRoutes from './routes/import.js';
import auditRoutes from './routes/audit.js';
import exportRoutes from './routes/export.js';
import settingsRoutes from './routes/settings.js';
import statsRoutes from './routes/stats.js';

app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/users', userRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/scoring', scoringRoutes);
app.use('/api/evaluations', evaluationRoutes);
app.use('/api/import', importRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/stats', statsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// PRODUCTION STATIC SERVING
// ============================================================

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

// ============================================================
// ERROR HANDLING
// ============================================================

// 404 for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found', code: 'NOT_FOUND' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 10MB.', code: 'FILE_TOO_LARGE' });
  }

  if (err.isOperational) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || 'ERROR',
      ...(err.errors && { details: err.errors }),
    });
  }

  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
    code: 'INTERNAL_ERROR',
  });
});

// ============================================================
// START SERVER
// ============================================================

if (process.env.VERCEL !== '1' && !process.env.VERCEL_ENV) {
  app.listen(PORT, () => {
    console.log(`\n🚀 SIH Jury Evaluation Platform API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   API: http://localhost:${PORT}/api`);
    console.log(`   Health: http://localhost:${PORT}/api/health\n`);
  });
}

export default app;
