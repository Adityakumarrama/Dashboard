/**
 * Format a date string for display
 */
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Debounce function
 */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Capitalize first letter
 */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Get status badge class
 */
export function getStatusClass(status) {
  const map = {
    active: 'badge-success',
    inactive: 'badge-error',
    submitted: 'badge-success',
    draft: 'badge-warning',
    reopened: 'badge-info',
    pending: 'badge-warning',
    completed: 'badge-success',
    not_started: 'badge-muted',
    registered: 'badge-info',
    confirmed: 'badge-success',
    withdrawn: 'badge-error',
    processing: 'badge-warning',
    failed: 'badge-error',
  };
  return map[status] || 'badge-muted';
}

/**
 * Format a score display
 */
export function formatScore(score, maxScore) {
  if (score === null || score === undefined) return '—';
  return `${parseFloat(score).toFixed(1)} / ${maxScore}`;
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Truncate text
 */
export function truncate(str, maxLen = 50) {
  if (!str || str.length <= maxLen) return str || '';
  return str.substring(0, maxLen) + '…';
}

/**
 * Format file size
 */
export function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}
