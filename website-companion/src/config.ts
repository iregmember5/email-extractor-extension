const baseURL = String(import.meta.env.VITE_API_URL || 'https://mypowerly.com/v1')
  .trim()
  .replace(/^["']+|["']+$/g, '')
  .replace(/\/+$/, '');
export default { baseURL };
