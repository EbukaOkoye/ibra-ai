/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Camera, 
  BookOpen, 
  Music, 
  Mic2, 
  RotateCcw, 
  AlertCircle, 
  Volume2, 
  VolumeX,
  Scan,
  Pause,
  Play,
  Settings,
  X,
  Languages,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Maximize,
  Minimize,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeFrame, AnalysisResult } from './lib/gemini';

type Mode = 'auto' | 'reading' | 'music' | 'phonetics' | 'image' | 'table';

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [showSidebars, setShowSidebars] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isAnalysisPaused, setIsAnalysisPaused] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const lastDetectedType = useRef<string | null>(null);
  const lastGuidanceAnnounced = useRef<string | null>(null);
  const lastGuidanceTime = useRef<number>(0);
  const lastSpokenContentFingerprint = useRef<string | null>(null);

  // Attach stream to video element when ready
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, isCameraActive]);

  // Initialize Speech
  const speak = (text: string) => {
    if (isMuted || !text) return;
    
    // Cleanup existing speech
    window.speechSynthesis.cancel();
    
    // Sanitize text for smoother utterance
    const cleanText = text.replace(/[*_#]/g, '').trim();
    
    // Split text into chunks by sentences or paragraphs without isolating punctuation
    // This prevents the utterance from containing ONLY punctuation, which some browsers read aloud
    const chunks = cleanText.match(/([^\n.!?]+[.!?]*|\n\n)/g)?.map(s => s.trim()).filter(Boolean) || [cleanText];
    let currentChunkIdx = 0;

    const speakNextChunk = (index: number) => {
      if (index >= chunks.length) {
        setIsReading(false);
        return;
      }

      currentChunkIdx = index;
      const utterance = new SpeechSynthesisUtterance(chunks[index].trim());
      
      // NEURAL OPTIMIZED PROFILE
      utterance.rate = 0.95; 
      utterance.pitch = 1.0; 
      utterance.volume = 1.0; 
      
      utteranceRef.current = utterance;
      
      const voices = window.speechSynthesis.getVoices();
      const findVoice = () => {
        const neural = voices.find(v => (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Online')) && v.lang.startsWith('en'));
        if (neural) return neural;
        const premium = voices.find(v => (v.name.includes('Google') || v.name.includes('Premium') || v.name.includes('Enhanced')) && v.lang.startsWith('en'));
        if (premium) return premium;
        const desktop = voices.find(v => (v.name.includes('Microsoft') || v.name.includes('Samantha') || v.name.includes('Daniel')) && v.lang.startsWith('en'));
        if (desktop) return desktop;
        return voices.find(v => v.lang.startsWith('en-US')) || voices.find(v => v.lang.startsWith('en')) || voices[0];
      };

      const targetVoice = findVoice();
      if (targetVoice) {
        utterance.voice = targetVoice;
        utterance.pitch = (targetVoice.name.includes('Google') || targetVoice.name.includes('Natural')) ? 1.0 : 1.02;
      }
      
      utterance.onstart = () => setIsReading(true);
      utterance.onend = () => speakNextChunk(index + 1);
      utterance.onerror = (e) => {
        console.error("Speech Error on chunk", index, e);
        // On error, try next chunk anyway to be resilient
        speakNextChunk(index + 1);
      };

      window.speechSynthesis.speak(utterance);
      // Force state immediately to prevent next interval from cutting us off
      setIsReading(true);
    };

    speakNextChunk(0);
  };

  // Pre-load voices trigger for better browser compatibility
  useEffect(() => {
    window.speechSynthesis.getVoices();
    const loadVoices = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsReading(false);
  };

  // Camera Management
  const startCamera = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Camera API is not supported in this browser environment.");
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment', 
          width: { ideal: 1280 }, 
          height: { ideal: 720 } 
        } 
      });
      
      setStream(mediaStream);
      setIsCameraActive(true);
      setMode('auto');
      setAutoMode(true);
      setError(null);
      speak("System initialized Smart Sense mode active");
    } catch (err: any) {
      console.error("Camera Access Error:", err);
      if (err.name === 'NotAllowedError') {
        setError("Camera permission denied. Please allow camera access in your browser settings.");
      } else {
        setError("Could not start camera. Please ensure no other app is using it.");
      }
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsCameraActive(false);
    }
  };

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  }, []);

  const performAnalysis = async () => {
    if (!isCameraActive || isAnalyzing || !mode) return;
    
    const frame = captureFrame();
    if (!frame) return;

    setIsAnalyzing(true);
    const analysis = await analyzeFrame(frame, mode);
    
    // UI Update: Highlight detected type labels in results sidebar
    if (analysis.analysis?.type && analysis.analysis.type !== 'unknown') {
      const detectedLabel = analysis.analysis.type === 'text' ? 'reading' : analysis.analysis.type;
      if (mode === 'auto') {
        // We just stay in auto but log/announce detection
        // No longer switching the actual mode state as per request to keep only Smart Sense
      }
    }

    // Haptic feedback if position becomes valid
    if (analysis.positioningValid && !result?.positioningValid) {
      if ('vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }
    }

    setResult(analysis);
    setIsAnalyzing(false);

    // Build consolidated feedback string
    let feedbackParts: string[] = [];

    // 1. Precise Guidance (Throttled)
    if (!analysis.positioningValid) {
      const now = Date.now();
      if (analysis.guidance !== lastGuidanceAnnounced.current || (now - lastGuidanceTime.current > 4500)) {
        let guidanceText = analysis.guidance;
        const hints = analysis.positioningHints;
        const directHints = [];
        if (hints.up) directHints.push("Move up.");
        if (hints.down) directHints.push("Move down.");
        if (hints.left) directHints.push("Move left.");
        if (hints.right) directHints.push("Move right.");
        if (hints.zoomIn) directHints.push("Closer.");
        if (hints.zoomOut) directHints.push("Back.");
        if (hints.tiltForward) directHints.push("Tilt forward.");
        if (hints.tiltBackward) directHints.push("Tilt backward.");
        if (hints.tiltLeft) directHints.push("Rotate left.");
        if (hints.tiltRight) directHints.push("Rotate right.");
        
        if (directHints.length > 0) {
          guidanceText = `${directHints.join(' ')} ${guidanceText}`;
        }

        feedbackParts.push(guidanceText);
        lastGuidanceAnnounced.current = analysis.guidance;
        lastGuidanceTime.current = now;
      }
    } else {
      lastGuidanceAnnounced.current = null;
    }

    // 2. Direct Content Delivery (Immediate Verbatim)
    if (analysis.statusAnnounced) {
      feedbackParts.push(analysis.statusAnnounced);
    } else {
      const hasContent = !!(analysis.analysis?.content || analysis.analysis?.description || analysis.analysis?.tableData || analysis.analysis?.interpretedSymbols);
      
      if (hasContent) {
        const pageNumber = analysis.analysis?.pageNumber;
        if (pageNumber) {
          feedbackParts.push(`Page ${pageNumber}.`);
        }

        if (analysis.analysis?.content) {
          feedbackParts.push(analysis.analysis.content);
        } 
        
        if (analysis.analysis?.description) {
          feedbackParts.push(analysis.analysis.description);
        }

        if (analysis.analysis?.tableData && Array.isArray(analysis.analysis.tableData)) {
          const tableContent = (analysis.analysis.tableData as string[][])
            .map((row, idx) => `Row ${idx + 1}: ${row.join(', ')}`)
            .join('. ');
          feedbackParts.push(tableContent);
        }

        if (analysis.analysis?.interpretedSymbols && Array.isArray(analysis.analysis.interpretedSymbols)) {
          const symbolsContent = (analysis.analysis.interpretedSymbols as any[])
            .map(s => `${s.symbol}. ${s.meaning}.${s.pronunciationGuide ? ` ${s.pronunciationGuide}.` : ''}`)
            .join(' ');
          feedbackParts.push(symbolsContent);
        }
      }
    }

    // Immediate synthesis
    if (feedbackParts.length > 0) {
      const fullSpeech = feedbackParts.join('  ');
      
      // Prevent repeating the exact same long verbatim content if nothing has changed
      // This allows guidance to repeat (since it has its own throttle) but blocks
      // the document from being read over and over if the camera is still.
      const isVerbatimContent = !!(analysis.analysis?.content || analysis.analysis?.tableData);
      if (isVerbatimContent && fullSpeech.trim() === lastSpokenContentFingerprint.current?.trim()) {
        return; 
      }

      lastSpokenContentFingerprint.current = fullSpeech.trim();
      speak(fullSpeech);

      // If we found verbatim content, pause future scans until the user manually triggers again
      if (isVerbatimContent) {
        setIsAnalysisPaused(true);
      }
    }
  };

  // Initial Greeting
  useEffect(() => {
    const timer = setTimeout(() => {
      speak("Welcome to IBRA AI Please tap the center of the screen to initialize your camera and begin scanning your documents");
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Auto-analysis loop
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    
    const runAnalysis = async () => {
      if (autoMode && isCameraActive && !isAnalyzing && !isAnalysisPaused) {
        await performAnalysis();
      }
      // Schedule next check
      timeout = setTimeout(runAnalysis, 1000);
    };

    if (autoMode && isCameraActive) {
      runAnalysis();
    }

    return () => clearTimeout(timeout);
  }, [autoMode, isCameraActive]);

  useEffect(() => {
    return () => {
      stopCamera();
      stopSpeaking();
    };
  }, []);

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setResult(null);
    stopSpeaking();
    speak(`Switched to ${newMode} mode.`);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg lg:grid lg:grid-cols-[240px_1fr_280px] lg:grid-rows-[60px_1fr_80px]">
      {/* Header */}
      <header className="flex-none h-[60px] lg:col-span-3 bg-panel border-b border-border-main flex items-center justify-between px-4 lg:px-6 z-20">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-accent rounded-sm flex items-center justify-center">
            <Scan className="w-4 h-4 text-black" />
          </div>
          <h1 className="font-bold tracking-[2px] text-accent text-sm uppercase hidden sm:block">IBRA AI</h1>
          <h1 className="font-bold tracking-[2px] text-accent text-xs uppercase sm:hidden">IBRA AI</h1>
        </div>
        <div className="flex items-center gap-4 lg:gap-8 text-[10px] font-mono text-text-dim">
          <div className="hidden md:flex items-center gap-2">
            <span className={isCameraActive ? "text-accent" : "text-red-500"}>●</span>
            <span>CAM: {isCameraActive ? '4K/60FPS' : 'OFFLINE'}</span>
          </div>
          <button 
            onClick={() => {
              setIsMuted(!isMuted);
              if (isMuted) speak("Voice guidance enabled.");
            }} 
            className={`flex items-center gap-2 px-2 py-1 lg:px-3 lg:py-1 rounded border ${isMuted ? 'border-red-500/50 text-red-400' : 'border-accent/50 text-accent'} transition-colors`}
            aria-label={isMuted ? "Enable Voice Guidance" : "Disable Voice Guidance"}
          >
            {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
            <span className="uppercase text-[9px] lg:text-[10px]">{isMuted ? 'Off' : 'On'}</span>
          </button>
          
          <button 
            onClick={() => setShowSidebars(!showSidebars)}
            className="lg:hidden p-2 text-text-dim hover:text-accent transition-colors"
          >
            <Settings className={`w-4 h-4 ${showSidebars ? 'text-accent rotate-90' : ''} transition-transform`} />
          </button>
          
          <div className="hidden lg:flex items-center gap-2">
            <span>LATENCY: 14MS</span>
          </div>
        </div>
      </header>

      {/* Sidebar Left: Modules / Modes */}
      <aside className={`${showSidebars ? 'fixed inset-0 z-30 pt-20 bg-bg' : 'hidden'} lg:relative lg:flex lg:flex-col lg:pt-0 lg:z-0 bg-panel border-r border-border-main p-4 gap-3 overflow-y-auto w-full lg:w-auto`}>
        <div className="flex justify-between items-center lg:block">
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-dim mb-2">Core Engine</p>
          <button onClick={() => setShowSidebars(false)} className="lg:hidden p-2"><X className="w-4 h-4" /></button>
        </div>
        <button
          onClick={() => isCameraActive && setMode('auto')}
          disabled={!isCameraActive}
          className={`flex flex-col p-4 rounded-lg border text-left transition-all group ${
            mode === 'auto' 
              ? 'border-accent bg-accent/5 ring-1 ring-accent/20' 
              : 'border-border-main bg-bg/50 hover:border-text-dim opacity-50 grayscale'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-mono uppercase tracking-tighter text-text-dim">Module 01</span>
            <Scan className={`w-4 h-4 ${mode === 'auto' ? 'text-accent' : 'text-text-dim'}`} />
          </div>
          <span className={`text-sm font-black uppercase tracking-widest ${mode === 'auto' ? 'text-accent' : 'text-text-main'}`}>Smart Sense</span>
          <p className="text-[9px] text-text-dim leading-normal mt-2">
            Automated neural detection for documents, music, objects, and data structures.
          </p>
        </button>
        
        <div className="mt-auto p-3 rounded-lg border border-border-main bg-bg/30">
          <p className="text-[9px] font-mono text-text-dim uppercase mb-2">System Status</p>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px]">
              <span>CPU</span>
              <span className="text-accent">12%</span>
            </div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-accent w-[12%]" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Viewport: Viewfinder */}
      <main className="flex-1 relative lg:flex items-center justify-center p-2 lg:p-5 bg-black overflow-hidden group">
        {!isCameraActive ? (
          <div 
            onClick={startCamera}
            className="flex flex-col items-center gap-6 text-center cursor-pointer group p-12 transition-all"
            role="button"
            aria-label="Initialize Camera"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-24 h-24 rounded-full border border-border-main flex items-center justify-center bg-panel/50 group-hover:border-accent group-hover:bg-accent/5 transition-all"
            >
              <Camera className="w-10 h-10 opacity-30 group-hover:opacity-100 group-hover:text-accent transition-all" />
            </motion.div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white mb-2">Welcome to IBRA AI</h2>
              <p className="text-xs text-text-dim max-w-xs mb-8 uppercase tracking-widest leading-loose">
                Tap anywhere in this area to initialize your camera and begin scanning.
              </p>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); startCamera(); }}
              className="px-8 py-4 bg-accent text-black font-black text-xs tracking-[3px] rounded hover:scale-105 active:scale-95 transition-transform flex items-center gap-3 shadow-[0_0_30px_rgba(0,255,136,0.3)]"
            >
              <Play className="w-4 h-4 fill-current ml-1" />
              START SYSTEM
            </button>
          </div>
        ) : (
          <div className="relative w-full h-full max-w-4xl max-h-[600px] rounded-xl border-2 border-border-main overflow-hidden">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover grayscale opacity-80" />
            <canvas ref={canvasRef} className="hidden" />
            
            {/* High Density Overlays */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Corner Markers */}
              <div className="absolute top-4 left-4 marker tl" />
              <div className="absolute top-4 right-4 marker tr" />
              <div className="absolute bottom-4 left-4 marker bl" />
              <div className="absolute bottom-4 right-4 marker br" />

              {/* Guide Box */}
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[80%] border-2 rounded-lg flex items-center justify-center transition-all duration-500 ${
                result?.positioningValid ? 'border-accent border-solid shadow-[0_0_30px_rgba(0,255,136,0.2)]' : 'border-dashed border-accent/20'
              }`}>
                {result?.positioningValid && (
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="absolute -top-10 bg-accent text-black text-[10px] font-bold px-3 py-1 rounded-sm uppercase tracking-tighter"
                  >
                    POSITION LOCKED
                  </motion.div>
                )}

                {/* Directional Overlay Hints */}
                {result && !result.positioningValid && result.positioningHints && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <AnimatePresence>
                      {result.positioningHints.up && (
                        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: -40, opacity: 1 }} exit={{ opacity: 0 }} className="absolute -top-12 text-accent">
                          <ArrowUp className="w-8 h-8 animate-bounce" />
                        </motion.div>
                      )}
                      {result.positioningHints.down && (
                        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 40, opacity: 1 }} exit={{ opacity: 0 }} className="absolute -bottom-12 text-accent">
                          <ArrowDown className="w-8 h-8 animate-bounce" />
                        </motion.div>
                      )}
                      {result.positioningHints.left && (
                        <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: -40, opacity: 1 }} exit={{ opacity: 0 }} className="absolute -left-12 text-accent">
                          <ArrowLeft className="w-8 h-8 animate-bounce" />
                        </motion.div>
                      )}
                      {result.positioningHints.right && (
                        <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 40, opacity: 1 }} exit={{ opacity: 0 }} className="absolute -right-12 text-accent">
                          <ArrowRight className="w-8 h-8 animate-bounce" />
                        </motion.div>
                      )}
                      {result.positioningHints.zoomIn && (
                        <motion.div initial={{ scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="absolute text-accent">
                          <Maximize className="w-12 h-12 animate-pulse" />
                        </motion.div>
                      )}
                      {result.positioningHints.zoomOut && (
                        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="absolute text-accent">
                          <Minimize className="w-12 h-12 animate-pulse" />
                        </motion.div>
                      )}
                      {(result.positioningHints.tiltForward || result.positioningHints.tiltBackward || result.positioningHints.tiltLeft || result.positioningHints.tiltRight) && (
                        <motion.div initial={{ rotate: -45, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ opacity: 0 }} className="absolute text-warn">
                           <RefreshCw className="w-10 h-10 animate-spin" style={{ animationDuration: '3s' }} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              {/* Scanning Bar */}
              {isAnalyzing && (
                <motion.div 
                  initial={{ top: '10%' }}
                  animate={{ top: '90%' }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="absolute left-0 right-0 h-0.5 bg-accent shadow-[0_0_20px_var(--color-accent)] z-10"
                />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Sidebar Right: Data & Analysis */}
      <aside className={`${showSidebars ? 'fixed inset-0 z-30 pt-[240px] bg-bg/95' : 'hidden'} lg:relative lg:flex lg:flex-col lg:pt-0 lg:z-0 lg:border-l bg-panel border-border-main p-4 overflow-y-auto space-y-6 scrollbar-hide`}>
        <div className="space-y-4 pb-20 lg:pb-0">
          <div className="border-b border-border-main pb-4">
            <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-widest flex justify-between items-center mb-4">
              Metadata {result?.analysis?.pageNumber && <span className="text-accent font-mono bg-accent/10 px-1.5 py-0.5 rounded">P.{result.analysis.pageNumber}</span>}
            </h3>
            {result?.analysis ? (
              <div className="space-y-3">
                <div className="text-xs">
                  <span className="text-text-dim block mb-1">Context</span>
                  <div className="flex gap-2">
                    <span className="bg-white/5 px-2 py-0.5 rounded font-mono text-[9px] uppercase border border-border-main">{result.analysis.type}</span>
                    <span className="text-text-dim font-mono italic text-[9px]">v1.0.4-L</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-dim italic">Waiting for analysis...</p>
            )}
          </div>

          {result?.analysis?.content && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Parsed Fragment</h3>
              <div className="text-[11px] leading-relaxed text-text-main font-serif space-y-2 opacity-80 max-h-48 overflow-y-auto">
                {result.analysis.content.split('\n').filter(l => l.trim()).map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            </div>
          )}

          {result?.analysis?.tableData && result.analysis.tableData.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Table Parser Output</h3>
              <div className="overflow-x-auto rounded border border-border-main scrollbar-hide">
                <table className="w-full text-[10px] font-mono border-collapse">
                  <tbody>
                    {result.analysis.tableData.map((row: string[], ri: number) => (
                      <tr key={ri} className="border-b border-border-main last:border-0">
                        {row.map((cell: string, ci: number) => (
                          <td key={ci} className="p-2 border-r border-border-main last:border-0 bg-bg/30">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result?.analysis?.interpretedSymbols && result.analysis.interpretedSymbols.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Symbol Parser</h3>
              <div className="space-y-2">
                {result.analysis.interpretedSymbols.map((sym, i) => (
                  <div key={i} className="p-2 rounded border border-border-main bg-bg/50 flex items-center gap-3">
                    <span className="text-xl font-mono text-accent">{sym.symbol}</span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold truncate">{sym.meaning}</p>
                      <p className="text-[8px] text-text-dim truncate">{sym.pronunciationGuide}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result?.analysis?.description && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Vision Output</h3>
              <p className="text-[10px] bg-bg p-2 rounded border border-border-main opacity-70 italic leading-normal">
                {result.analysis.description}
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Footer: Controls & Guidance */}
      <footer className="flex-none h-[80px] lg:col-span-3 bg-bg border-t border-border-main flex items-center justify-between px-4 lg:px-10 relative z-40">
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-panel border border-border-main rounded text-[11px] font-bold">
            <span className={result?.positioningValid ? "text-accent animate-pulse" : "text-warn"}>●</span>
            <span className="uppercase tracking-tighter">
              {result?.positioningValid ? 'READ-READY: OK' : (result?.guidance || 'IDLE')}
            </span>
          </div>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-4 lg:gap-6">
          <button 
             onClick={() => {
               if (isAnalysisPaused) {
                 lastSpokenContentFingerprint.current = null;
                 setIsAnalysisPaused(false);
               } else {
                 setAutoMode(!autoMode);
               }
             }}
             className={`px-4 py-2 lg:px-6 lg:py-3 rounded-full border flex items-center gap-2 lg:gap-3 transition-all ${
               (autoMode && !isAnalysisPaused) 
                ? 'border-accent text-accent bg-accent/5 ring-1 ring-accent/20' 
                : 'border-white/20 text-text-dim hover:border-white/40'
             }`}
          >
            {(autoMode && !isAnalysisPaused) ? <Pause className="w-3 h-3 lg:w-4 lg:h-4 fill-current" /> : <Play className="w-3 h-3 lg:w-4 lg:h-4 fill-current" />}
            <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
              {isAnalysisPaused ? 'Next Scan' : (autoMode ? 'Auto-Scan' : 'Idle')}
            </span>
          </button>
          
          <button 
             onClick={() => speak(result?.analysis?.content || result?.analysis?.description || "No content to repeat.")}
             disabled={isReading}
             className="flex items-center gap-2 text-text-dim hover:text-accent transition-colors disabled:opacity-20 group"
             aria-label="Repeat last reading"
          >
            <RotateCcw className="w-3 h-3 lg:w-4 lg:h-4 group-hover:rotate-[-45deg] transition-transform" />
            <span className="text-[9px] font-bold uppercase tracking-tighter hidden sm:inline">Repeat</span>
          </button>
        </div>

        <div className="flex items-center gap-1 lg:gap-1.5 opacity-50 overflow-hidden">
          {[0.6, 1, 0.4, 0.8, 0.5].map((h, i) => (
            <motion.div
              key={i}
              animate={isReading ? { height: ['40%', '100%', '40%'] } : {}}
              transition={{ repeat: Infinity, duration: 0.5 + i * 0.1 }}
              className="w-0.5 bg-accent"
              style={{ height: `${h * 20}px` }}
            />
          ))}
        </div>
      </footer>

      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 text-white px-6 py-3 rounded-full border border-red-500 flex items-center gap-3 backdrop-blur-md shadow-2xl">
          <AlertCircle className="w-5 h-5" />
          <span className="text-xs font-bold uppercase tracking-widest">{error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}
