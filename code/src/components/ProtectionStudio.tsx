import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  FileImage,
  Link2,
  Maximize2,
  Monitor,
  Move,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  ScanText,
  ShieldAlert,
  SlidersHorizontal,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { detectSensitiveData } from '../engine/detector.ts';
import { renderPresenterMonitor, renderProtectedOutput } from '../engine/masker.ts';
import {
  computeFrameSignature,
  hasFrameChanged,
  runTesseractOcrScan,
  warmUpOcrWorker,
} from '../engine/ocr.ts';
import {
  qrHitsToDetections,
  scanQrCodesOnCanvas,
  type QrScanHit,
} from '../engine/qrDetector.ts';
import { renderDemoScreen, SIM_HEIGHT, SIM_WIDTH } from '../engine/simulator.ts';
import { apiRequest } from '../lib/api.ts';
import type {
  BoundingBox,
  DetectedItem,
  DetectionCategory,
  ManualMaskRegion,
  MaskingStyle,
  MonitoringSession,
  OcrToken,
  ProtectionPolicy,
  ReviewAction,
  SourceProfile,
  SystemConfig,
  UserProfile,
} from '../types/blurguard.ts';

interface ProtectionStudioProps {
  user: UserProfile;
  policies: ProtectionPolicy[];
  sources: SourceProfile[];
  config: SystemConfig;
  selectedSourceId: string;
  onSelectSourceId: (id: string) => void;
  panicProtect: boolean;
  onTogglePanicProtect: (next: boolean) => void;
  onSessionSynced: () => void;
}

const FRIENDLY_CATEGORIES: Record<DetectionCategory, string> = {
  api_key: 'API Key',
  password: 'Password',
  credit_card: 'Credit Card',
  ssn: 'Sensitive ID',
  email: 'Email',
  phone: 'Phone Number',
  confidential: 'Confidential Note',
  qr_code: 'QR Code',
  url: 'Link / URL',
  custom: 'Custom Rule',
};

function getDetectionSignature(category: DetectionCategory, text: string): string {
  const norm = text.trim().toLowerCase();
  if (category === 'url') {
    const cleaned = norm.replace(/^https?:\/\//, '').replace(/[.,;)]+$/, '');
    return `url:${cleaned.slice(0, 42)}`;
  }
  return `${category}:${norm}`;
}

function createBackgroundTickerWorker(): Worker | null {
  try {
    const script = `
      let timer = null;
      self.onmessage = (e) => {
        if (e.data === 'start') {
          if (timer) clearInterval(timer);
          timer = setInterval(() => self.postMessage('tick'), 33);
        } else if (e.data === 'stop') {
          if (timer) clearInterval(timer);
          timer = null;
        }
      };
    `;
    const blob = new Blob([script], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  } catch {
    return null;
  }
}

function playAlertBeep(): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, ctx.currentTime);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {
    // Ignore audio context restriction
  }
}

export const ProtectionStudio: React.FC<ProtectionStudioProps> = ({
  user,
  policies,
  sources,
  config,
  selectedSourceId,
  panicProtect,
  onTogglePanicProtect,
  onSessionSynced,
}) => {
  const canOverrideMasks = user.role === 'Administrator' || (user.permissions?.overrideMasks ?? true);
  const canTriggerPanic = user.role === 'Administrator' || (user.permissions?.triggerPanic ?? true);

  const activeSource = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) || sources[0],
    [sources, selectedSourceId],
  );

  const boundPolicy = useMemo(() => {
    const matched = policies.find((p) => p.id === activeSource?.policyId);
    return matched || policies.find((p) => p.isDefault) || policies[0];
  }, [policies, activeSource]);

  const [overridePolicyId, setOverridePolicyId] = useState<string>('source_bound');
  const activePolicy = useMemo(() => {
    if (overridePolicyId !== 'source_bound') {
      const found = policies.find((p) => p.id === overridePolicyId);
      if (found) return found;
    }
    return boundPolicy;
  }, [overridePolicyId, policies, boundPolicy]);

  const [compareOriginal, setCompareOriginal] = useState<boolean>(false);
  const [maskOverride, setMaskOverride] = useState<MaskingStyle | 'policy'>('policy');
  const [monitorActive, setMonitorActive] = useState<boolean>(true);
  const [showTools, setShowTools] = useState<boolean>(false);

  const [session, setSession] = useState<MonitoringSession | null>(null);
  const [framesAnalyzed, setFramesAnalyzed] = useState<number>(1);
  const [liveFps, setLiveFps] = useState<number>(0);
  const [scanLatencyMs, setScanLatencyMs] = useState<number>(12);

  const [ocrTokens, setOcrTokens] = useState<OcrToken[]>([]);
  const [qrHits, setQrHits] = useState<QrScanHit[]>([]);
  const [ocrRunning, setOcrRunning] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [overrides, setOverrides] = useState<Record<string, ReviewAction>>({});
  const [ignoredSignatures, setIgnoredSignatures] = useState<string[]>([]);
  const [bboxOverrides, setBboxOverrides] = useState<Record<string, BoundingBox>>({});
  const [styleOverrides, setStyleOverrides] = useState<Record<string, MaskingStyle>>({});
  const [feedbackByDetId, setFeedbackByDetId] = useState<
    Record<string, 'correct' | 'false_positive'>
  >({});
  const [manualRegions, setManualRegions] = useState<ManualMaskRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [drawManualMode, setDrawManualMode] = useState<boolean>(false);
  const [draftBox, setDraftBox] = useState<BoundingBox | null>(null);
  const [canvasCursor, setCanvasCursor] = useState<'crosshair' | 'move' | 'nwse-resize' | 'default'>(
    'default',
  );
  const [protectedCursor, setProtectedCursor] = useState<'pointer' | 'default'>('default');
  const [blurPrompt, setBlurPrompt] = useState<{
    detId: string;
    signature: string;
    category: DetectionCategory;
    maskedPreview: string;
    maskingStyle: MaskingStyle;
  } | null>(null);
  const [mirrorGuideOpen, setMirrorGuideOpen] = useState<boolean>(false);
  const promptedSignaturesRef = useRef<Set<string>>(new Set());
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const interactionRef = useRef<{
    mode: 'draw' | 'move' | 'resize';
    targetKind: 'manual' | 'detection' | 'new';
    targetId: string;
    startPt: { x: number; y: number };
    initialBox: BoundingBox;
  } | null>(null);

  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const protectedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const protectedContainerRef = useRef<HTMLDivElement | null>(null);
  const monitorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadedImgRef = useRef<HTMLImageElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loggedKeysRef = useRef<Set<string>>(new Set());

  const ocrInFlightRef = useRef<boolean>(false);
  const lastFrameSigRef = useRef<Uint8Array | null>(null);
  const lastOcrAtRef = useRef<number>(0);
  const fpsCounterRef = useRef<number>(0);
  const totalFramesRef = useRef<number>(1);
  const sessionRef = useRef<MonitoringSession | null>(null);
  const prevPanicRef = useRef<boolean>(panicProtect);

  const [streamKind, setStreamKind] = useState<'none' | 'screen' | 'camera'>('none');
  const [hasUploadedImage, setHasUploadedImage] = useState(false);

  const hasLiveStream = streamKind !== 'none';

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    void warmUpOcrWorker();
  }, []);

  // Track emergency panic triggers on active session
  useEffect(() => {
    if (panicProtect && !prevPanicRef.current && sessionRef.current) {
      const current = sessionRef.current;
      const nextPanicCount = current.panicTriggeredCount + 1;
      void apiRequest(`/api/sessions/${current.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ panicTriggeredCount: nextPanicCount }),
      }).catch(() => {});
    }
    prevPanicRef.current = panicProtect;
  }, [panicProtect]);

  const detections: DetectedItem[] = useMemo(() => {
    if (!activePolicy) return [];
    const sourceLabel =
      streamKind === 'screen'
        ? 'Screen Share'
        : streamKind === 'camera'
          ? 'Live Camera'
          : hasUploadedImage
            ? 'Uploaded Screenshot'
            : 'Demo Screen';
    const textDetections = detectSensitiveData(ocrTokens, activePolicy, sourceLabel, overrides, {
      minConfidence: config.confidenceThreshold ?? 0,
      bboxOverrides,
      styleOverrides,
    });
    const qrDetections = qrHitsToDetections(qrHits, activePolicy, sourceLabel, overrides, {
      bboxOverrides,
      styleOverrides,
    });
    const combined = [...qrDetections, ...textDetections];
    if (ignoredSignatures.length === 0) return combined;
    const ignoredSet = new Set(ignoredSignatures);
    return combined.map((det) => {
      if (overrides[det.id] === 'manual_masked') return det;
      if (ignoredSet.has(getDetectionSignature(det.category, det.text))) {
        return { ...det, status: 'approved_visible' as ReviewAction };
      }
      return det;
    });
  }, [
    ocrTokens,
    qrHits,
    activePolicy,
    streamKind,
    hasUploadedImage,
    overrides,
    ignoredSignatures,
    config.confidenceThreshold,
    bboxOverrides,
    styleOverrides,
  ]);

  const renderStateRef = useRef({
    detections,
    manualRegions,
    activePolicy,
    panicProtect,
    monitorActive,
    maskOverride,
    draftBox,
    selectedRegionId,
  });
  renderStateRef.current = {
    detections,
    manualRegions,
    activePolicy,
    panicProtect,
    monitorActive,
    maskOverride,
    draftBox,
    selectedRegionId,
  };

  const getSourceCanvas = useCallback(() => {
    if (!sourceCanvasRef.current) {
      sourceCanvasRef.current = document.createElement('canvas');
      sourceCanvasRef.current.width = SIM_WIDTH;
      sourceCanvasRef.current.height = SIM_HEIGHT;
    }
    return sourceCanvasRef.current;
  }, []);

  const drawCurrentCanvases = useCallback(() => {
    const srcCanvas = getSourceCanvas();
    const state = renderStateRef.current;
    if (!state.activePolicy) return;

    if (protectedCanvasRef.current) {
      renderProtectedOutput(
        srcCanvas,
        protectedCanvasRef.current,
        state.detections,
        state.manualRegions,
        state.activePolicy,
        {
          panicProtect: state.panicProtect,
          protectionActive: state.monitorActive,
          overrideMaskStyle: state.maskOverride,
        },
      );
    }

    if (monitorCanvasRef.current) {
      renderPresenterMonitor(
        srcCanvas,
        monitorCanvasRef.current,
        state.detections,
        state.manualRegions,
        state.activePolicy,
        state.draftBox,
        state.selectedRegionId,
      );
    }
  }, [getSourceCanvas]);

  // Render default demo preview or uploaded image when not live-streaming
  useEffect(() => {
    if (hasLiveStream) return;
    const srcCanvas = getSourceCanvas();

    if (hasUploadedImage && uploadedImgRef.current) {
      const img = uploadedImgRef.current;
      srcCanvas.width = Math.min(1280, img.naturalWidth || SIM_WIDTH);
      srcCanvas.height = Math.round(
        (srcCanvas.width / (img.naturalWidth || SIM_WIDTH)) * (img.naturalHeight || SIM_HEIGHT),
      );
      const ctx = srcCanvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0, srcCanvas.width, srcCanvas.height);
      drawCurrentCanvases();
      return;
    }

    const t0 = performance.now();
    const tokens = renderDemoScreen(srcCanvas);
    setOcrTokens(tokens);
    setScanLatencyMs(Math.max(4, Math.round(performance.now() - t0)));
    drawCurrentCanvases();
  }, [hasLiveStream, hasUploadedImage, getSourceCanvas, drawCurrentCanvases]);

  // Immediately re-render canvases when policy/masks/compare state updates
  useEffect(() => {
    drawCurrentCanvases();
  }, [
    detections,
    manualRegions,
    activePolicy,
    panicProtect,
    monitorActive,
    maskOverride,
    draftBox,
    selectedRegionId,
    compareOriginal,
    drawCurrentCanvases,
  ]);

  // Background-safe 30fps Web Worker + rAF video pump so monitoring keeps working across ANY opened application
  useEffect(() => {
    if (!hasLiveStream) {
      setLiveFps(0);
      return;
    }

    let rafId = 0;
    const worker = createBackgroundTickerWorker();

    const processVideoFrame = () => {
      const srcCanvas = getSourceCanvas();
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        if (srcCanvas.width !== video.videoWidth || srcCanvas.height !== video.videoHeight) {
          srcCanvas.width = video.videoWidth;
          srcCanvas.height = video.videoHeight;
        }
        const sCtx = srcCanvas.getContext('2d');
        if (sCtx) {
          sCtx.drawImage(video, 0, 0, srcCanvas.width, srcCanvas.height);
          fpsCounterRef.current += 1;
          totalFramesRef.current += 1;
        }
      }
      drawCurrentCanvases();
    };

    const fpsTimer = window.setInterval(() => {
      setLiveFps(fpsCounterRef.current);
      fpsCounterRef.current = 0;
      setFramesAnalyzed(totalFramesRef.current);
    }, 1000);

    const renderLoop = () => {
      processVideoFrame();
      rafId = window.requestAnimationFrame(renderLoop);
    };
    rafId = window.requestAnimationFrame(renderLoop);

    // Web Worker continues firing at 30fps even when user switches to VS Code, Chrome, or another app
    if (worker) {
      worker.onmessage = () => {
        if (document.hidden) {
          processVideoFrame();
        }
      };
      worker.postMessage('start');
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(fpsTimer);
      if (worker) {
        worker.postMessage('stop');
        worker.terminate();
      }
    };
  }, [hasLiveStream, getSourceCanvas, drawCurrentCanvases]);

  const executeOcrOnce = useCallback(async () => {
    if (ocrInFlightRef.current) return;
    const srcCanvas = getSourceCanvas();
    if (srcCanvas.width === 0 || srcCanvas.height === 0) return;

    const maxWidth =
      config.performanceMode === 'high_accuracy'
        ? 1520
        : config.performanceMode === 'low_cpu'
          ? 960
          : 1360;

    ocrInFlightRef.current = true;
    setOcrRunning(true);
    try {
      const [result, detectedQrs] = await Promise.all([
        runTesseractOcrScan(srcCanvas, {
          grayscale: config.preprocessGrayscale,
          contrastBoost: config.preprocessContrastBoost,
          maxWidth,
        }),
        scanQrCodesOnCanvas(srcCanvas, maxWidth),
      ]);
      setOcrTokens(result.tokens);
      setQrHits(detectedQrs);
      setScanLatencyMs(result.durationMs);
      lastOcrAtRef.current = performance.now();
      totalFramesRef.current += 1;
      setFramesAnalyzed(totalFramesRef.current);
    } catch {
      setNotice('Could not scan this frame. Try another image or screen.');
    } finally {
      ocrInFlightRef.current = false;
      setOcrRunning(false);
    }
  }, [
    config.performanceMode,
    config.preprocessContrastBoost,
    config.preprocessGrayscale,
    getSourceCanvas,
  ]);

  // Continuous background-safe OCR + fast QR scanner during active live capture
  useEffect(() => {
    if (!hasLiveStream || !monitorActive) return;

    let cancelled = false;
    lastFrameSigRef.current = null;
    lastOcrAtRef.current = 0;
    const bgWorker = createBackgroundTickerWorker();

    const evaluateAndScan = async () => {
      if (cancelled) return;
      const srcCanvas = getSourceCanvas();
      const video = videoRef.current;

      if (video && video.readyState >= 2 && srcCanvas.width > 0) {
        const sig = computeFrameSignature(srcCanvas);
        const now = performance.now();
        const isFirstScan = lastOcrAtRef.current === 0;
        const modeIntervalFloor =
          config.performanceMode === 'high_accuracy'
            ? 250
            : config.performanceMode === 'low_cpu'
              ? 1000
              : 450;
        const minRescanMs = Math.max(modeIntervalFloor, Math.min(config.scanIntervalMs, 1500));
        const changed = hasFrameChanged(lastFrameSigRef.current, sig, 0.014);
        const stale = now - lastOcrAtRef.current >= 2400;

        // Fast QR-only refresh if OCR is still busy so QR codes blur immediately
        if (ocrInFlightRef.current && changed) {
          const fastQrs = await scanQrCodesOnCanvas(srcCanvas, 960);
          if (!cancelled) setQrHits(fastQrs);
          return;
        }

        if (
          !ocrInFlightRef.current &&
          (isFirstScan || (changed && now - lastOcrAtRef.current >= minRescanMs) || stale)
        ) {
          lastFrameSigRef.current = sig;
          await executeOcrOnce();
        }
      }
    };

    let tickCount = 0;
    if (bgWorker) {
      bgWorker.onmessage = () => {
        tickCount += 1;
        if (tickCount % 4 === 0) {
          void evaluateAndScan();
        }
      };
      bgWorker.postMessage('start');
    } else {
      const intervalId = window.setInterval(() => {
        void evaluateAndScan();
      }, 150);
      return () => {
        cancelled = true;
        window.clearInterval(intervalId);
      };
    }

    const immediateTimer = window.setTimeout(() => {
      void evaluateAndScan();
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(immediateTimer);
      bgWorker.postMessage('stop');
      bgWorker.terminate();
    };
  }, [hasLiveStream, monitorActive, config.scanIntervalMs, getSourceCanvas, executeOcrOnce]);

  // Periodically sync frame count to active monitoring session
  useEffect(() => {
    if (!hasLiveStream || !session || session.status !== 'active') return;
    const syncId = window.setInterval(() => {
      void apiRequest(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ framesProcessed: totalFramesRef.current }),
      }).catch(() => {});
    }, 2500);
    return () => window.clearInterval(syncId);
  }, [hasLiveStream, session]);

  // Stream newly detected sensitive items to backend + trigger desktop/sound alerts
  useEffect(() => {
    if (!session || session.status !== 'active' || detections.length === 0) return;
    const newItems = detections.filter((d) => {
      const dedupeKey = `${session.id}:${d.category}:${d.maskedPreview}`;
      return !loggedKeysRef.current.has(dedupeKey);
    });
    if (newItems.length === 0) return;

    for (const item of newItems) {
      loggedKeysRef.current.add(`${session.id}:${item.category}:${item.maskedPreview}`);
    }

    const criticalHits = newItems.filter((d) => d.riskLevel === 'Critical');
    if (criticalHits.length > 0 && config.enableDesktopAlerts) {
      setNotice(
        `Protected ${criticalHits.length} critical ${criticalHits[0].category.replace('_', ' ')} exposure(s) in real time.`,
      );
      if (config.enableSoundAlerts) {
        playAlertBeep();
      }
    }

    // Automatically show a non-intrusive popup asking if the user wants to keep or remove blur
    const promptCandidate =
      newItems.find(
        (d) =>
          d.status !== 'approved_visible' &&
          (d.category === 'url' || d.category === 'qr_code') &&
          !promptedSignaturesRef.current.has(getDetectionSignature(d.category, d.text)),
      ) ||
      newItems.find(
        (d) =>
          d.status !== 'approved_visible' &&
          !promptedSignaturesRef.current.has(getDetectionSignature(d.category, d.text)),
      );
    if (promptCandidate) {
      const sig = getDetectionSignature(promptCandidate.category, promptCandidate.text);
      promptedSignaturesRef.current.add(sig);
      setBlurPrompt({
        detId: promptCandidate.id,
        signature: sig,
        category: promptCandidate.category,
        maskedPreview: promptCandidate.maskedPreview,
        maskingStyle: promptCandidate.maskingStyle,
      });
    }

    const sourceLabel =
      streamKind === 'screen'
        ? 'Screen Share'
        : streamKind === 'camera'
          ? 'Live Camera'
          : 'Live Monitor';

    const entries = newItems.map((item) => ({
      sessionId: session.id,
      sourceName: sourceLabel,
      category: item.category,
      ruleName: item.ruleName,
      maskedSnippet: config.storeRedactedSnippetsOnly ? item.maskedPreview : item.text,
      confidence: item.confidence,
      riskLevel: item.riskLevel,
      actionTaken: item.status,
      maskingStyle: maskOverride === 'policy' ? item.maskingStyle : maskOverride,
      timestamp: new Date().toISOString(),
    }));

    void apiRequest('/api/logs', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }).then(() => onSessionSynced());
  }, [
    detections,
    session,
    streamKind,
    config.storeRedactedSnippetsOnly,
    config.enableDesktopAlerts,
    config.enableSoundAlerts,
    maskOverride,
    onSessionSynced,
  ]);

  const startActiveSession = useCallback(
    async (sourceLabel: string) => {
      if (!activePolicy || sessionRef.current?.status === 'active') return;
      try {
        const res = await apiRequest<{ session: MonitoringSession }>('/api/sessions', {
          method: 'POST',
          body: JSON.stringify({
            sourceId: activeSource?.id || 'app-vscode',
            sourceName: sourceLabel,
            policyId: activePolicy.id,
            policyName: activePolicy.name,
          }),
        });
        setSession(res.session);
        loggedKeysRef.current.clear();
        onSessionSynced();
      } catch {
        // Ignore transient errors
      }
    },
    [activePolicy, activeSource, onSessionSynced],
  );

  const endActiveSession = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    setSession(null);
    try {
      await apiRequest(`/api/sessions/${current.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'ended',
          endedAt: new Date().toISOString(),
          framesProcessed: totalFramesRef.current,
        }),
      });
      onSessionSynced();
    } catch {
      // Ignore
    }
  }, [onSessionSynced]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (sessionRef.current) {
        void apiRequest(`/api/sessions/${sessionRef.current.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'ended',
            endedAt: new Date().toISOString(),
            framesProcessed: totalFramesRef.current,
          }),
        }).catch(() => {});
      }
    };
  }, []);

  const handleTogglePauseMonitor = async () => {
    if (monitorActive) {
      setMonitorActive(false);
      if (session) {
        await apiRequest(`/api/sessions/${session.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'paused',
            framesProcessed: totalFramesRef.current,
          }),
        }).catch(() => {});
      }
      return;
    }

    setMonitorActive(true);
    if (session) {
      await apiRequest(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }).catch(() => {});
    }
  };

  const handleStopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStreamKind('none');
    void endActiveSession();
  }, [endActiveSession]);

  const handleStartScreenCapture = async () => {
    setNotice(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setNotice(
        'Screen capture is blocked in this embedded frame. Open the app in a standalone browser tab to monitor application windows or tabs.',
      );
      return;
    }
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const constrainedOptions = {
        video: {
          frameRate: { ideal: 30, max: 60 },
          displaySurface: 'window',
        },
        audio: false,
        monitorTypeSurfaces: 'exclude',
        selfBrowserSurface: 'exclude',
      } as unknown as DisplayMediaStreamOptions;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(constrainedOptions);
      } catch (err) {
        // Fallback only when an older browser rejects monitorTypeSurfaces/selfBrowserSurface TypeError
        if (err instanceof TypeError) {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30, max: 60 } },
            audio: false,
          });
        } else {
          throw err;
        }
      }

      const [videoTrack] = stream.getVideoTracks();
      const surface = (videoTrack?.getSettings() as { displaySurface?: string } | undefined)
        ?.displaySurface;
      if (surface === 'monitor') {
        stream.getTracks().forEach((t) => t.stop());
        setNotice(
          'Entire screen sharing is disabled. Please select an application window or browser tab.',
        );
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      totalFramesRef.current = 0;
      setFramesAnalyzed(0);
      setOcrTokens([]);
      setQrHits([]);
      setOverrides({});
      setIgnoredSignatures([]);
      setBlurPrompt(null);
      setMirrorGuideOpen(false);
      promptedSignaturesRef.current.clear();
      setStreamKind('screen');
      setHasUploadedImage(false);
      setMonitorActive(true);
      setNotice(
        'Live protection active — switch to your opened tab/window to scroll & type normally. Click any blurred box here to remove blur, or open Float Guard.',
      );
      await startActiveSession('Window / Tab Share');

      if (videoTrack) {
        videoTrack.onended = () => {
          setStreamKind('none');
          setMirrorGuideOpen(false);
          streamRef.current = null;
          void endActiveSession();
        };
      }
    } catch {
      setNotice('Window sharing cancelled.');
    }
  };

  const handleStartCameraCapture = async () => {
    setNotice(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setNotice('Live camera access is not available in this browser.');
      return;
    }
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      totalFramesRef.current = 0;
      setFramesAnalyzed(0);
      setOcrTokens([]);
      setQrHits([]);
      setOverrides({});
      setIgnoredSignatures([]);
      setBlurPrompt(null);
      setMirrorGuideOpen(false);
      promptedSignaturesRef.current.clear();
      setStreamKind('camera');
      setHasUploadedImage(false);
      setMonitorActive(true);
      await startActiveSession('Live Camera');

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          setStreamKind('none');
          streamRef.current = null;
          void endActiveSession();
        };
      }
    } catch {
      setNotice('Camera permission was denied or no camera was detected.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNotice(null);
    handleStopStream();
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        uploadedImgRef.current = img;
        setOcrTokens([]);
        setQrHits([]);
        setOverrides({});
        setIgnoredSignatures([]);
        setBlurPrompt(null);
        setMirrorGuideOpen(false);
        promptedSignaturesRef.current.clear();
        setHasUploadedImage(true);
        const srcCanvas = getSourceCanvas();
        srcCanvas.width = Math.min(1280, img.naturalWidth);
        srcCanvas.height = Math.round((srcCanvas.width / img.naturalWidth) * img.naturalHeight);
        const ctx = srcCanvas.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0, srcCanvas.width, srcCanvas.height);
        drawCurrentCanvases();
        await startActiveSession('Uploaded Screenshot');
        await executeOcrOnce();
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleResetToDemo = () => {
    handleStopStream();
    setHasUploadedImage(false);
    setQrHits([]);
    setOverrides({});
    setIgnoredSignatures([]);
    setBlurPrompt(null);
    setMirrorGuideOpen(false);
    promptedSignaturesRef.current.clear();
    setManualRegions([]);
  };

  const handleLaunchProtectedPip = async () => {
    setNotice(null);
    const canvas = protectedCanvasRef.current;
    if (!canvas || typeof canvas.captureStream !== 'function') {
      setNotice('Floating window is not supported in this browser.');
      return;
    }
    try {
      const stream = canvas.captureStream(30);
      if (!pipVideoRef.current) {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        pipVideoRef.current = v;
      }
      pipVideoRef.current.srcObject = stream;
      await pipVideoRef.current.play();
      if (document.pictureInPictureEnabled && pipVideoRef.current.requestPictureInPicture) {
        await pipVideoRef.current.requestPictureInPicture();
        setNotice('Floating protected feed opened on top of other windows.');
      } else {
        setNotice('Floating window is blocked in this embedded preview.');
      }
    } catch {
      setNotice('Could not open floating window.');
    }
  };

  const handleToggleFullscreen = async () => {
    const el = protectedContainerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      setNotice('Fullscreen view is blocked in this browser preview.');
    }
  };

  const handleExportSnapshot = () => {
    const canvas = protectedCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `blurguard-protected-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const toCanvasCoords = (
    e: React.MouseEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement,
  ): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const findRegionAtPoint = (
    pt: { x: number; y: number },
  ): { kind: 'manual' | 'detection'; id: string; bbox: BoundingBox; hit: 'resize' | 'move' } | null => {
    const isNearHandle = (b: BoundingBox) =>
      Math.abs(pt.x - (b.x + b.width)) <= 12 && Math.abs(pt.y - (b.y + b.height)) <= 12;
    const isInside = (b: BoundingBox) =>
      pt.x >= b.x - 6 && pt.x <= b.x + b.width + 6 && pt.y >= b.y - 6 && pt.y <= b.y + b.height + 6;

    // Check currently selected item first for handle priority
    if (selectedRegionId) {
      const selManual = manualRegions.find((r) => r.id === selectedRegionId);
      if (selManual) {
        if (isNearHandle(selManual.bbox)) {
          return { kind: 'manual', id: selManual.id, bbox: selManual.bbox, hit: 'resize' };
        }
        if (isInside(selManual.bbox)) {
          return { kind: 'manual', id: selManual.id, bbox: selManual.bbox, hit: 'move' };
        }
      }
      const selDet = detections.find((d) => d.id === selectedRegionId);
      if (selDet) {
        if (isNearHandle(selDet.bbox)) {
          return { kind: 'detection', id: selDet.id, bbox: selDet.bbox, hit: 'resize' };
        }
        if (isInside(selDet.bbox)) {
          return { kind: 'detection', id: selDet.id, bbox: selDet.bbox, hit: 'move' };
        }
      }
    }

    for (let i = manualRegions.length - 1; i >= 0; i -= 1) {
      const r = manualRegions[i];
      if (isNearHandle(r.bbox)) return { kind: 'manual', id: r.id, bbox: r.bbox, hit: 'resize' };
      if (isInside(r.bbox)) return { kind: 'manual', id: r.id, bbox: r.bbox, hit: 'move' };
    }

    for (let i = detections.length - 1; i >= 0; i -= 1) {
      const d = detections[i];
      if (isNearHandle(d.bbox)) return { kind: 'detection', id: d.id, bbox: d.bbox, hit: 'resize' };
      if (isInside(d.bbox)) return { kind: 'detection', id: d.id, bbox: d.bbox, hit: 'move' };
    }

    return null;
  };

  const handleMonitorMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!monitorCanvasRef.current) return;
    const pt = toCanvasCoords(e, monitorCanvasRef.current);

    if (drawManualMode) {
      drawStartRef.current = pt;
      interactionRef.current = {
        mode: 'draw',
        targetKind: 'new',
        targetId: 'new',
        startPt: pt,
        initialBox: { x: pt.x, y: pt.y, width: 0, height: 0 },
      };
      setDraftBox({ x: pt.x, y: pt.y, width: 0, height: 0 });
      return;
    }

    const hit = findRegionAtPoint(pt);
    if (hit && canOverrideMasks) {
      setSelectedRegionId(hit.id);
      interactionRef.current = {
        mode: hit.hit,
        targetKind: hit.kind,
        targetId: hit.id,
        startPt: pt,
        initialBox: { ...hit.bbox },
      };
    } else {
      setSelectedRegionId(null);
    }
  };

  const handleMonitorMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!monitorCanvasRef.current) return;
    const canvas = monitorCanvasRef.current;
    const pt = toCanvasCoords(e, canvas);
    const activeInteraction = interactionRef.current;

    if (!activeInteraction) {
      if (drawManualMode) {
        setCanvasCursor('crosshair');
        return;
      }
      const hit = findRegionAtPoint(pt);
      setCanvasCursor(hit ? (hit.hit === 'resize' ? 'nwse-resize' : 'move') : 'default');
      return;
    }

    if (activeInteraction.mode === 'draw') {
      const start = activeInteraction.startPt;
      setDraftBox({
        x: Math.min(start.x, pt.x),
        y: Math.min(start.y, pt.y),
        width: Math.abs(pt.x - start.x),
        height: Math.abs(pt.y - start.y),
      });
      return;
    }

    const dx = pt.x - activeInteraction.startPt.x;
    const dy = pt.y - activeInteraction.startPt.y;
    const init = activeInteraction.initialBox;

    const nextBox: BoundingBox =
      activeInteraction.mode === 'move'
        ? {
            x: Math.max(0, Math.min(canvas.width - init.width, init.x + dx)),
            y: Math.max(0, Math.min(canvas.height - init.height, init.y + dy)),
            width: init.width,
            height: init.height,
          }
        : {
            x: init.x,
            y: init.y,
            width: Math.max(18, Math.min(canvas.width - init.x, init.width + dx)),
            height: Math.max(14, Math.min(canvas.height - init.y, init.height + dy)),
          };

    if (activeInteraction.targetKind === 'manual') {
      setManualRegions((prev) =>
        prev.map((r) => (r.id === activeInteraction.targetId ? { ...r, bbox: nextBox } : r)),
      );
    } else if (activeInteraction.targetKind === 'detection') {
      setBboxOverrides((prev) => ({ ...prev, [activeInteraction.targetId]: nextBox }));
    }
  };

  const handleMonitorMouseUp = () => {
    const activeInteraction = interactionRef.current;
    if (activeInteraction?.mode === 'draw' && draftBox && draftBox.width > 14 && draftBox.height > 10) {
      const style: MaskingStyle =
        maskOverride === 'policy' ? config.defaultMaskingStyle : maskOverride;
      const newId = `man-${Date.now()}`;
      setManualRegions((prev) => [
        ...prev,
        {
          id: newId,
          label: `Manual region #${prev.length + 1}`,
          bbox: draftBox,
          maskingStyle: style,
          createdAt: new Date().toISOString(),
        },
      ]);
      setSelectedRegionId(newId);
      setDrawManualMode(false);
    }
    interactionRef.current = null;
    drawStartRef.current = null;
    setDraftBox(null);
  };

  const handleSetOverride = (det: DetectedItem, action: ReviewAction) => {
    if (!canOverrideMasks) {
      setNotice('Your account does not have permission to override masks.');
      return;
    }
    const sig = getDetectionSignature(det.category, det.text);
    setOverrides((prev) => ({ ...prev, [det.id]: action }));
    if (action === 'approved_visible') {
      setIgnoredSignatures((prev) => (prev.includes(sig) ? prev : [...prev, sig]));
    } else if (action === 'manual_masked') {
      setIgnoredSignatures((prev) => prev.filter((item) => item !== sig));
    }
  };

  const findActiveDetectionAtCanvasPoint = (
    e: React.MouseEvent<HTMLCanvasElement>,
  ): DetectedItem | null => {
    const canvas = protectedCanvasRef.current;
    if (!canvas || !activePolicy) return null;
    const pt = toCanvasCoords(e, canvas);
    const pad = (activePolicy.paddingPx || 6) + 6;
    for (let i = detections.length - 1; i >= 0; i -= 1) {
      const d = detections[i];
      if (d.status === 'approved_visible') continue;
      if (
        pt.x >= d.bbox.x - pad &&
        pt.x <= d.bbox.x + d.bbox.width + pad &&
        pt.y >= d.bbox.y - pad &&
        pt.y <= d.bbox.y + d.bbox.height + pad
      ) {
        return d;
      }
    }
    return null;
  };

  const handleProtectedMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = findActiveDetectionAtCanvasPoint(e);
    setProtectedCursor(hit ? 'pointer' : 'default');
  };

  const handleProtectedClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = findActiveDetectionAtCanvasPoint(e);
    if (hit) {
      const sig = getDetectionSignature(hit.category, hit.text);
      promptedSignaturesRef.current.add(sig);
      setMirrorGuideOpen(false);
      setBlurPrompt({
        detId: hit.id,
        signature: sig,
        category: hit.category,
        maskedPreview: hit.maskedPreview,
        maskingStyle: hit.maskingStyle,
      });
      return;
    }
    if (streamKind === 'screen') {
      setMirrorGuideOpen(true);
    }
  };

  const handleProtectedInteractionAttempt = () => {
    if (streamKind === 'screen') {
      setMirrorGuideOpen(true);
    }
  };

  const handleAdjustRegion = (id: string) => {
    if (!canOverrideMasks) {
      setNotice('Your account does not have permission to adjust mask regions.');
      return;
    }
    setDrawManualMode(false);
    setCompareOriginal(true);
    setSelectedRegionId(id);
    setNotice('Drag inside the highlighted box on Original screen to move it, or drag its corner square to resize.');
  };

  const handleDetectionFeedback = async (
    det: DetectedItem,
    verdict: 'correct' | 'false_positive',
  ) => {
    setFeedbackByDetId((prev) => ({ ...prev, [det.id]: verdict }));
    if (verdict === 'false_positive' && canOverrideMasks) {
      setOverrides((prev) => ({ ...prev, [det.id]: 'approved_visible' }));
    }
    try {
      await apiRequest('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: det.category,
          ruleName: det.ruleName,
          maskedSnippet: det.maskedPreview,
          verdict,
        }),
      });
    } catch {
      // Non-blocking feedback logging
    }
  };

  const activeMasks = detections.filter((d) => d.status !== 'approved_visible');
  const criticalCount = activeMasks.filter((d) => d.riskLevel === 'Critical').length;
  const mediumPlusCount = activeMasks.length - criticalCount;

  return (
    <div className="space-y-5">
      <video ref={videoRef} className="hidden" muted playsInline />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Header Row matching video */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Live Monitor</h2>
          <p className="text-xs text-slate-400 mt-0.5">Preview the protected screen surface.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {!hasLiveStream ? (
            <button
              type="button"
              onClick={handleStartScreenCapture}
              className="h-9 px-3.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              Start Monitoring
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleTogglePauseMonitor}
                className="h-9 px-3.5 bg-[#0E1729] hover:bg-[#15223B] border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                {monitorActive ? (
                  <>
                    <Pause className="w-3.5 h-3.5 text-slate-300" />
                    Pause monitor
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    Resume monitor
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleStopStream}
                className="h-9 px-3.5 bg-[#0E1729] hover:bg-red-950/60 border border-slate-700 hover:border-red-800 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5 text-red-400" />
                Stop Monitoring
              </button>
            </>
          )}

          {canTriggerPanic && (
            <button
              type="button"
              onClick={() => onTogglePanicProtect(!panicProtect)}
              className={`h-9 px-3.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
                panicProtect
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  : 'bg-red-600 hover:bg-red-500 text-white'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {panicProtect ? 'Resume screen' : 'PANIC PROTECT'}
            </button>
          )}
        </div>
      </div>

      {panicProtect && (
        <div className="px-4 py-3 bg-rose-950/70 border border-rose-700/80 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-rose-100">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-semibold">Protected output engaged</span>
            <span className="text-rose-300">
              · Emergency curtain active across viewer output (Alt + P to toggle)
            </span>
          </div>
          <button
            type="button"
            onClick={() => onTogglePanicProtect(false)}
            className="h-8 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-md whitespace-nowrap"
          >
            Resume output
          </button>
        </div>
      )}

      {!hasLiveStream && config.autoStartMonitoring && !panicProtect && (
        <div className="px-4 py-2.5 bg-[#0E1729] border border-sky-500/40 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-slate-200">
            Auto-monitoring is enabled in Settings. Select an application window or browser tab to begin live masking.
          </span>
          <button
            type="button"
            onClick={handleStartScreenCapture}
            className="h-7 px-3 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-md whitespace-nowrap"
          >
            Share Window Now
          </button>
        </div>
      )}

      {/* Main Framed Monitor Card */}
      <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl overflow-hidden">
        {/* Clean Toolbar matching video */}
        <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 tabular-nums">
              {hasLiveStream && monitorActive && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
              {!monitorActive
                ? 'Monitor paused'
                : hasLiveStream
                  ? `Live · ${liveFps || 30} fps${ocrRunning ? ' · Scanning' : ''}`
                  : 'Monitoring locally'}
            </span>
            <span className="text-slate-700" aria-hidden="true">
              ·
            </span>

            {!hasLiveStream ? (
              <button
                type="button"
                onClick={handleStartScreenCapture}
                className="h-8 px-3 text-xs font-medium bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Monitor className="w-3.5 h-3.5 text-sky-400" />
                Share Window / Tab
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLaunchProtectedPip}
                className="h-8 px-3 text-xs font-medium bg-[#142038] hover:bg-[#192845] border border-slate-700 text-sky-300 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <PictureInPicture2 className="w-3.5 h-3.5 text-sky-400" />
                Float Guard
              </button>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-8 px-3 text-xs font-medium bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileImage className="w-3.5 h-3.5 text-slate-400" />
              Upload Image
            </button>

            {hasUploadedImage && (
              <button
                type="button"
                onClick={handleResetToDemo}
                className="h-8 px-2.5 text-xs text-slate-400 hover:text-white transition-colors whitespace-nowrap"
              >
                Reset
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCompareOriginal((v) => !v)}
              className={`h-8 px-3 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                compareOriginal
                  ? 'bg-sky-500 border-sky-500 text-slate-950 font-semibold'
                  : 'bg-[#080F1E] border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              {compareOriginal ? 'Protected View Only' : 'Compare Original'}
            </button>

            <button
              type="button"
              onClick={() => {
                if (!compareOriginal) setCompareOriginal(true);
                setDrawManualMode((v) => !v);
              }}
              className={`h-8 px-3 text-xs font-medium rounded-md border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                drawManualMode
                  ? 'bg-sky-500 border-sky-500 text-slate-950 font-semibold'
                  : 'bg-[#080F1E] border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              {drawManualMode ? 'Drag box...' : 'Mask Region'}
            </button>

            <button
              type="button"
              onClick={() => setShowTools((v) => !v)}
              className={`h-8 px-2.5 text-xs font-medium rounded-md border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                showTools
                  ? 'bg-[#142038] border-slate-600 text-white'
                  : 'bg-[#080F1E] border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Options
            </button>
          </div>
        </div>

        {/* Collapsible Extra Tools */}
        {showTools && (
          <div className="px-4 py-3 bg-[#091120] border-b border-slate-800/80 flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Policy:</span>
              <select
                value={overridePolicyId}
                onChange={(e) => setOverridePolicyId(e.target.value)}
                className="h-8 px-2.5 text-xs bg-[#0E1729] border border-slate-700 rounded-md text-slate-200"
              >
                <option value="source_bound">Auto ({boundPolicy?.name})</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">Mask style:</span>
              <select
                value={maskOverride}
                onChange={(e) => setMaskOverride(e.target.value as MaskingStyle | 'policy')}
                className="h-8 px-2.5 text-xs bg-[#0E1729] border border-slate-700 rounded-md text-slate-200"
              >
                <option value="policy">Policy Default</option>
                <option value="blur">Blur</option>
                <option value="pixelate">Pixelate</option>
                <option value="redact">Redact (Black Box)</option>
              </select>
            </div>

            {streamKind !== 'camera' && (
              <button
                type="button"
                onClick={handleStartCameraCapture}
                className="h-8 px-3 bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 rounded-md flex items-center gap-1.5 whitespace-nowrap"
              >
                <Video className="w-3.5 h-3.5 text-sky-400" />
                Live Camera
              </button>
            )}

            <button
              type="button"
              onClick={executeOcrOnce}
              disabled={ocrRunning}
              className="h-8 px-3 bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 rounded-md flex items-center gap-1.5 whitespace-nowrap"
            >
              <ScanText className="w-3.5 h-3.5 text-sky-400" />
              {ocrRunning ? 'Scanning...' : 'Scan Frame'}
            </button>

            <button
              type="button"
              onClick={handleLaunchProtectedPip}
              className="h-8 px-3 bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 rounded-md flex items-center gap-1.5 whitespace-nowrap"
            >
              <PictureInPicture2 className="w-3.5 h-3.5 text-sky-400" />
              Pop Out Safe Feed
            </button>

            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="h-8 px-3 bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 rounded-md flex items-center gap-1.5 whitespace-nowrap"
            >
              <Maximize2 className="w-3.5 h-3.5 text-slate-300" />
              Fullscreen
            </button>

            <button
              type="button"
              onClick={handleExportSnapshot}
              className="h-8 px-3 bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 rounded-md flex items-center gap-1.5 whitespace-nowrap"
            >
              <Camera className="w-3.5 h-3.5 text-slate-300" />
              Save Snapshot
            </button>
          </div>
        )}

        {notice && (
          <div className="px-4 py-2.5 bg-sky-950/50 border-b border-sky-800/60 text-xs text-sky-200 flex items-center justify-between gap-4">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-sky-400 hover:underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Canvas Viewport matching video */}
        <div className="p-4 sm:p-5 bg-[#070E1A]">
          <div
            className={`grid gap-4 ${
              compareOriginal ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  Protected viewer surface{' '}
                  {detections.some((d) => d.status !== 'approved_visible') && (
                    <span className="text-slate-500">· Click any blurred box to review</span>
                  )}
                </span>
                <span className="tabular-nums">
                  {activeMasks.length + manualRegions.length} sensitive region(s) masked
                </span>
              </div>
              <div
                ref={protectedContainerRef}
                tabIndex={0}
                onWheel={handleProtectedInteractionAttempt}
                onKeyDown={(e) => {
                  if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter' || e.key.startsWith('Arrow')) {
                    handleProtectedInteractionAttempt();
                  }
                }}
                className="relative rounded-lg overflow-hidden border border-slate-800 bg-[#091120] focus:outline-none focus:border-sky-500/50"
              >
                <canvas
                  ref={protectedCanvasRef}
                  onMouseMove={handleProtectedMouseMove}
                  onMouseLeave={() => setProtectedCursor('default')}
                  onClick={handleProtectedClick}
                  style={{ cursor: protectedCursor }}
                  className="w-full h-auto block aspect-video object-contain"
                />

                {blurPrompt && (
                  <div
                    role="dialog"
                    aria-label="Blur confirmation"
                    className="absolute top-3 right-3 z-20 w-80 max-w-[calc(100%-1.5rem)] bg-[#0E1729]/95 backdrop-blur-md border border-sky-500/60 rounded-xl shadow-2xl p-3.5 text-xs space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {blurPrompt.category === 'url' ? (
                          <Link2 className="w-4 h-4 text-sky-400 shrink-0" />
                        ) : (
                          <EyeOff className="w-4 h-4 text-sky-400 shrink-0" />
                        )}
                        <div>
                          <p className="font-semibold text-white">
                            Blurred {FRIENDLY_CATEGORIES[blurPrompt.category]}
                          </p>
                          <p className="font-mono text-[11px] text-slate-400 truncate max-w-[200px]">
                            {blurPrompt.maskedPreview}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBlurPrompt(null)}
                        aria-label="Close blur prompt"
                        className="text-slate-400 hover:text-white p-0.5"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-slate-300 leading-relaxed">
                      Do you want to remove the blur from this{' '}
                      {FRIENDLY_CATEGORIES[blurPrompt.category].toLowerCase()}?
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <button
                        type="button"
                        disabled={!canOverrideMasks}
                        onClick={() => {
                          const target = detections.find((d) => d.id === blurPrompt.detId);
                          if (target) {
                            handleSetOverride(target, 'approved_visible');
                          } else {
                            setOverrides((prev) => ({
                              ...prev,
                              [blurPrompt.detId]: 'approved_visible',
                            }));
                            setIgnoredSignatures((prev) =>
                              prev.includes(blurPrompt.signature)
                                ? prev
                                : [...prev, blurPrompt.signature],
                            );
                          }
                          setBlurPrompt(null);
                        }}
                        className="h-8 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-md flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Remove Blur
                      </button>

                      <button
                        type="button"
                        onClick={() => setBlurPrompt(null)}
                        className="h-8 px-3 bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 font-medium rounded-md whitespace-nowrap"
                      >
                        Keep Blurred
                      </button>
                    </div>
                  </div>
                )}

                {mirrorGuideOpen && streamKind === 'screen' && (
                  <div
                    role="status"
                    className="absolute bottom-3 left-3 right-3 z-20 bg-[#0E1729]/95 backdrop-blur-md border border-amber-500/50 rounded-xl shadow-2xl p-3.5 text-xs flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1 max-w-2xl">
                      <p className="font-semibold text-amber-300">
                        Interact directly in your opened browser window or tab
                      </p>
                      <p className="text-slate-300 leading-relaxed">
                        This canvas is a read-only protected output feed (browser security blocks
                        sending scroll or keyboard typing into another window). Switch back to your
                        shared tab to scroll and type normally — BlurGuard stays active in the
                        background.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleLaunchProtectedPip}
                        className="h-8 px-3 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-md flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <PictureInPicture2 className="w-3.5 h-3.5" />
                        Float Guard
                      </button>
                      <button
                        type="button"
                        onClick={() => setMirrorGuideOpen(false)}
                        className="h-8 px-3 bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 rounded-md whitespace-nowrap"
                      >
                        Got it
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {compareOriginal && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>
                    Original screen{' '}
                    {drawManualMode
                      ? '(drag rectangle to add mask)'
                      : '(click region to move or drag corner to resize)'}
                  </span>
                  <span className="tabular-nums">{detections.length} detected</span>
                </div>
                <div className="rounded-lg overflow-hidden border border-slate-800 bg-[#091120]">
                  <canvas
                    ref={monitorCanvasRef}
                    onMouseDown={handleMonitorMouseDown}
                    onMouseMove={handleMonitorMouseMove}
                    onMouseUp={handleMonitorMouseUp}
                    onMouseLeave={handleMonitorMouseUp}
                    style={{ cursor: canvasCursor }}
                    className="w-full h-auto block aspect-video object-contain"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3-Column Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-4">
          <p className="text-xs text-slate-400">Frames processed</p>
          <p className="mt-2 text-2xl font-semibold text-white tabular-nums">
            {framesAnalyzed.toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {hasLiveStream ? `${liveFps || 30} fps background guard` : 'Current session'}
          </p>
        </div>

        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-4">
          <p className="text-xs text-slate-400">Masks active</p>
          <p className="mt-2 text-2xl font-semibold text-white tabular-nums">
            {activeMasks.length + manualRegions.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
            {criticalCount} critical · {mediumPlusCount} standard
          </p>
        </div>

        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-4">
          <p className="text-xs text-slate-400">Detection speed</p>
          <p className="mt-2 text-2xl font-semibold text-white tabular-nums">{scanLatencyMs} ms</p>
          <p className="mt-1 text-[11px] text-slate-400">Local frame OCR</p>
        </div>
      </div>

      {/* Manual Review & Detection Feedback List (Module 9 Part A & Part B) */}
      <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Masked regions on screen</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Review detections, adjust or style mask boxes, and confirm accuracy.
            </p>
          </div>
          {manualRegions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setManualRegions([]);
                setSelectedRegionId(null);
              }}
              className="text-xs text-rose-400 hover:underline whitespace-nowrap"
            >
              Clear custom regions
            </button>
          )}
        </div>

        <div className="divide-y divide-slate-800/70">
          {manualRegions.map((mr) => (
            <div
              key={mr.id}
              className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-[#111D33]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-sky-300">{mr.label}</span>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-400 tabular-nums">
                  {Math.round(mr.bbox.width)}×{Math.round(mr.bbox.height)} px
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Masking style for ${mr.label}`}
                  value={mr.maskingStyle}
                  onChange={(e) => {
                    const nextStyle = e.target.value as MaskingStyle;
                    setManualRegions((prev) =>
                      prev.map((item) =>
                        item.id === mr.id ? { ...item, maskingStyle: nextStyle } : item,
                      ),
                    );
                  }}
                  className="h-8 px-2 text-xs bg-[#091120] border border-slate-700 text-slate-200 rounded-md"
                >
                  <option value="blur">Blur</option>
                  <option value="redact">Redact</option>
                  <option value="pixelate">Pixelate</option>
                </select>

                <button
                  type="button"
                  onClick={() => handleAdjustRegion(mr.id)}
                  className={`h-8 px-2.5 text-xs font-medium rounded-md border flex items-center gap-1.5 whitespace-nowrap ${
                    selectedRegionId === mr.id
                      ? 'bg-sky-500 border-sky-500 text-slate-950 font-semibold'
                      : 'bg-[#142038] hover:bg-[#192845] border-slate-700 text-slate-200'
                  }`}
                >
                  <Move className="w-3.5 h-3.5" />
                  Adjust Region
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setManualRegions((prev) => prev.filter((item) => item.id !== mr.id));
                    if (selectedRegionId === mr.id) setSelectedRegionId(null);
                  }}
                  className="h-8 px-2.5 text-xs font-medium bg-[#142038] hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-300 hover:text-rose-300 rounded-md flex items-center gap-1 whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
            </div>
          ))}

          {detections.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-white">No sensitive values exposed</p>
              <p className="text-xs text-slate-400 mt-1">
                Active policy is watching the live screen.
              </p>
            </div>
          ) : (
            detections.map((det) => {
              const isIgnored = det.status === 'approved_visible';
              const needsReview = det.status === 'pending_review';
              const feedback = feedbackByDetId[det.id];
              const hasCustomBox = Boolean(bboxOverrides[det.id]);

              return (
                <div
                  key={det.id}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-[#111D33]"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-white">
                        Detected {FRIENDLY_CATEGORIES[det.category]}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span
                        className={
                          det.riskLevel === 'Critical'
                            ? 'text-rose-400'
                            : det.riskLevel === 'High'
                              ? 'text-amber-300'
                              : 'text-sky-300'
                        }
                      >
                        {det.riskLevel}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-slate-400">{det.maskedPreview}</span>
                      {needsReview && (
                        <span className="text-[11px] text-amber-300">· Needs review</span>
                      )}
                      {isIgnored && (
                        <span className="text-[11px] text-slate-400">· Ignored</span>
                      )}
                    </div>

                    {/* Part B: Detection Accuracy Feedback */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span>Was this detection correct?</span>
                      <button
                        type="button"
                        onClick={() => void handleDetectionFeedback(det, 'correct')}
                        className={`px-2 py-0.5 rounded border transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                          feedback === 'correct'
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                            : 'bg-[#091120] border-slate-700/80 text-slate-300 hover:text-white'
                        }`}
                      >
                        <Check className="w-3 h-3" />
                        Correct
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDetectionFeedback(det, 'false_positive')}
                        className={`px-2 py-0.5 rounded border transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                          feedback === 'false_positive'
                            ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                            : 'bg-[#091120] border-slate-700/80 text-slate-300 hover:text-white'
                        }`}
                      >
                        <X className="w-3 h-3" />
                        False Positive
                      </button>
                    </div>
                  </div>

                  {/* Part A: [ Mask ] [ Ignore ] [ Adjust Region ] + Style selector */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <select
                      aria-label={`Masking style for ${det.ruleName}`}
                      value={det.maskingStyle}
                      disabled={!canOverrideMasks}
                      onChange={(e) => {
                        const nextStyle = e.target.value as MaskingStyle;
                        setStyleOverrides((prev) => ({ ...prev, [det.id]: nextStyle }));
                      }}
                      className="h-8 px-2 text-xs bg-[#091120] border border-slate-700 text-slate-200 rounded-md disabled:opacity-50"
                    >
                      <option value="blur">Blur</option>
                      <option value="redact">Redact</option>
                      <option value="pixelate">Pixelate</option>
                    </select>

                    <button
                      type="button"
                      disabled={!canOverrideMasks}
                      onClick={() => handleAdjustRegion(det.id)}
                      className={`h-8 px-2.5 text-xs font-medium rounded-md border flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 ${
                        selectedRegionId === det.id
                          ? 'bg-sky-500 border-sky-500 text-slate-950 font-semibold'
                          : 'bg-[#142038] hover:bg-[#192845] border-slate-700 text-slate-200'
                      }`}
                    >
                      <Move className="w-3.5 h-3.5" />
                      Adjust Region
                    </button>

                    {hasCustomBox && (
                      <button
                        type="button"
                        onClick={() =>
                          setBboxOverrides((prev) => {
                            const copy = { ...prev };
                            delete copy[det.id];
                            return copy;
                          })
                        }
                        className="h-8 px-2 text-xs text-slate-400 hover:text-white"
                      >
                        Reset
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!canOverrideMasks}
                      onClick={() => handleSetOverride(det, 'manual_masked')}
                      className={`h-8 px-3 text-xs font-medium rounded-md flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 ${
                        !isIgnored
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200'
                      }`}
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      Mask
                    </button>

                    <button
                      type="button"
                      disabled={!canOverrideMasks}
                      onClick={() => handleSetOverride(det, 'approved_visible')}
                      className={`h-8 px-3 text-xs font-medium rounded-md border flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 ${
                        isIgnored
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-[#142038] hover:bg-[#192845] border-slate-700 text-slate-200'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Ignore
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
