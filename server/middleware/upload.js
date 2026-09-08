import multer from 'multer';
import path from 'path';
import { BadRequestError } from '../utils/errors.js';
import { sanitizeFileName } from '../utils/helpers.js';

const ALLOWED_TYPES = {
  'text/csv': '.csv',
  'text/tab-separated-values': '.tsv',
  'text/plain': '.txt',
  'application/vnd.ms-excel': '.csv',
  'text/xml': '.xml',
  'application/xml': '.xml',
  'application/pdf': '.pdf',
};

const ALLOWED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xml', '.pdf'];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.memoryStorage();

const BLOCKED_INTERMEDIATE_EXTENSIONS = [
  '.php', '.phtml', '.php3', '.php4', '.php5', '.phps',
  '.exe', '.dll', '.so', '.sh', '.bash', '.bat', '.cmd', '.vbs',
  '.js', '.mjs', '.cjs', '.ts', '.py', '.rb', '.pl', '.cgi',
  '.jsp', '.asp', '.aspx', '.jar', '.war',
];

function fileFilter(req, file, cb) {
  // Sanitize originalname against null bytes and path traversals
  file.originalname = sanitizeFileName(file.originalname);
  const lowerName = file.originalname.toLowerCase();

  // Check for dangerous intermediate extensions (e.g., payload.php.csv)
  const parts = lowerName.split('.');
  if (parts.length > 2) {
    for (let i = 1; i < parts.length - 1; i++) {
      if (BLOCKED_INTERMEDIATE_EXTENSIONS.includes(`.${parts[i]}`)) {
        return cb(new BadRequestError(`Prohibited intermediate extension detected: .${parts[i]}`), false);
      }
    }
  }

  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new BadRequestError(`Unsupported file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  }

  // Check MIME type
  const mime = file.mimetype.toLowerCase();
  const isValidMime = Object.keys(ALLOWED_TYPES).includes(mime) ||
    mime === 'application/octet-stream' ||
    mime.includes('text') ||
    mime.includes('csv') ||
    mime.includes('xml');

  if (!isValidMime) {
    return cb(new BadRequestError(`Invalid MIME type: ${mime}`), false);
  }

  cb(null, true);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

export default upload;
