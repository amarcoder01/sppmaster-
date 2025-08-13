import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Download, Upload, Wifi, RotateCcw, Activity, Zap, Share2, FileText, HelpCircle, Loader, AlertTriangle, Server, Globe, Info, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { SpeedTestResult, TestProgress as TestProgressType, TestProtocol } from '../types/speedTest';
import SpeedTestEngine from '../utils/speedTestEngine';
import ModernShareModal from './ModernShareModal';
import NetworkSpeedGuide from './NetworkSpeedGuide';
import PacketLossCard from './PacketLossCard';


interface NewSpeedTestProps {
  onTestComplete?: (result: SpeedTestResult) => void;
}

const NewSpeedTest: React.FC<NewSpeedTestProps> = ({ onTestComplete }) => {
  const navigate = useNavigate();
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testProgress, setTestProgress] = useState<TestProgressType>({
    phase: 'idle',
    progress: 0,
    currentSpeed: 0,
    elapsedTime: 0
  });
  const [testResult, setTestResult] = useState<SpeedTestResult | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isSpeedGuideOpen, setIsSpeedGuideOpen] = useState(false);
  
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const [selectedServer, setSelectedServer] = useState<string>('cf-auto');
  const [selectedProtocol, setSelectedProtocol] = useState<TestProtocol>(TestProtocol.XHR);
  const [availableServers, setAvailableServers] = useState<any[]>([]);
  

  const handleProgressUpdate = useCallback((progress: TestProgressType) => {
    setTestProgress(progress);
  }, []);

  const startTest = async () => {
    setIsTestRunning(true);
    setTestResult(null);
    setTestProgress({
      phase: 'ping',
      progress: 0,
      currentSpeed: 0,
      elapsedTime: 0
    });

    try {
      console.log('Starting speed test with server:', selectedServer);
      
      const testEngine = new SpeedTestEngine(handleProgressUpdate, undefined, {
        duration: 10,
        parallelConnections: 4,
        enableBufferbloat: true,
        enableStressTest: false,
        protocol: selectedProtocol
      }, selectedServer);
      
      // Select the best server before starting the test
      const bestServer = await testEngine.selectBestServer();
      console.log('Selected server:', bestServer.name, 'at', bestServer.location);
      toast.success(`Connected to ${bestServer.name} - ${bestServer.location}`);
      
      const result = await testEngine.runSpeedTest();
      setTestResult(result);
      
      // Store result in localStorage
      const savedResults = JSON.parse(localStorage.getItem('speedTestResults') || '[]');
      savedResults.unshift(result);
      localStorage.setItem('speedTestResults', JSON.stringify(savedResults.slice(0, 20)));
      
      if (onTestComplete) {
        onTestComplete(result);
      }
      
      // Set flag to redirect to results page
      setShouldRedirect(true);
      
      // Clean up the engine
      testEngine.dispose();
    } catch (error) {
      console.error('Speed test failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast.error(`Test failed: ${errorMessage}. Retrying...`);
      
      // Reset progress on error
      setTestProgress({
        phase: 'idle',
        progress: 0,
        currentSpeed: 0,
        elapsedTime: 0
      });
      
      // Retry after a delay
      setTimeout(() => startTest(), 3000);
    } finally {
      setIsTestRunning(false);
    }
  };

  const resetTest = () => {
    setTestResult(null);
    setTestProgress({
      phase: 'idle',
      progress: 0,
      currentSpeed: 0,
      elapsedTime: 0
    });
    setAutoStarted(false);
    setShouldRedirect(false); // Reset redirect flag
    setTimeout(() => {
      startTest();
    }, 500);
  };

  // Load available servers on component mount
  useEffect(() => {
    const tempEngine = new SpeedTestEngine();
    setAvailableServers(tempEngine.getAvailableServers());
    tempEngine.dispose();
  }, []);

  // Auto-start test when component mounts
  useEffect(() => {
    console.log('Auto-start useEffect triggered:', { autoStarted, isTestRunning, testResult });
    if (!autoStarted && !isTestRunning && !testResult) {
      console.log('Auto-starting speed test in 1 second...');
      setAutoStarted(true);
      setTimeout(() => {
        console.log('Auto-start timeout triggered, calling startTest()');
        startTest();
      }, 1000);
    }
  }, [autoStarted, isTestRunning, testResult, startTest]);

  // Redirect to results page after test completion
  useEffect(() => {
    if (shouldRedirect && testResult) {
      const timer = setTimeout(() => {
        navigate(`/results/${testResult.id}`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [shouldRedirect, testResult, navigate]);

  const handleShareClick = () => {
    setIsShareModalOpen(true);
  };

  const handleGeneratePdf = () => {
    setIsPdfLoading(true);
    // Simulate PDF generation
    setTimeout(() => {
      setIsPdfLoading(false);
      toast.success('PDF report generated!');
    }, 1500);
  };

  const getPhaseIcon = () => {
    switch (testProgress.phase) {
      case 'ping': return <Activity className="w-6 h-6 text-blue-500" />;
      case 'download': return <Download className="w-6 h-6 text-green-500" />;
      case 'upload': return <Upload className="w-6 h-6 text-orange-500" />;
      case 'bufferbloat': return <Activity className="w-6 h-6 text-purple-500" />;
      case 'packetLoss': return <AlertTriangle className="w-6 h-6 text-yellow-500" />;
      default: return <Wifi className="w-6 h-6 text-gray-500" />;
    }
  };

  const getPhaseLabel = () => {
    switch (testProgress.phase) {
      case 'ping': return 'Testing Connection';
      case 'download': return 'Testing Download';
      case 'upload': return 'Testing Upload';
      case 'bufferbloat': return 'Testing Bufferbloat';
      case 'packetLoss': return 'Testing Packet Loss';
      case 'complete': return 'Test Complete';
      default: return 'Initializing';
    }
  };

  const getProgressColor = () => {
    switch (testProgress.phase) {
      case 'ping': return 'bg-blue-500';
      case 'download': return 'bg-green-500';
      case 'upload': return 'bg-orange-500';
      case 'bufferbloat': return 'bg-purple-500';
      case 'packetLoss': return 'bg-yellow-500';
      case 'complete': return 'bg-indigo-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-4xl mx-auto">
        {/* Main Test Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-5 text-white">
            <h2 className="text-2xl font-bold">Internet Speed Test</h2>
            <p className="text-blue-100 mt-1">Test your connection speed with our advanced tool</p>
          </div>

          {/* Server Selection and Test Configuration */}
          <div className="px-6 pt-4 pb-2 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-600">Test Server:</span>
              </div>
              <select 
                className="text-sm bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={selectedServer}
                onChange={(e) => setSelectedServer(e.target.value)}
                disabled={isTestRunning}
              >
                {availableServers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name} {server.id === 'cf-auto' ? '(Recommended)' : `- ${server.location}`}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex flex-col space-y-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-600">Protocol:</span>
                  </div>
                  <select 
                    className="text-sm bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={selectedProtocol}
                    onChange={(e) => setSelectedProtocol(e.target.value as TestProtocol)}
                    disabled={isTestRunning}
                  >
                    <option value={TestProtocol.XHR}>XHR/Fetch (Standard)</option>
                    <option value={TestProtocol.WEBSOCKET}>WebSocket (Lower Latency)</option>
                  </select>
                </div>
              </div>
          </div>

          {/* Test Area */}
          <div className="p-6">
            {/* Test Progress */}
            {isTestRunning && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-8"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getPhaseIcon()}
                    <span className="font-medium text-gray-800">{getPhaseLabel()}</span>
                  </div>
                  <span className="text-sm text-gray-500">{Math.round(testProgress.progress)}%</span>
                </div>
                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                  <motion.div 
                    className={`h-full ${getProgressColor()}`}
                    initial={{ width: '0%' }}
                    animate={{ width: `${testProgress.progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                {testProgress.phase === 'download' || testProgress.phase === 'upload' ? (
                  <div className="mt-2 text-center text-lg font-bold text-gray-800">
                    {testProgress.currentSpeed.toFixed(1)} <span className="text-sm font-normal text-gray-500">Mbps</span>
                  </div>
                ) : null}
              </motion.div>
            )}

            {/* Circular Speed Test Visualization */}
            <div className="flex flex-col items-center justify-center py-4">
              <AnimatePresence mode="wait">
                {!isTestRunning && !testResult && (
                  <motion.div
                    key="start"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex flex-col items-center"
                  >
                    <motion.div 
                      className="w-48 h-48 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg cursor-pointer"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={startTest}
                    >
                      <div className="w-44 h-44 rounded-full bg-white flex items-center justify-center">
                        <div className="text-center">
                          <Wifi className="w-10 h-10 text-blue-500 mx-auto mb-2" />
                          <span className="text-xl font-bold text-gray-800">Start Test</span>
                        </div>
                      </div>
                    </motion.div>
                    <p className="mt-4 text-gray-600 text-center max-w-sm">
                      Click to test your download speed, upload speed, ping, and more
                    </p>
                  </motion.div>
                )}

                {isTestRunning && (
                  <motion.div
                    key="testing"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="relative w-48 h-48 flex items-center justify-center"
                  >
                    <svg className="w-full h-full" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="#f0f0f0"
                        strokeWidth="8"
                      />
                      <motion.circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke={testProgress.phase === 'download' ? '#10B981' : 
                               testProgress.phase === 'upload' ? '#F97316' : 
                               testProgress.phase === 'ping' ? '#3B82F6' : 
                               testProgress.phase === 'bufferbloat' ? '#8B5CF6' : 
                               testProgress.phase === 'packetLoss' ? '#FBBF24' : '#6366F1'}
                        strokeWidth="8"
                        strokeDasharray="283"
                        strokeDashoffset={283 - (283 * testProgress.progress / 100)}
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                        initial={{ strokeDashoffset: 283 }}
                        animate={{ strokeDashoffset: 283 - (283 * testProgress.progress / 100) }}
                        transition={{ duration: 0.3 }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                      {testProgress.phase === 'download' || testProgress.phase === 'upload' ? (
                        <>
                          <span className="text-3xl font-bold text-gray-800">
                            {testProgress.currentSpeed.toFixed(1)}
                          </span>
                          <span className="text-sm text-gray-500">Mbps</span>
                        </>
                      ) : (
                        <div className="flex flex-col items-center">
                          <span className="text-lg font-medium text-gray-700">{Math.round(testProgress.progress)}%</span>
                          <span className="text-sm text-gray-500">{getPhaseLabel()}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {!isTestRunning && testResult && (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex flex-col items-center"
                  >
                    <div className="grid grid-cols-3 gap-6 mb-6">
                      <div className="flex flex-col items-center">
                        <div className="p-3 rounded-full bg-green-100 mb-2">
                          <Download className="w-6 h-6 text-green-600" />
                        </div>
                        <span className="text-2xl font-bold text-gray-800">{testResult.downloadSpeed.toFixed(1)}</span>
                        <span className="text-sm text-gray-500">Mbps Download</span>
                      </div>
                      
                      <div className="flex flex-col items-center">
                        <div className="p-3 rounded-full bg-orange-100 mb-2">
                          <Upload className="w-6 h-6 text-orange-600" />
                        </div>
                        <span className="text-2xl font-bold text-gray-800">{testResult.uploadSpeed.toFixed(1)}</span>
                        <span className="text-sm text-gray-500">Mbps Upload</span>
                      </div>
                      
                      <div className="flex flex-col items-center">
                        <div className="p-3 rounded-full bg-blue-100 mb-2">
                          <Activity className="w-6 h-6 text-blue-600" />
                        </div>
                        <span className="text-2xl font-bold text-gray-800">{testResult.ping.toFixed(0)}</span>
                        <span className="text-sm text-gray-500">ms Ping</span>
                      </div>
                    </div>
                    
                    <motion.button
                      onClick={resetTest}
                      className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <RotateCcw className="w-5 h-5" />
                      Test Again
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Action Buttons */}
            {!isTestRunning && testResult && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="mt-6 flex flex-wrap gap-3 justify-center"
              >
                <button 
                  onClick={handleShareClick}
                  className="px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm font-medium text-gray-700"
                >
                  <Share2 className="w-4 h-4 text-blue-500" />
                  Share Results
                </button>
                
                <button 
                  onClick={handleGeneratePdf}
                  className="px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm font-medium text-gray-700"
                  disabled={isPdfLoading}
                >
                  {isPdfLoading ? (
                    <Loader className="w-4 h-4 text-blue-500 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4 text-blue-500" />
                  )}
                  Generate Report
                </button>
                
                <button 
                  onClick={() => setIsSpeedGuideOpen(true)}
                  className="px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm font-medium text-gray-700"
                >
                  <HelpCircle className="w-4 h-4 text-blue-500" />
                  Speed Guide
                </button>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              <span>Server: {testResult?.serverLocation || selectedServer}</span>
            </div>
            <div>
              Powered by SpeedTest Pro
            </div>
          </div>
        </motion.div>

        {/* Additional Information */}
        {!isTestRunning && testResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {/* Packet Loss Card */}
            {testResult.packetLoss && (
              <PacketLossCard packetLoss={testResult.packetLoss} />
            )}
            
            {/* Bufferbloat Card */}
            {testResult.bufferbloat && (
              <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-purple-500" />
                  Bufferbloat Analysis
                </h3>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-gray-600">Rating</span>
                  <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                    testResult.bufferbloat.rating === 'A' ? 'bg-green-100 text-green-800' :
                    testResult.bufferbloat.rating === 'B' ? 'bg-blue-100 text-blue-800' :
                    testResult.bufferbloat.rating === 'C' ? 'bg-yellow-100 text-yellow-800' :
                    testResult.bufferbloat.rating === 'D' ? 'bg-orange-100 text-orange-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {testResult.bufferbloat.rating}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Latency Increase</span>
                  <span className="font-medium text-gray-800">{testResult.bufferbloat.latencyIncrease} ms</span>
                </div>
                <p className="mt-4 text-sm text-gray-600">
                  Bufferbloat occurs when your connection gets congested, causing delays. 
                  A lower rating indicates potential issues during heavy usage.
                </p>
              </div>
            )}
            
            {/* Protocol Overhead Card */}
            {testResult.protocolOverhead && (
              <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-blue-500" />
                  Protocol Overhead Analysis
                </h3>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-gray-600">Detection Mode</span>
                  <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                    testResult.protocolOverhead.detected ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {testResult.protocolOverhead.detected ? 'Auto-Detected' : 'Fixed Factor'}
                  </div>
                </div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-gray-600">Overhead Factor</span>
                  <span className="font-medium text-gray-800">{testResult.protocolOverhead.factor.toFixed(3)}x</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Overhead Percentage</span>
                  <span className="font-medium text-gray-800">{testResult.protocolOverhead.overheadPercentage.toFixed(1)}%</span>
                </div>
                <p className="mt-4 text-sm text-gray-600">
                  Protocol overhead represents the extra data needed to transmit your actual content. 
                  This includes headers, encryption, and other protocol-specific information.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Share Modal */}
      <AnimatePresence>
        {isShareModalOpen && testResult && (
          <ModernShareModal result={testResult} onClose={() => setIsShareModalOpen(false)} />
        )}
      </AnimatePresence>

      {/* Speed Guide Modal */}
      <AnimatePresence>
        {isSpeedGuideOpen && (
          <NetworkSpeedGuide onClose={() => setIsSpeedGuideOpen(false)} />
        )}
      </AnimatePresence>


    </div>
  );
};

export default NewSpeedTest;