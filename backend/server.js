import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import crypto from 'crypto';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cluster from 'cluster';
import os from 'os';
import helmet from 'helmet';
import v8 from 'v8';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';

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
        // Don't set process.env for sensitive values to avoid logging them
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

// Determine if cluster mode should be enabled
const ENABLE_CLUSTER = process.env.ENABLE_CLUSTER === 'true';

// Track server performance metrics
const serverStats = {
  startTime: Date.now(),
  requestCount: 0,
  errors: 0,
  pingRequests: 0,
  downloadRequests: 0,
  uploadRequests: 0,
  lastMinuteRequests: [],
  workers: {}
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
  
  // Update worker stats if in cluster mode
  if (cluster.isWorker) {
    process.send({ cmd: 'STATS_UPDATE', workerId: cluster.worker.id });
  }
}

// Number of CPU cores to use (use all available cores for maximum performance)
const numCPUs = os.cpus().length;

// Implement clustering for better performance
if (cluster.isPrimary && ENABLE_CLUSTER) {
  console.log(`Master process ${process.pid} is running`);
  console.log(`Starting ${numCPUs} workers...`);
  
  // Initialize master stats tracking
  const masterStats = {
    startTime: Date.now(),
    totalRequests: 0,
    errors: 0,
    workers: {}
  };
  
  // Fork workers based on CPU count
  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork();
    masterStats.workers[worker.id] = {
      id: worker.id,
      pid: worker.process.pid,
      startTime: Date.now(),
      requests: 0,
      errors: 0,
      lastUpdate: Date.now()
    };
  }
  
  // Handle messages from workers
  cluster.on('message', (worker, message) => {
    if (message.cmd === 'STATS_UPDATE') {
      if (masterStats.workers[worker.id]) {
        masterStats.workers[worker.id].requests++;
        masterStats.workers[worker.id].lastUpdate = Date.now();
        masterStats.totalRequests++;
      }
    } else if (message.cmd === 'ERROR') {
      if (masterStats.workers[worker.id]) {
        masterStats.workers[worker.id].errors++;
        masterStats.errors++;
      }
    }
  });
  
  // Handle worker exit and restart
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    
    // Remove old worker stats
    delete masterStats.workers[worker.id];
    
    // Fork a new worker
    const newWorker = cluster.fork();
    
    // Initialize new worker stats
    masterStats.workers[newWorker.id] = {
      id: newWorker.id,
      pid: newWorker.process.pid,
      startTime: Date.now(),
      requests: 0,
      errors: 0,
      lastUpdate: Date.now()
    };
  });
  
  // Log stats periodically
  setInterval(() => {
    const uptime = (Date.now() - masterStats.startTime) / 1000;
    const activeWorkers = Object.keys(masterStats.workers).length;
    const requestsPerSecond = masterStats.totalRequests / uptime;
    
    console.log(`[Master] Uptime: ${uptime.toFixed(0)}s | Workers: ${activeWorkers}/${numCPUs} | ` +
                `Total Requests: ${masterStats.totalRequests} | ` +
                `Req/s: ${requestsPerSecond.toFixed(2)} | ` +
                `Errors: ${masterStats.errors}`);
  }, 60000); // Log every minute
} else {
  // Worker process - actual server code
  const app = express();
  
  // Configure trust proxy for Render deployment
  app.set('trust proxy', 1); // Trust first proxy (Render's load balancer)
  
  // Performance optimization: increase default socket timeout
  const keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT) || 65000; // Default: 65 seconds
  const headersTimeout = parseInt(process.env.HEADERS_TIMEOUT) || 66000; // Default: 66 seconds
  
  app.set('keepAliveTimeout', keepAliveTimeout);
  app.set('headersTimeout', headersTimeout);
  
  console.log(`Performance settings: keepAliveTimeout=${keepAliveTimeout}ms, headersTimeout=${headersTimeout}ms`);
  
  // Apply rate limiting to prevent abuse
  const rateLimitConfig = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // Default: 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500, // Default: 500 requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, please try again later.',
    // Disable validation checks that cause issues in proxy environments
    validate: {
      xForwardedForHeader: false,
      trustProxy: false
    }
  };
  
  const apiLimiter = rateLimit(rateLimitConfig);
  
  console.log(`Rate limiting: ${rateLimitConfig.max} requests per ${rateLimitConfig.windowMs/1000}s`);
  
  // Middleware
  app.use(helmet()); // Security headers
  app.use(compression()); // Compress responses
  app.use(cors());
  // Set up logging
  const logsDir = path.join(__dirname, 'logs');
  
  // Create logs directory if it doesn't exist
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Configure logging based on environment
  if (process.env.NODE_ENV === 'production') {
    // In production, log to file
    const accessLogStream = createWriteStream(
      path.join(logsDir, 'access.log'), 
      { flags: 'a' }
    );
    
    app.use(morgan('combined', {
      stream: accessLogStream,
      // Skip logging for high-volume endpoints to reduce overhead
      skip: (req) => req.url.includes('/download') || req.url.includes('/upload')
    }));
    
    console.log(`Logging to ${path.join(logsDir, 'access.log')}`);
  } else {
    // In development, log to console
    app.use(morgan('dev', {
      // Skip logging for high-volume endpoints to reduce overhead
      skip: (req) => req.url.includes('/download') || req.url.includes('/upload')
    }));
  }
  app.use(express.json({ limit: '50mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));
  
  // Set cache prevention headers for all responses
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
  });

  // Serve static frontend files
  const publicPath = path.join(__dirname, 'public');
  const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
  
  // Check for frontend build files in multiple possible locations
  let staticPath = null;
  if (fs.existsSync(publicPath)) {
    staticPath = publicPath;
    console.log(`Serving static files from: ${publicPath}`);
  } else if (fs.existsSync(frontendDistPath)) {
    staticPath = frontendDistPath;
    console.log(`Serving static files from: ${frontendDistPath}`);
  } else {
    console.log('No frontend build files found. API-only mode.');
  }
  
  if (staticPath) {
    app.use(express.static(staticPath, {
      maxAge: '1h',
      etag: true,
      lastModified: true
    }));
    
    // Handle SPA routing - serve index.html for all non-API routes
    app.get('*', (req, res, next) => {
      // Skip API routes
      if (req.path.startsWith('/ping') || 
          req.path.startsWith('/download') || 
          req.path.startsWith('/upload') || 
          req.path.startsWith('/status') || 
          req.path.startsWith('/health') ||
          req.path.startsWith('/websocket')) {
        return next();
      }
      
      // Serve index.html for all other routes (SPA routing)
      const indexPath = path.join(staticPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).json({ error: 'Frontend not found', message: 'This is a backend API server. Frontend files are not available.' });
      }
    });
  } else {
    // If no frontend files, provide a basic response for root path
    app.get('/', (req, res) => {
      res.json({
        message: 'Speed Test API Server',
        status: 'running',
        endpoints: {
          ping: '/ping',
          download: '/download',
          upload: '/upload',
          status: '/status',
          health: '/health'
        },
        note: 'This is a backend API server. Frontend files are served separately.'
      });
    });
  }
  
  // Apply rate limiting to all routes except download/upload
  app.use((req, res, next) => {
    if (!req.path.includes('/download') && !req.path.includes('/upload')) {
      return apiLimiter(req, res, next);
    }
    next();
  });
  
  // Log worker stats periodically
  setInterval(() => {
    const requestsPerSecond = serverStats.lastMinuteRequests.length / 60;
    console.log(`[Worker ${cluster.worker.id}] Requests: ${serverStats.requestCount} | ` +
                `Req/s: ${requestsPerSecond.toFixed(2)} | ` +
                `Errors: ${serverStats.errors}`);
  }, 300000); // Log every 5 minutes to avoid log spam

// Ping endpoint - optimized for high-speed traffic and accurate latency measurement
app.get('/ping', (req, res) => {
  // Track request for metrics
  updateRequestStats('ping');
  
  // Use high-resolution timer for more accurate measurements
  const startTime = process.hrtime();
  
  // Get the request timestamp from the query parameter if available
  const requestTimestamp = req.query.timestamp ? parseInt(req.query.timestamp) : null;
  const serverTimestamp = Date.now();
  
  // Process any additional query parameters
  const includeLoad = req.query.includeLoad === 'true';
  
  // Prepare response data
  const responseData = {
    status: 'ok',
    message: 'pong',
    serverTimestamp,
    requestTimestamp,
    // If client sent a timestamp, calculate the server processing time
    serverProcessingTime: requestTimestamp ? serverTimestamp - requestTimestamp : null
  };
  
  // Add server load information if requested
  if (includeLoad) {
    responseData.serverLoad = {
      cpuCount: os.cpus().length,
      freeMemory: os.freemem(),
      totalMemory: os.totalmem(),
      memoryUsage: process.memoryUsage(),
      uptime: os.uptime(),
      processUptime: process.uptime(),
      requestsPerSecond: (serverStats.lastMinuteRequests.length / 60).toFixed(2)
    };
  }
  
  // Calculate precise processing time
  const endTime = process.hrtime(startTime);
  const processingTimeNs = endTime[0] * 1e9 + endTime[1];
  responseData.preciseProcessingTimeMs = processingTimeNs / 1e6;
  
  // Send response with minimal overhead
  res.status(200).json(responseData);
});

// HEAD method for ping endpoint - optimized for minimal latency
app.head('/ping', (req, res) => {
  // Track request for metrics (lightweight)
  updateRequestStats('ping');
  
  // Add timestamp header for client-side latency calculation
  res.setHeader('X-Server-Timestamp', Date.now().toString());
  res.status(200).end();
});

// Fast ping endpoint - absolute minimal processing for most accurate latency tests
app.get('/fastping', (req, res) => {
  // Track request for metrics (ultra lightweight)
  updateRequestStats('ping');
  
  res.setHeader('X-Server-Timestamp', Date.now().toString());
  res.setHeader('Content-Type', 'text/plain');
  res.send('pong');
});

// Download endpoint - generates random data on the fly with optimized streaming
// Highly optimized for millions of concurrent requests
app.get('/download', (req, res) => {
  // Track request for metrics
  updateRequestStats('download');
  
  // Get requested size (default to 1MB if not specified)
  const size = parseInt(req.query.bytes) || 1024 * 1024;
  
  // Limit maximum size to 500MB for high-speed testing
  const safeSize = Math.min(size, 500 * 1024 * 1024);
  
  // Set appropriate headers for optimal streaming
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="speedtest.bin"');
  res.setHeader('Transfer-Encoding', 'chunked'); // Use chunked encoding for better streaming
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Add performance tracking headers
  res.setHeader('X-Download-Start-Time', Date.now().toString());
  res.setHeader('X-Download-Size-Bytes', safeSize.toString());
  
  // Optimize chunk size based on requested data size
  // Use larger chunks for larger requests to improve throughput
  let CHUNK_SIZE = 1024 * 1024; // Default 1MB chunks
  if (safeSize > 50 * 1024 * 1024) {
    CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks for large requests
  } else if (safeSize > 10 * 1024 * 1024) {
    CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks for medium requests
  }
  
  let bytesWritten = 0;
  let chunkBuffer = null; // Reuse buffer for better performance
  
  // Pre-generate a reusable random buffer for better performance
  // This significantly reduces CPU usage during high-speed transfers
  const generateReusableBuffer = () => {
    if (!chunkBuffer) {
      chunkBuffer = crypto.randomBytes(CHUNK_SIZE);
    }
    return chunkBuffer;
  };
  
  // Track performance metrics
  const startTime = process.hrtime();
  
  // Handle client disconnect
  req.on('close', () => {
    if (bytesWritten < safeSize) {
      const endTime = process.hrtime(startTime);
      const duration = endTime[0] + endTime[1] / 1e9;
      const throughput = (bytesWritten / (1024 * 1024)) / duration;
      
      console.log(`Download aborted: ${(bytesWritten / (1024 * 1024)).toFixed(2)}MB of ${(safeSize / (1024 * 1024)).toFixed(2)}MB in ${duration.toFixed(2)}s (${throughput.toFixed(2)}MB/s)`);
    }
  });
  
  function writeNextChunk() {
    if (bytesWritten >= safeSize) {
      const endTime = process.hrtime(startTime);
      const duration = endTime[0] + endTime[1] / 1e9;
      const throughput = (safeSize / (1024 * 1024)) / duration;
      
      // Add performance tracking headers if not sent yet
      if (!res.headersSent) {
        res.setHeader('X-Download-Duration', duration.toString());
        res.setHeader('X-Download-Throughput-MBps', throughput.toString());
      }
      
      console.log(`Download complete: ${(safeSize / (1024 * 1024)).toFixed(2)}MB in ${duration.toFixed(2)}s (${throughput.toFixed(2)}MB/s)`);
      return res.end();
    }
    
    const remainingBytes = safeSize - bytesWritten;
    const currentChunkSize = Math.min(CHUNK_SIZE, remainingBytes);
    
    // Use pre-generated buffer for better performance
    const chunk = generateReusableBuffer().subarray(0, currentChunkSize);
    
    // Write chunk to response
    const canContinue = res.write(chunk);
    bytesWritten += currentChunkSize;
    
    // If buffer is full, wait for drain event
    if (!canContinue && bytesWritten < safeSize) {
      res.once('drain', writeNextChunk);
    } else if (bytesWritten < safeSize) {
      // Use process.nextTick for better performance than setImmediate
      process.nextTick(writeNextChunk);
    } else {
      res.end();
    }
  }
  
  // Start sending data
  writeNextChunk();
});

// Upload endpoint - optimized for high-speed traffic with streaming processing
// Highly optimized for millions of concurrent requests
app.post('/upload', (req, res) => {
  // Track request for metrics
  updateRequestStats('upload');
  
  // Track performance metrics
  const startTime = process.hrtime();
  let totalBytes = 0;
  
  // Set headers for better client performance
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Upload-Start-Time', Date.now().toString());
  
  // For high-speed uploads, we need to efficiently process the incoming stream
  // rather than waiting for the entire payload to be buffered
  if (req.headers['content-type'] === 'application/octet-stream') {
    // Stream processing for raw binary data
    req.on('data', (chunk) => {
      // Count bytes as they arrive without storing them
      totalBytes += chunk.length;
    });
    
    req.on('end', () => {
      const endTime = process.hrtime(startTime);
      const duration = endTime[0] + endTime[1] / 1e9;
      const throughputMBps = (totalBytes / (1024 * 1024)) / duration;
      const throughputMbps = throughputMBps * 8; // Convert to Mbps
      
      console.log(`Upload complete: ${(totalBytes / (1024 * 1024)).toFixed(2)}MB in ${duration.toFixed(2)}s (${throughputMBps.toFixed(2)}MB/s)`);
      
      res.status(200).json({
        status: 'success',
        receivedAt: Date.now(),
        byteLength: totalBytes,
        duration: duration.toFixed(3),
        throughputMBps: throughputMBps.toFixed(2),
        throughputMbps: throughputMbps.toFixed(2)
      });
    });
    
    req.on('error', (err) => {
      serverStats.errors++;
      console.error('Upload error:', err);
      res.status(500).json({
        status: 'error',
        message: 'Upload failed',
        error: err.message
      });
    });
    
    // Handle client disconnect
    req.on('close', () => {
      if (!res.headersSent) {
        const endTime = process.hrtime(startTime);
        const duration = endTime[0] + endTime[1] / 1e9;
        console.log(`Upload aborted: ${(totalBytes / (1024 * 1024)).toFixed(2)}MB in ${duration.toFixed(2)}s`);
      }
    });
  } else {
    // For JSON or other content types, the body is already parsed by middleware
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const endTime = process.hrtime(startTime);
    const duration = endTime[0] + endTime[1] / 1e9;
    
    res.status(200).json({
      status: 'success',
      receivedAt: Date.now(),
      byteLength: contentLength,
      duration: duration.toFixed(3)
    });
  }
});

// Status endpoint - returns detailed server performance metrics
app.get('/status', (req, res) => {
  // Calculate requests per second based on the last minute
  const requestsPerSecond = serverStats.lastMinuteRequests.length / 60;
  
  // Get system information
  const systemInfo = {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    loadAvg: os.loadavg(),
    uptime: os.uptime()
  };
  
  // Get process information
  const processInfo = {
    pid: process.pid,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    resourceUsage: process.resourceUsage ? process.resourceUsage() : null,
    v8HeapStats: v8.getHeapStatistics(),
    v8HeapSpaceStats: v8.getHeapSpaceStatistics()
  };
  
  // Get cluster information if running in cluster mode
  const clusterInfo = {
    isMaster: cluster.isMaster,
    isWorker: cluster.isWorker,
    workerId: cluster.isWorker ? cluster.worker.id : null,
    workers: Object.keys(serverStats.workers).length
  };
  
  // Compile complete status response
  const statusResponse = {
    status: 'ok',
    timestamp: Date.now(),
    serverUptime: (Date.now() - serverStats.startTime) / 1000,
    metrics: {
      totalRequests: serverStats.requestCount,
      errors: serverStats.errors,
      requestsLastMinute: serverStats.lastMinuteRequests.length,
      requestsPerSecond: requestsPerSecond.toFixed(2),
      endpointStats: {
        ping: serverStats.pingRequests,
        download: serverStats.downloadRequests,
        upload: serverStats.uploadRequests
      }
    },
    system: systemInfo,
    process: processInfo,
    cluster: clusterInfo
  };
  
  // Update request stats
  updateRequestStats('status');
  
  res.status(200).json(statusResponse);
});

// Simple status endpoint - lightweight version for health checks
app.get('/health', (req, res) => {
  updateRequestStats('health');
  res.status(200).json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    requestsPerSecond: (serverStats.lastMinuteRequests.length / 60).toFixed(2)
  });
});

// Create HTTP server instance
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Track active WebSocket connections
const activeConnections = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = crypto.randomUUID();
  const clientIp = req.socket.remoteAddress;
  
  console.log(`WebSocket client connected: ${clientId} from ${clientIp}`);
  
  // Store connection with metadata
  activeConnections.set(ws, {
    id: clientId,
    ip: clientIp,
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    testPhase: null,
    bytesTransferred: 0
  });
  
  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    timestamp: Date.now(),
    message: 'WebSocket connection established'
  }));
  
  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const clientInfo = activeConnections.get(ws);
      if (!clientInfo) return;
      
      // Update last activity timestamp
      clientInfo.lastActivity = Date.now();
      
      // Parse message
      const data = JSON.parse(message.toString());
      
      // Handle different message types
      switch (data.type) {
        case 'ping':
          // Handle ping request (latency test)
          handlePing(ws, data);
          break;
          
        case 'download_start':
          // Start download test
          handleDownloadTest(ws, data, clientInfo);
          break;
          
        case 'upload_start':
          // Start upload test
          clientInfo.testPhase = 'upload';
          clientInfo.bytesTransferred = 0;
          clientInfo.testStartTime = Date.now();
          
          // Send confirmation to start sending data
          ws.send(JSON.stringify({
            type: 'upload_ready',
            timestamp: Date.now()
          }));
          break;
          
        case 'upload_data':
          // Handle binary upload data
          if (clientInfo.testPhase === 'upload' && data.byteLength) {
            clientInfo.bytesTransferred += data.byteLength;
            
            // Send acknowledgment
            ws.send(JSON.stringify({
              type: 'upload_ack',
              timestamp: Date.now(),
              bytesReceived: data.byteLength,
              totalBytesReceived: clientInfo.bytesTransferred
            }));
          }
          break;
          
        case 'test_complete':
          // Handle test completion
          clientInfo.testPhase = null;
          ws.send(JSON.stringify({
            type: 'test_complete_ack',
            timestamp: Date.now()
          }));
          break;
          
        default:
          console.log(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message',
        timestamp: Date.now()
      }));
    }
  });
  
  // Handle connection close
  ws.on('close', () => {
    console.log(`WebSocket client disconnected: ${clientId}`);
    activeConnections.delete(ws);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error);
    activeConnections.delete(ws);
  });
});

// WebSocket ping handler (for latency measurement)
function handlePing(ws, data) {
  const clientTimestamp = data.timestamp || Date.now();
  const serverTimestamp = Date.now();
  
  // Send pong response immediately
  ws.send(JSON.stringify({
    type: 'pong',
    clientTimestamp,
    serverTimestamp,
    serverProcessingTime: serverTimestamp - clientTimestamp
  }));
}

// WebSocket download test handler
function handleDownloadTest(ws, data, clientInfo) {
  // Get requested size (default to 1MB if not specified)
  const size = data.size || 1024 * 1024;
  const chunkSize = data.chunkSize || 64 * 1024; // Default 64KB chunks
  
  // Limit maximum size to 100MB for WebSocket tests
  const safeSize = Math.min(size, 100 * 1024 * 1024);
  
  // Update client info
  clientInfo.testPhase = 'download';
  clientInfo.bytesTransferred = 0;
  clientInfo.testStartTime = Date.now();
  
  // Pre-generate a reusable random buffer for better performance
  const chunkBuffer = crypto.randomBytes(chunkSize);
  
  // Send test start confirmation
  ws.send(JSON.stringify({
    type: 'download_started',
    timestamp: Date.now(),
    totalBytes: safeSize
  }));
  
  // Send data in chunks
  let bytesSent = 0;
  
  function sendNextChunk() {
    if (bytesSent >= safeSize) {
      // Test complete
      const endTime = Date.now();
      const duration = (endTime - clientInfo.testStartTime) / 1000;
      const throughputMBps = (safeSize / (1024 * 1024)) / duration;
      
      // Send completion message
      ws.send(JSON.stringify({
        type: 'download_complete',
        timestamp: endTime,
        bytesSent: safeSize,
        duration: duration.toFixed(3),
        throughputMBps: throughputMBps.toFixed(2)
      }));
      
      return;
    }
    
    // Calculate chunk size for this iteration
    const remainingBytes = safeSize - bytesSent;
    const currentChunkSize = Math.min(chunkSize, remainingBytes);
    
    // Use pre-generated buffer for better performance
    const chunk = chunkBuffer.subarray(0, currentChunkSize);
    
    // Send binary data
    ws.send(chunk, { binary: true }, (err) => {
      if (err) {
        console.error('Error sending WebSocket data:', err);
        return;
      }
      
      bytesSent += currentChunkSize;
      clientInfo.bytesTransferred = bytesSent;
      
      // Send progress update every 1MB
      if (bytesSent % (1024 * 1024) === 0 || bytesSent === safeSize) {
        ws.send(JSON.stringify({
          type: 'download_progress',
          timestamp: Date.now(),
          bytesSent,
          totalBytes: safeSize,
          progress: (bytesSent / safeSize * 100).toFixed(1)
        }));
      }
      
      // Schedule next chunk
      if (bytesSent < safeSize) {
        process.nextTick(sendNextChunk);
      }
    });
  }
  
  // Start sending data
  sendNextChunk();
}

// Start the server
server.listen(PORT, () => {
  console.log(`Speed test backend server running on port ${PORT} (Worker ${cluster.worker.id})`);
  console.log(`WebSocket server is also running on the same port`);
});

// Optimize TCP settings for high throughput
server.keepAliveTimeout = 60000; // 60 seconds
server.headersTimeout = 65000; // 65 seconds (slightly higher than keepAliveTimeout)

} // Close the worker process block