/**
 * Server configuration for speed test endpoints
 */

interface ServerConfig {
  baseUrl: string;
  wsUrl: string;
  endpoints: {
    download: string;
    upload: string;
    ping: string;
    status: string;
    health: string;
    websocket: string;
  };
}

// Determine base URL based on environment (works in window and worker contexts)
const getBaseUrl = (): string => {
  // Explicit override takes precedence
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  // Helper to get current origin in any runtime
  const getOrigin = () => {
    // Browser window
    if (typeof window !== 'undefined' && window.location) {
      return window.location.origin;
    }
    // Web Worker
    if (typeof self !== 'undefined' && (self as any).location) {
      return (self as any).location.origin as string;
    }
    // Fallback
    return '';
  };

  if (import.meta.env.PROD) {
    const host = (typeof window !== 'undefined' ? window.location.hostname : (typeof self !== 'undefined' && (self as any).location ? (self as any).location.hostname : '')) as string;
    // When co-hosted (Render Docker), prefer relative URLs
    if (host && host.includes('onrender.com')) {
      return '';
    }
    // Cloudflare Pages or other static hosts: use current origin if available
    const origin = getOrigin();
    return origin || '';
  }

  // Development
  return 'http://localhost:3000';
};

// Determine WebSocket URL based on environment (works in window and worker contexts)
const getWebSocketUrl = (): string => {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  const baseUrl = getBaseUrl();

  const getOrigin = () => {
    if (typeof window !== 'undefined' && window.location) return window.location.origin;
    if (typeof self !== 'undefined' && (self as any).location) return (self as any).location.origin as string;
    return '';
  };

  if (import.meta.env.PROD) {
    const host = (typeof window !== 'undefined' ? window.location.hostname : (typeof self !== 'undefined' && (self as any).location ? (self as any).location.hostname : '')) as string;
    // Co-hosted (Render): same origin
    if ((host && host.includes('onrender.com')) || baseUrl === '') {
      const origin = getOrigin();
      return origin.replace('https://', 'wss://').replace('http://', 'ws://');
    }
    // Cloudflare Pages: route to functions
    return baseUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/functions/websocket';
  }

  // Development
  return 'ws://localhost:3000';
};

const serverConfig: ServerConfig = {
  baseUrl: getBaseUrl(),
  wsUrl: getWebSocketUrl(),
  endpoints: {
    download: '/download',
    upload: '/upload',
    ping: '/ping',
    status: '/status',
    health: '/health',
    websocket: '/websocket'
  }
};

export default serverConfig;