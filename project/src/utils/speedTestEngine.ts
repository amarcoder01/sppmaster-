import { TestProgress, SpeedTestResult, TestServer, GraphData, TestConfig, TestProtocol } from '../types/speedTest';
import { WorkerMessageType, WorkerMessage } from './speedTestWorker';

class SpeedTestEngine {
  private servers: TestServer[] = [
    // Use current origin for all Cloudflare edge servers since Cloudflare automatically routes to nearest edge
    { id: 'cf-auto', name: 'Auto (Cloudflare)', location: 'Nearest Edge', host: this.getCurrentOrigin(), distance: 0 },
    { id: 'local', name: 'Local Server', location: 'Custom Backend', host: 'http://localhost:3000', distance: 0 },
  ];

  private getCurrentOrigin(): string {
    // In development, always use the backend URL
    if (import.meta.env.DEV) {
      return 'http://localhost:3000';
    }
    // Safe way to get current origin that works in all environments
    if (typeof window !== 'undefined' && window.location) {
      return window.location.origin;
    }
    // Fallback for SSR or worker environments
    return 'https://speedtest.pages.dev';
  }

  private selectedServerId: string = 'cf-auto';

  private onProgress?: (progress: TestProgress) => void;
  private onGraphUpdate?: (data: GraphData[]) => void;
  private graphData: GraphData[] = [];
  private worker: Worker | null = null;
  private config: TestConfig;

  constructor(
    onProgress?: (progress: TestProgress) => void,
    onGraphUpdate?: (data: GraphData[]) => void,
    config?: TestConfig,
    selectedServerId?: string
  ) {
    this.onProgress = onProgress;
    this.onGraphUpdate = onGraphUpdate;
    this.selectedServerId = selectedServerId || 'cf-auto';
    this.config = config || {
      duration: 10,
      parallelConnections: 4,
      enableBufferbloat: true,
      enableStressTest: false,
      enableAutoProtocolOverhead: true,
      protocol: TestProtocol.XHR, // Default to XHR protocol
      // Advanced accuracy settings for 99% accurate results
      enableDynamicGracePeriod: true, // Automatically adjust grace period based on connection speed
      tcpGracePeriod: 2, // Default 2-second grace period to exclude TCP slow-start
      protocolOverheadFactor: 1.06 // Default 6% overhead compensation for HTTP/TCP/IP
    };
    
    this.initWorker();
  }

  private initWorker() {
    // Terminate existing worker if it exists
    if (this.worker) {
      this.worker.terminate();
    }

    // Create a new worker
    this.worker = new Worker(new URL('./speedTestWorker.ts', import.meta.url));
    
    // Set up message handler
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
    
    // Initialize worker with config
    this.sendMessageToWorker(WorkerMessageType.INITIALIZE, { config: this.config });
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
    const { type, payload } = event.data;
    
    switch (type) {
      case WorkerMessageType.PROGRESS_UPDATE:
        if (this.onProgress) {
          this.onProgress(payload);
        }
        break;
        
      case WorkerMessageType.GRAPH_UPDATE:
        this.graphData = payload;
        if (this.onGraphUpdate) {
          this.onGraphUpdate(this.graphData);
        }
        break;
        
      case WorkerMessageType.TEST_COMPLETE:
        if (this.onProgress) {
          this.onProgress({
            phase: 'complete',
            progress: 100,
            currentSpeed: 0,
            elapsedTime: performance.now()
          });
        }
        break;
        
      case WorkerMessageType.TEST_ERROR:
        console.error('Speed test error:', payload.message);
        break;
        
      default:
        console.log('Received message from worker:', type, payload);
    }
  }

  private sendMessageToWorker(type: WorkerMessageType, payload?: any) {
    if (!this.worker) {
      console.error('Worker not initialized');
      return;
    }
    
    this.worker.postMessage({ type, payload });
  }

  async runSpeedTest(): Promise<SpeedTestResult> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }
      
      // Reset graph data
      this.graphData = [];
      
      // Set up one-time listener for test completion
      const completeListener = (event: MessageEvent<WorkerMessage>) => {
        const { type, payload } = event.data;
        
        if (type === WorkerMessageType.TEST_COMPLETE) {
          // Remove this listener once test is complete
          this.worker?.removeEventListener('message', completeListener);
          resolve(payload as SpeedTestResult);
        } else if (type === WorkerMessageType.TEST_ERROR) {
          // Remove this listener on error
          this.worker?.removeEventListener('message', completeListener);
          reject(new Error(payload.message));
        }
      };
      
      // Add the temporary listener for completion/error
      this.worker.addEventListener('message', completeListener);
      
      // Start the test
      this.sendMessageToWorker(WorkerMessageType.START_TEST);
    });
  }

  async selectBestServer(): Promise<TestServer> {
    if (this.selectedServerId === 'cf-auto') {
      return await this.findNearestServer();
    }
    
    const selectedServer = this.servers.find(s => s.id === this.selectedServerId);
    return selectedServer || this.servers.find(s => s.id === 'cf-auto')!;
  }

  private async findNearestServer(): Promise<TestServer> {
    try {
      // Use Cloudflare's automatic edge selection by default
      const autoServer = this.servers.find(s => s.id === 'cf-auto');
      if (autoServer) {
        return autoServer;
      }

      // Fallback: Test latency to multiple servers
      const testPromises = this.servers
        .filter(s => s.id !== 'cf-auto' && s.id !== 'local')
        .map(async (server) => {
          try {
            const startTime = performance.now();
            const response = await fetch(`${server.host}/ping`, {
              method: 'GET',
              cache: 'no-cache',
              signal: AbortSignal.timeout(5000)
            });
            const latency = performance.now() - startTime;
            return { ...server, distance: latency, latency };
          } catch {
            return { ...server, distance: 9999, latency: 9999 };
          }
        });

      const serversWithLatency = await Promise.all(testPromises);
      return serversWithLatency.reduce((best, current) => 
        current.latency! < best.latency! ? current : best
      );
    } catch (error) {
      console.error('Error finding nearest server:', error);
      // Fallback to auto server
      return this.servers.find(s => s.id === 'cf-auto') || this.servers[0];
    }
  }

  getAvailableServers(): TestServer[] {
    return this.servers;
  }

  setSelectedServer(serverId: string) {
    this.selectedServerId = serverId;
  }

  abort() {
    this.sendMessageToWorker(WorkerMessageType.ABORT);
  }

  // Clean up resources when the engine is no longer needed
  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export default SpeedTestEngine;