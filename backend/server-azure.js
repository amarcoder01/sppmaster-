import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import crypto from 'crypto';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file if present
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '.env');

if (fs.existsSync(envPath)) {
  console.log(`Loading environment variables from ${envPath}`);
  const envConfig = fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .reduce((acc, line) => {
      const [key, value] = line.split('=');
      if (key && value) {
        acc[key.trim()] = value.trim();
        if (!key.includes('SECRET') && !key.includes('KEY')) {
          process.env[key.trim()] = value.trim();
        }
      }
      return acc;
    }, {});
  
  console.log(`Loaded ${Object.keys(envConfig).length} environment variables`);
}

// Port configuration
const PORT = process.env.PORT || 3000;
console.log(`Server will run on port ${PORT}`);

// Track server performance metrics
const serverStats = {
  startTime: Date.now(),
  requestCount: 0,
  errors: 0,
  pingRequests: 0,
  downloadRequests: 0,
  uploadRequests: 0,
  lastMinuteRequests: []
};

// Update request count for rate calculation
function updateRequestStats(endpoint) {
  const now = Date.now();
  serverStats.requestCount++;
  
  // Track endpoint-specific metrics
  if (endpoint === 'ping') serverStats.pingRequests++;
  if (endpoint === 'download') serverStats.downloadRequests++;
  if (endpoint === 'upload') serverStats.uploadRequests++;
  
  // Add to rolling window of requests (last minute)
  serverStats.lastMinuteRequests.push(now);
  
  // Remove requests older than 1 minute
  const oneMinuteAgo = now - 60000;
  serverStats.lastMinuteRequests = serverStats.lastMinuteRequests.filter(time => time > oneMinuteAgo);
}

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://*.azurestaticapps.net', 'https://*.azurewebsites.net']
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000) / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  const uptime = Date.now() - serverStats.startTime;
  const requestsPerMinute = serverStats.lastMinuteRequests.length;
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime / 1000),
    requestsPerMinute,
    totalRequests: serverStats.requestCount,
    errors: serverStats.errors,
    memory: process.memoryUsage(),
    version: '2.0.0'
  });
});

// Ping endpoint for latency testing
app.get('/api/ping', (req, res) => {
  updateRequestStats('ping');
  
  const clientTimestamp = parseInt(req.query.timestamp) || Date.now();
  const serverTimestamp = Date.now();
  
  res.json({
    timestamp: serverTimestamp,
    clientTimestamp,
    serverProcessingTime: serverTimestamp - clientTimestamp
  });
});

// Download test endpoint
app.get('/api/download', (req, res) => {
  updateRequestStats('download');
  
  const size = parseInt(req.query.size) || 1024 * 1024; // Default 1MB
  const chunkSize = parseInt(req.query.chunkSize) || 64 * 1024; // Default 64KB
  
  // Limit maximum size to 100MB
  const safeSize = Math.min(size, 100 * 1024 * 1024);
  
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', safeSize);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  let bytesSent = 0;
  
  function sendChunk() {
    if (bytesSent >= safeSize) {
      res.end();
      return;
    }
    
    const remainingBytes = safeSize - bytesSent;
    const currentChunkSize = Math.min(chunkSize, remainingBytes);
    
    const chunk = crypto.randomBytes(currentChunkSize);
    res.write(chunk);
    
    bytesSent += currentChunkSize;
    
    // Use setImmediate for better performance
    setImmediate(sendChunk);
  }
  
  sendChunk();
});

// Upload test endpoint
app.post('/api/upload', (req, res) => {
  updateRequestStats('upload');
  
  const startTime = Date.now();
  const data = req.body;
  
  if (!data || !data.content) {
    return res.status(400).json({ error: 'No content provided' });
  }
  
  const contentLength = JSON.stringify(data.content).length;
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  res.json({
    received: contentLength,
    duration: duration,
    throughput: (contentLength / duration * 1000).toFixed(2) + ' bytes/sec'
  });
});

// Status endpoint
app.get('/api/status', (req, res) => {
  const uptime = Date.now() - serverStats.startTime;
  const requestsPerMinute = serverStats.lastMinuteRequests.length;
  
  res.json({
    status: 'running',
    uptime: Math.floor(uptime / 1000),
    requestsPerMinute,
    totalRequests: serverStats.requestCount,
    errors: serverStats.errors,
    pingRequests: serverStats.pingRequests,
    downloadRequests: serverStats.downloadRequests,
    uploadRequests: serverStats.uploadRequests,
    memory: process.memoryUsage(),
    version: '2.0.0'
  });
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket server for real-time speed tests
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected');
  
  const clientInfo = {
    id: Date.now(),
    ip: req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    connectedAt: Date.now(),
    testPhase: null,
    bytesTransferred: 0,
    testStartTime: null
  };
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'ping':
          handlePingTest(ws, data, clientInfo);
          break;
        case 'download':
          handleDownloadTest(ws, data, clientInfo);
          break;
        case 'upload':
          handleUploadTest(ws, data, clientInfo);
          break;
        default:
          ws.send(JSON.stringify({ error: 'Unknown message type' }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    serverStats.errors++;
  });
});

// WebSocket ping test handler
function handlePingTest(ws, data, clientInfo) {
  const clientTimestamp = data.timestamp || Date.now();
  const serverTimestamp = Date.now();
  
  ws.send(JSON.stringify({
    type: 'pong',
    timestamp: serverTimestamp,
    clientTimestamp,
    serverProcessingTime: serverTimestamp - clientTimestamp
  }));
}

// WebSocket download test handler
function handleDownloadTest(ws, data, clientInfo) {
  const size = data.size || 1024 * 1024;
  const chunkSize = data.chunkSize || 64 * 1024;
  
  const safeSize = Math.min(size, 100 * 1024 * 1024);
  
  clientInfo.testPhase = 'download';
  clientInfo.bytesTransferred = 0;
  clientInfo.testStartTime = Date.now();
  
  const chunkBuffer = crypto.randomBytes(chunkSize);
  
  ws.send(JSON.stringify({
    type: 'download_started',
    timestamp: Date.now(),
    totalBytes: safeSize
  }));
  
  let bytesSent = 0;
  
  function sendNextChunk() {
    if (bytesSent >= safeSize) {
      const endTime = Date.now();
      const duration = (endTime - clientInfo.testStartTime) / 1000;
      const throughputMBps = (safeSize / (1024 * 1024)) / duration;
      
      ws.send(JSON.stringify({
        type: 'download_complete',
        timestamp: endTime,
        bytesSent: safeSize,
        duration: duration.toFixed(3),
        throughputMBps: throughputMBps.toFixed(2)
      }));
      
      return;
    }
    
    const remainingBytes = safeSize - bytesSent;
    const currentChunkSize = Math.min(chunkSize, remainingBytes);
    const chunk = chunkBuffer.subarray(0, currentChunkSize);
    
    ws.send(chunk, { binary: true }, (err) => {
      if (err) {
        console.error('Error sending WebSocket data:', err);
        return;
      }
      
      bytesSent += currentChunkSize;
      clientInfo.bytesTransferred = bytesSent;
      
      if (bytesSent % (1024 * 1024) === 0 || bytesSent === safeSize) {
        ws.send(JSON.stringify({
          type: 'download_progress',
          timestamp: Date.now(),
          bytesSent,
          totalBytes: safeSize,
          progress: (bytesSent / safeSize * 100).toFixed(1)
        }));
      }
      
      if (bytesSent < safeSize) {
        process.nextTick(sendNextChunk);
      }
    });
  }
  
  sendNextChunk();
}

// WebSocket upload test handler
function handleUploadTest(ws, data, clientInfo) {
  const startTime = Date.now();
  const content = data.content;
  
  if (!content) {
    ws.send(JSON.stringify({ error: 'No content provided' }));
    return;
  }
  
  const contentLength = JSON.stringify(content).length;
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  ws.send(JSON.stringify({
    type: 'upload_complete',
    timestamp: endTime,
    received: contentLength,
    duration: duration,
    throughput: (contentLength / duration * 1000).toFixed(2) + ' bytes/sec'
  }));
}

// Start the server
server.listen(PORT, () => {
  console.log(`Speed test backend server running on port ${PORT}`);
  console.log(`WebSocket server is also running on the same port`);
});

// Optimize TCP settings for high throughput
server.keepAliveTimeout = 60000;
server.headersTimeout = 65000;
