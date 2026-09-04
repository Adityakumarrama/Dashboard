import multer from 'multer';
import path from 'path';
import { BadRequestError } from '../utils/errors.js';

const ALLOWED_TYPES = {
  'text/csv': '.csv',
  'application/vnd.ms-excel': '.csv',
  'text/xml': '.xml',
  'application/xml': '.xml',
  'application/pdf': '.pdf',
};

const ALLOWED_EXTENSIONS = ['.csv', '.xml', '.pdf'];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new BadRequestError(`Unsupported file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  }

  // Also check MIME type (but be lenient — some systems mis-report CSV/XML MIME types)
  const mime = file.mimetype.toLowerCase();
  const isValidMime = Object.keys(ALLOWED_TYPES).includes(mime) ||
    mime === 'application/octet-stream' || // Some browsers send this for CSV/XML
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
