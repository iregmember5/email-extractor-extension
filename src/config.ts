export const ORIGIN = 'https://mypowerly.com';
// Production is mounted at /v1, matching the existing Powerly web app.
export const BACKEND_BASE = `${ORIGIN}/v1`;
export const API_BASE = `${BACKEND_BASE}/api/email-extractor/`;
export const AUTH_BASE = `${BACKEND_BASE}/api/auth/`;
export const VERSION = '1.0.2';
export const WEB = {
  signup: `${ORIGIN}/sign-up`,
  forgot: `${ORIGIN}/forgot-password`,
  success: `${ORIGIN}/extension/success`,
};
