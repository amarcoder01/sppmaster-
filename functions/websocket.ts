// @ts-nocheck
/**
 * WebSocket handler using Cloudflare Durable Objects
 * This replaces the traditional WebSocket server functionality
 */

// Make sure this class is properly exported for Cloudflare Pages Functions
export default class WebSocketState extends DurableObject {
  private sessions: Map<WebSocket, any> = new Map();
  
  constructor(state: DurableObjectState, env: any) {
    super(state, env);
  }
  
  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    // Accept the WebSocket connection
    server.accept();
    
    // Generate client ID
    const clientId = crypto.randomUUID();
    
    // Store session information
    const sessionInfo = {
      id: clientId,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      testPhase: null,
      bytesTransferred: 0
    };
    
    this.sessions.set(server, sessionInfo);
    
    // Send initial connection confirmation
    server.send(JSON.stringify({
      type: 'connected',
      clientId,
      timestamp: Date.now(),
      message: 'WebSocket connection established'
    }));
    
    // Handle incoming messages
    server.addEventListener('message', (event) => {
      this.handleMessage(server, event.data, sessionInfo);
    });
    
    // Handle connection close
    server.addEventListener('close', () => {
      console.log(`WebSocket client disconnected: ${clientId}`);
      this.sessions.delete(server);
    });
    
    // Handle errors
    server.addEventListener('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
      this.sessions.delete(server);
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  
  private handleMessage(ws: WebSocket, message: string, sessionInfo: any) {
    try {
      const data = JSON.parse(message);
      sessionInfo.lastActivity = Date.now();
      
      switch (data.type) {
        case 'ping':
          this.handlePing(ws, data);
          break;
          
        case 'download_start':
          this.handleDownloadTest(ws, data, sessionInfo);
          break;
          
        case 'upload_start':
          this.handleUploadStart(ws, data, sessionInfo);
          break;
          
        case 'upload_data':
          this.handleUploadData(ws, data, sessionInfo);
          break;
          
        case 'test_complete':
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
  }
  
  private handlePing(ws: WebSocket, data: any) {
    const clientTimestamp = data.timestamp || Date.now();
    const serverTimestamp = Date.now();
    
    ws.send(JSON.stringify({
      type: 'pong',
      clientTimestamp,
      serverTimestamp,
      serverProcessingTime: serverTimestamp - clientTimestamp
    }));
  }
  
  private handleDownloadTest(ws: WebSocket, data: any, sessionInfo: any) {
    const size = data.size || 1024 * 1024; // Default 1MB
    const chunkSize = data.chunkSize || 64 * 1024; // Default 64KB
    const safeSize = Math.min(size, 100 * 1024 * 1024); // Max 100MB
    
    sessionInfo.testPhase = 'download';
    sessionInfo.bytesTransferred = 0;
    sessionInfo.testStartTime = Date.now();
    
    // Send test start confirmation
    ws.send(JSON.stringify({
      type: 'download_started',
      timestamp: Date.now(),
      totalBytes: safeSize
    }));
    
    // Send data in chunks
    let bytesSent = 0;
    const sendChunk = () => {
      if (bytesSent >= safeSize) {
        // Test complete
        ws.send(JSON.stringify({
          type: 'download_complete',
          timestamp: Date.now(),
          totalBytes: bytesSent,
          duration: Date.now() - sessionInfo.testStartTime
        }));
        return;
      }
      
      const remainingBytes = safeSize - bytesSent;
      const currentChunkSize = Math.min(chunkSize, remainingBytes);
      
      // Generate random data
      const chunk = new Uint8Array(currentChunkSize);
      for (let i = 0; i < currentChunkSize; i++) {
        chunk[i] = Math.floor(Math.random() * 256);
      }
      
      // Send progress update
      ws.send(JSON.stringify({
        type: 'download_progress',
        timestamp: Date.now(),
        bytesTransferred: bytesSent + currentChunkSize,
        totalBytes: safeSize,
        data: Array.from(chunk)
      }));
      
      bytesSent += currentChunkSize;
      sessionInfo.bytesTransferred = bytesSent;
      
      // Schedule next chunk
      setTimeout(sendChunk, 1);
    };
    
    sendChunk();
  }
  
  private handleUploadStart(ws: WebSocket, data: any, sessionInfo: any) {
    sessionInfo.testPhase = 'upload';
    sessionInfo.bytesTransferred = 0;
    sessionInfo.testStartTime = Date.now();
    
    ws.send(JSON.stringify({
      type: 'upload_ready',
      timestamp: Date.now(),
      message: 'Ready to receive upload data'
    }));
  }
  
  private handleUploadData(ws: WebSocket, data: any, sessionInfo: any) {
    const chunkSize = data.data ? data.data.length : 0;
    sessionInfo.bytesTransferred += chunkSize;
    
    // Send acknowledgment
    ws.send(JSON.stringify({
      type: 'upload_ack',
      timestamp: Date.now(),
      bytesReceived: sessionInfo.bytesTransferred
    }));
  }
}

// Export the class with both default and named exports for compatibility
export { WebSocketState };

// WebSocket upgrade endpoint
export async function onRequestGET(context: any) {
  const { request } = context;

  // Require WebSocket upgrade
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

  // Accept connection
  // @ts-ignore - Cloudflare runtime
  server.accept();

  const clientId = (globalThis as any).crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const sessionInfo: any = {
    id: clientId,
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    testPhase: null,
    bytesTransferred: 0,
    testStartTime: 0
  };

  // Send handshake
  server.send(JSON.stringify({
    type: 'connected',
    clientId,
    timestamp: Date.now(),
    message: 'WebSocket connection established'
  }));

  // Message handling
  server.addEventListener('message', (event: any) => {
    try {
      sessionInfo.lastActivity = Date.now();
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

      switch (data?.type) {
        case 'ping': {
          const clientTimestamp = data.timestamp || Date.now();
          const serverTimestamp = Date.now();
          server.send(JSON.stringify({
            type: 'pong',
            clientTimestamp,
            serverTimestamp,
            serverProcessingTime: serverTimestamp - clientTimestamp
          }));
          break;
        }
        case 'download_start': {
          const size = data.size || 1024 * 1024;
          const chunkSize = data.chunkSize || 64 * 1024;
          const safeSize = Math.min(size, 100 * 1024 * 1024);

          sessionInfo.testPhase = 'download';
          sessionInfo.bytesTransferred = 0;
          sessionInfo.testStartTime = Date.now();

          server.send(JSON.stringify({ type: 'download_started', timestamp: Date.now(), totalBytes: safeSize }));

          const chunk = new Uint8Array(chunkSize);
          for (let i = 0; i < chunkSize; i++) chunk[i] = (i * 31) & 255;

          const sendNext = () => {
            if (sessionInfo.bytesTransferred >= safeSize) {
              const duration = (Date.now() - sessionInfo.testStartTime) / 1000;
              const throughputMBps = (safeSize / (1024 * 1024)) / duration;
              server.send(JSON.stringify({
                type: 'download_complete',
                timestamp: Date.now(),
                bytesSent: safeSize,
                duration: duration.toFixed(3),
                throughputMBps: throughputMBps.toFixed(2)
              }));
              return;
            }

            const remaining = safeSize - sessionInfo.bytesTransferred;
            const current = Math.min(chunkSize, remaining);
            server.send(chunk.subarray(0, current));
            sessionInfo.bytesTransferred += current;

            if (sessionInfo.bytesTransferred % (1024 * 1024) === 0 || sessionInfo.bytesTransferred === safeSize) {
              server.send(JSON.stringify({
                type: 'download_progress',
                timestamp: Date.now(),
                bytesSent: sessionInfo.bytesTransferred,
                totalBytes: safeSize,
                progress: (sessionInfo.bytesTransferred / safeSize * 100).toFixed(1)
              }));
            }

            setTimeout(sendNext, 0);
          };

          sendNext();
          break;
        }
        case 'upload_start': {
          sessionInfo.testPhase = 'upload';
          sessionInfo.bytesTransferred = 0;
          sessionInfo.testStartTime = Date.now();
          server.send(JSON.stringify({ type: 'upload_ready', timestamp: Date.now() }));
          break;
        }
        case 'upload_data': {
          if (typeof data.byteLength === 'number') {
            sessionInfo.bytesTransferred += data.byteLength;
            server.send(JSON.stringify({
              type: 'upload_ack',
              timestamp: Date.now(),
              bytesReceived: data.byteLength,
              totalBytesReceived: sessionInfo.bytesTransferred
            }));
          }
          break;
        }
        case 'test_complete': {
          server.send(JSON.stringify({ type: 'test_complete_ack', timestamp: Date.now() }));
          sessionInfo.testPhase = null;
          break;
        }
        default:
          break;
      }
    } catch (e) {
      server.send(JSON.stringify({ type: 'error', message: 'Invalid message', timestamp: Date.now() }));
    }
  });

  return new Response(null, { status: 101, webSocket: client });
}