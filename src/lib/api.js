import supabase from './supabase';

const API_BASE = '/api';

class ApiClient {
  async getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
    return {};
  }

  async request(endpoint, options = {}, isRetry = false) {
    const headers = {
      'Content-Type': 'application/json',
      ...(await this.getAuthHeaders()),
      ...options.headers,
    };

    const config = {
      ...options,
      headers,
    };

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      config.body = JSON.stringify(options.body);
    }

    // For FormData, remove Content-Type so browser sets boundary
    if (options.body instanceof FormData) {
      delete headers['Content-Type'];
    }

    const response = await fetch(`${API_BASE}${endpoint}`, config);

    if (response.status === 401 && !isRetry && endpoint !== '/auth/sync') {
      try {
        // Try to refresh session once
        const { data, error } = await supabase.auth.refreshSession();
        if (error || !data?.session) {
          throw new Error('Session expired');
        }
        return this.request(endpoint, options, true);
      } catch {
        return this.handleResponse(response);
      }
    }

    return this.handleResponse(response);
  }

  async handleResponse(response) {
    // Handle CSV/file downloads
    const contentType = response.headers.get('content-type') || '';
    if (contentType && (contentType.includes('text/csv') || contentType.includes('application/xml'))) {
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      return { blob, filename: this.getFilename(response) };
    }

    let data;
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || `HTTP ${response.status} Error`, code: 'SERVER_ERROR' };
    }

    if (!response.ok) {
      const error = new Error(data.error || 'Request failed');
      error.code = data.code;
      error.status = response.status;
      error.details = data.details;
      throw error;
    }

    return data;
  }

  getFilename(response) {
    const disposition = response.headers.get('content-disposition');
    if (disposition) {
      const match = disposition.match(/filename="?(.+?)"?$/);
      if (match) return match[1];
    }
    return 'download';
  }

  get(endpoint, params = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, value);
      }
    }
    const qs = searchParams.toString();
    return this.request(`${endpoint}${qs ? '?' + qs : ''}`);
  }

  post(endpoint, body) {
    return this.request(endpoint, { method: 'POST', body });
  }

  put(endpoint, body) {
    return this.request(endpoint, { method: 'PUT', body });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  async upload(endpoint, file) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request(endpoint, { method: 'POST', body: formData });
  }

  async download(endpoint) {
    const { blob, filename } = await this.get(endpoint);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

const api = new ApiClient();
export default api;
