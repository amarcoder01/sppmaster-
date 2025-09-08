import { SpeedTestResult } from '../types/speedTest';

// WebSocket connection states
export enum WebSocketState {
  CONNECTING = 'connecting',
  OPEN = 'open',
  CLOSING = 'closing',
  CLOSED = 'closed',
  ERROR = 'error'
}

// WebSocket message types
export enum MessageType {
  CONNECTED = 'connected',
  PING = 'ping',
  PONG = 'pong',
  DOWNLOAD_START = 'download_start',
  DOWNLOAD_STARTED = 'download_started',
  DOWNLOAD_PROGRESS = 'download_progress',
  DOWNLOAD_COMPLETE = 'download_complete',
  UPLOAD_START = 'upload_start',
  UPLOAD_READY = 'upload_ready',
  UPLOAD_DATA = 'upload_data',
  UPLOAD_ACK = 'upload_ack',
  TEST_COMPLETE = 'test_complete',
  TEST_COMPLETE_ACK = 'test_complete_ack',
  ERROR = 'error'
}

// WebSocket service configuration
interface WebSocketServiceConfig {
  url: string;
  reconnectAttempts?: number;
  reconnectInterval?: number;
  debug?: boolean;
}

// Progress update callback type
type ProgressCallback = (phase: string, progress: number, currentSpeed: number) => void;

// WebSocket service for speed testing
class WebSocketService {
  private socket: WebSocket | null = null;
  private state: WebSocketState = WebSocketState.CLOSED;
  private config: WebSocketServiceConfig;
  private reconnectAttempt = 0;
  private clientId: string | null = null;
  private progressCallback: ProgressCallback | null = null;
  private testPhase: string | null = null;
  private testStartTime = 0;
  private pingResults: number[] = [];
  private downloadResults: number[] = [];
  private uploadResults: number[] = [];
  private testComplete = false;
  private testData: Partial<SpeedTestResult> = {};
  private debug: boolean;

  constructor(config: WebSocketServiceConfig) {
    this.config = {
      reconnectAttempts: 3,
      reconnectInterval: 2000,
      debug: false,
      ...config
    };
    this.debug = this.config.debug || false;
  }

  // Connect to WebSocket server
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket && (this.state === WebSocketState.OPEN || this.state === WebSocketState.CONNECTING)) {
        this.log('WebSocket already connected or connecting');
        resolve();
        return;
      }

      this.state = WebSocketState.CONNECTING;
      this.log(`Connecting to WebSocket server at ${this.config.url}`);

      try {
        this.socket = new WebSocket(this.config.url);

        // Connection opened
        this.socket.addEventListener('open', () => {
          this.state = WebSocketState.OPEN;
          this.reconnectAttempt = 0;
          this.log('WebSocket connection established');
          resolve();
        });

        // Connection error
        this.socket.addEventListener('error', (event) => {
          this.state = WebSocketState.ERROR;
          this.log('WebSocket connection error:', event);
          if (this.state === WebSocketState.CONNECTING) {
            reject(new Error('Failed to connect to WebSocket server'));
          }
          this.attemptReconnect();
        });

        // Connection closed
        this.socket.addEventListener('close', () => {
          this.state = WebSocketState.CLOSED;
          this.log('WebSocket connection closed');
          this.attemptReconnect();
        });

        // Listen for messages
        this.socket.addEventListener('message', (event) => {
          this.handleMessage(event);
        });
      } catch (error) {
        this.state = WebSocketState.ERROR;
        this.log('Error creating WebSocket:', error);
        reject(error);
        this.attemptReconnect();
      }
    });
  }

  // Attempt to reconnect to the server
  private attemptReconnect(): void {
    if (
      this.state !== WebSocketState.CLOSED && 
      this.state !== WebSocketState.ERROR
    ) {
      return;
    }

    if (this.reconnectAttempt >= (this.config.reconnectAttempts || 3)) {
      this.log(`Maximum reconnect attempts (${this.config.reconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempt++;
    this.log(`Attempting to reconnect (${this.reconnectAttempt}/${this.config.reconnectAttempts})...`);

    setTimeout(() => {
      this.connect().catch(error => {
        this.log('Reconnection attempt failed:', error);
      });
    }, this.config.reconnectInterval);
  }

  // Close the WebSocket connection
  disconnect(): void {
    if (!this.socket || this.state === WebSocketState.CLOSED) {
      return;
    }

    this.state = WebSocketState.CLOSING;
    this.socket.close();
    this.socket = null;
    this.clientId = null;
  }

  // Send a message to the server
  private send(type: MessageType, data: any = {}): boolean {
    if (!this.socket || this.state !== WebSocketState.OPEN) {
      this.log('Cannot send message, WebSocket is not open');
      return false;
    }

    try {
      const message = JSON.stringify({
        type,
        timestamp: Date.now(),
        clientId: this.clientId,
        ...data
      });

      this.socket.send(message);
      return true;
    } catch (error) {
      this.log('Error sending message:', error);
      return false;
    }
  }

  // Send binary data to the server
  private sendBinary(data: ArrayBuffer): boolean {
    if (!this.socket || this.state !== WebSocketState.OPEN) {
      this.log('Cannot send binary data, WebSocket is not open');
      return false;
    }

    try {
      this.socket.send(data);
      return true;
    } catch (error) {
      this.log('Error sending binary data:', error);
      return false;
    }
  }

  // Handle incoming messages
  private handleMessage(event: MessageEvent): void {
    // Handle binary messages (for upload test)
    if (event.data instanceof ArrayBuffer) {
      if (this.testPhase === 'upload') {
        // For upload test, we receive binary data acknowledgments
        this.handleUploadAck(event.data);
      }
      return;
    }

    // Handle text messages
    try {
      const message = JSON.parse(event.data);
      this.log('Received message:', message);

      switch (message.type) {
        case MessageType.CONNECTED:
          this.clientId = message.clientId;
          this.log(`Connected with client ID: ${this.clientId}`);
          break;

        case MessageType.PONG:
          this.handlePong(message);
          break;

        case MessageType.DOWNLOAD_STARTED:
          this.testPhase = 'download';
          this.testStartTime = Date.now();
          this.log(`Download test started, total bytes: ${message.totalBytes}`);
          break;

        case MessageType.DOWNLOAD_PROGRESS:
          this.handleDownloadProgress(message);
          break;

        case MessageType.DOWNLOAD_COMPLETE:
          this.handleDownloadComplete(message);
          break;

        case MessageType.UPLOAD_READY:
          this.startUploadingData();
          break;

        case MessageType.UPLOAD_ACK:
          this.handleUploadProgress(message);
          break;

        case MessageType.TEST_COMPLETE_ACK:
          this.testComplete = true;
          this.log('Test completed and acknowledged by server');
          break;

        case MessageType.ERROR:
          this.log('Error from server:', message.message);
          break;

        default:
          this.log(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      this.log('Error parsing message:', error, event.data);
    }
  }

  // Handle pong response for ping measurement
  private handlePong(message: any): void {
    const roundTripTime = Date.now() - message.clientTimestamp;
    this.pingResults.push(roundTripTime);
    this.log(`Ping: ${roundTripTime}ms (server processing: ${message.serverProcessingTime}ms)`);

    // Update progress if callback is set
    if (this.progressCallback && this.testPhase === 'ping') {
      const progress = Math.min((this.pingResults.length / 10) * 100, 100);
      this.progressCallback('ping', progress, 0);
    }

    // If we have enough ping samples, calculate average
    if (this.pingResults.length >= 10) {
      const avgPing = this.calculateAveragePing();
      this.testData.ping = avgPing;
      this.log(`Average ping: ${avgPing}ms`);

      // Move to next test phase if we're in ping phase
      if (this.testPhase === 'ping') {
        this.testPhase = 'download';
        this.startDownloadTest();
      }
    } else if (this.testPhase === 'ping') {
      // Continue ping test
      setTimeout(() => this.measurePing(), 200);
    }
  }

  // Handle download progress updates
  private handleDownloadProgress(message: any): void {
    if (this.progressCallback && this.testPhase === 'download') {
      // Calculate current speed in Mbps
      const elapsedTime = (Date.now() - this.testStartTime) / 1000;
      const currentSpeed = ((message.bytesSent * 8) / elapsedTime / 1000000);

      this.progressCallback('download', parseFloat(message.progress), currentSpeed);
    }
  }

  // Handle download completion
  private handleDownloadComplete(message: any): void {
    const downloadSpeed = parseFloat(message.throughputMBps) * 8; // Convert to Mbps
    this.downloadResults.push(downloadSpeed);
    this.testData.download = downloadSpeed;

    this.log(`Download test complete: ${downloadSpeed.toFixed(2)} Mbps`);

    // Move to upload test
    this.testPhase = 'upload';
    this.startUploadTest();
  }

  // Handle upload acknowledgments
  private handleUploadAck(message: any): void {
    // For binary upload acks
  }

  // Handle upload progress
  private handleUploadProgress(message: any): void {
    if (this.progressCallback && this.testPhase === 'upload') {
      // Calculate current speed in Mbps
      const elapsedTime = (Date.now() - this.testStartTime) / 1000;
      const currentSpeed = ((message.totalBytesReceived * 8) / elapsedTime / 1000000);

      // Calculate progress based on time (since we don't know total upload size)
      const progress = Math.min((elapsedTime / 10) * 100, 100); // Assume 10 second test

      this.progressCallback('upload', progress, currentSpeed);

      // If we've been uploading for 10 seconds, finish the test
      if (elapsedTime >= 10) {
        this.uploadResults.push(currentSpeed);
        this.testData.upload = currentSpeed;
        this.log(`Upload test complete: ${currentSpeed.toFixed(2)} Mbps`);

        // Complete the test
        this.completeTest();
      }
    }
  }

  // Calculate average ping from collected samples
  private calculateAveragePing(): number {
    if (this.pingResults.length === 0) return 0;

    // Sort ping results and remove outliers
    const sortedPings = [...this.pingResults].sort((a, b) => a - b);
    let filteredPings = sortedPings;

    // If we have enough samples, remove outliers
    if (sortedPings.length >= 5) {
      filteredPings = sortedPings.slice(1, -1); // Remove highest and lowest
    }

    // Calculate average
    const sum = filteredPings.reduce((acc, ping) => acc + ping, 0);
    return Math.round(sum / filteredPings.length);
  }

  // Start ping measurement
  measurePing(): void {
    this.testPhase = 'ping';
    this.pingResults = [];
    this.log('Starting ping measurement');

    // Send ping message
    this.send(MessageType.PING);
  }

  // Start download test
  startDownloadTest(): void {
    this.testPhase = 'download';
    this.downloadResults = [];
    this.testStartTime = Date.now();
    this.log('Starting download test');

    // Request download test
    this.send(MessageType.DOWNLOAD_START, {
      size: 10 * 1024 * 1024, // 10MB
      chunkSize: 64 * 1024 // 64KB chunks
    });
  }

  // Start upload test
  startUploadTest(): void {
    this.testPhase = 'upload';
    this.uploadResults = [];
    this.testStartTime = Date.now();
    this.log('Starting upload test');

    // Request upload test
    this.send(MessageType.UPLOAD_START, {
      size: 10 * 1024 * 1024 // 10MB
    });
  }

  // Start uploading data for upload test
  private startUploadingData(): void {
    const chunkSize = 64 * 1024; // 64KB chunks
    const buffer = new ArrayBuffer(chunkSize);
    const view = new Uint8Array(buffer);

    // Fill buffer with random data
    for (let i = 0; i < chunkSize; i++) {
      view[i] = Math.floor(Math.random() * 256);
    }

    // Upload data for 10 seconds
    const startTime = Date.now();
    const uploadDuration = 10000; // 10 seconds
    let totalUploaded = 0;

    const uploadChunk = () => {
      if (Date.now() - startTime >= uploadDuration) {
        // Upload test complete
        const elapsedTime = (Date.now() - startTime) / 1000;
        const uploadSpeed = (totalUploaded * 8) / elapsedTime / 1000000;
        this.uploadResults.push(uploadSpeed);
        this.testData.upload = uploadSpeed;

        this.log(`Upload test complete: ${uploadSpeed.toFixed(2)} Mbps`);
        this.completeTest();
        return;
      }

      // Send binary data
      if (this.sendBinary(buffer)) {
        totalUploaded += chunkSize;

        // Send metadata about the chunk
        this.send(MessageType.UPLOAD_DATA, {
          byteLength: chunkSize,
          totalUploaded
        });

        // Schedule next chunk
        setTimeout(uploadChunk, 50); // Upload a chunk every 50ms
      } else {
        // If send failed, try again after a short delay
        setTimeout(uploadChunk, 100);
      }
    };

    // Start uploading
    uploadChunk();
  }

  // Complete the speed test
  private completeTest(): void {
    this.testPhase = null;
    this.send(MessageType.TEST_COMPLETE, this.testData);
    this.log('Speed test complete', this.testData);
  }

  // Run a complete speed test
  runSpeedTest(progressCallback: ProgressCallback): Promise<SpeedTestResult> {
    return new Promise(async (resolve, reject) => {
      try {
        // Set progress callback
        this.progressCallback = progressCallback;
        this.testComplete = false;
        this.testData = {};

        // Connect to WebSocket server if not connected
        if (this.state !== WebSocketState.OPEN) {
          await this.connect();
        }

        // Start with ping test
        this.measurePing();

        // Wait for test to complete
        const checkCompletion = () => {
          if (this.testComplete) {
            // Test is complete, resolve with results
            const result: SpeedTestResult = {
              download: this.testData.download || 0,
              upload: this.testData.upload || 0,
              ping: this.testData.ping || 0,
              jitter: 0, // Not implemented in WebSocket version yet
              packetLoss: { percentage: 0, sent: 0, received: 0 }, // Not implemented in WebSocket version yet
              bufferbloat: { rating: 'A', latencyIncrease: 0 }, // Not implemented in WebSocket version yet
              timestamp: Date.now(),
              server: {
                name: 'WebSocket Server',
                location: 'Local',
                distance: 0
              },
              protocolOverhead: {
                detectionMode: 'fixed',
                factor: 1.0,
                percentage: 0
              }
            };
            resolve(result);
          } else {
            // Check again after a short delay
            setTimeout(checkCompletion, 500);
          }
        };

        checkCompletion();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Get the current connection state
  getState(): WebSocketState {
    return this.state;
  }

  // Logging helper
  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[WebSocketService]', ...args);
    }
  }
}

export default WebSocketService;