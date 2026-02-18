/**
 * Proxy Middleware - Vite and Backend proxies
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import { VITE_PORT, BACKEND_PORT, EXPRESS_API_ENDPOINTS } from './config.js';

/**
 * Create backend proxy middleware
 */
export const backendProxy = createProxyMiddleware({
  target: `http://localhost:${BACKEND_PORT}`,
  changeOrigin: true,
  logLevel: 'debug',
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[Proxy] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[Proxy Response] ${req.method} ${req.originalUrl} -> ${proxyRes.statusCode}`);
  },
  onError: (err, req, res) => {
    console.error('Backend proxy error:', err.message);
    if (res.writeHead) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Backend not ready' }));
    }
  }
});

/**
 * Create Vite proxy middleware
 */
export const viteProxy = createProxyMiddleware({
  target: `http://localhost:${VITE_PORT}`,
  changeOrigin: true,
  ws: true, // Enable WebSocket for HMR
  logLevel: 'warn',
  onError: (err, req, res) => {
    console.error('Vite proxy error:', err.message);
    if (res.writeHead) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Vite not ready' }));
    }
  }
});

/**
 * Route /api/* requests - proxy to Python backend except Express endpoints
 */
export function apiRouter(req, res, next) {
  console.log(`[API Route] ${req.method} ${req.path}`);
  if (EXPRESS_API_ENDPOINTS.some(ep => req.path.startsWith(ep))) {
    return next();
  }
  return backendProxy(req, res, next);
}

/**
 * Route non-API requests to Vite
 */
export function viteRouter(req, res, next) {
  if (req.path.startsWith('/api/') || req.path === '/health') {
    return next();
  }
  return viteProxy(req, res, next);
}

