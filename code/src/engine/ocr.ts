import { createWorker, type Worker } from 'tesseract.js';
import type { OcrToken } from '../types/blurguard.ts';

let sharedWorker: Worker | null = null;
let workerInitializing: Promise<Worker> | null = null;
let sigCanvas: HTMLCanvasElement | null = null;

export interface PreprocessOptions {
  grayscale: boolean;
  contrastBoost: boolean;
  maxWidth?: number;
}

export function computeFrameSignature(sourceCanvas: HTMLCanvasElement): Uint8Array | null {
  if (sourceCanvas.width === 0 || sourceCanvas.height === 0) return null;
  if (!sigCanvas) {
    sigCanvas = document.createElement('canvas');
    sigCanvas.width = 32;
    sigCanvas.height = 18;
  }
  const ctx = sigCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(sourceCanvas, 0, 0, 32, 18);
  const { data } = ctx.getImageData(0, 0, 32, 18);
  const sig = new Uint8Array(32 * 18);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    sig[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return sig;
}

export function hasFrameChanged(
  prev: Uint8Array | null,
  next: Uint8Array | null,
  threshold = 0.008,
): boolean {
  if (!next) return false;
  if (!prev || prev.length !== next.length) return true;
  let diffSum = 0;
  let localizedChanges = 0;
  for (let i = 0; i < next.length; i += 1) {
    const d = Math.abs(next[i] - prev[i]);
    diffSum += d;
    if (d >= 16) localizedChanges += 1;
  }
  const meanDiff = diffSum / (next.length * 255);
  return meanDiff >= threshold || localizedChanges >= 3;
}

export function preprocessCanvasForOcr(
  sourceCanvas: HTMLCanvasElement,
  options: PreprocessOptions,
): { canvas: HTMLCanvasElement; scaleX: number; scaleY: number } {
  const maxWidth = options.maxWidth ?? 1480;
  let targetWidth = sourceCanvas.width;

  // Upscale small/medium captured windows so compact browser address bars and inputs read clearly
  if (sourceCanvas.width > 0 && sourceCanvas.width < 1120) {
    targetWidth = Math.min(maxWidth, Math.round(sourceCanvas.width * 1.4));
  } else if (sourceCanvas.width > maxWidth) {
    targetWidth = maxWidth;
  }

  targetWidth = Math.max(1, targetWidth);
  const scale = targetWidth / Math.max(1, sourceCanvas.width);
  const targetHeight = Math.max(1, Math.round(sourceCanvas.height * scale));

  const out = document.createElement('canvas');
  out.width = targetWidth;
  out.height = targetHeight;
  const ctx = out.getContext('2d');
  if (!ctx) {
    return { canvas: sourceCanvas, scaleX: 1, scaleY: 1 };
  }

  const filters: string[] = [];
  if (options.grayscale) filters.push('grayscale(100%)');
  if (options.contrastBoost) filters.push('contrast(135%)');
  ctx.filter = filters.length > 0 ? filters.join(' ') : 'none';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  ctx.filter = 'none';

  return {
    canvas: out,
    scaleX: sourceCanvas.width / targetWidth,
    scaleY: sourceCanvas.height / targetHeight,
  };
}

async function getOcrWorker(): Promise<Worker> {
  if (sharedWorker) return sharedWorker;
  if (!workerInitializing) {
    workerInitializing = createWorker('eng').then((w) => {
      sharedWorker = w;
      return w;
    });
  }
  return workerInitializing;
}

export function warmUpOcrWorker(): Promise<void> {
  return getOcrWorker()
    .then(() => undefined)
    .catch(() => undefined);
}

export interface OcrScanResult {
  tokens: OcrToken[];
  rawText: string;
  durationMs: number;
  meanConfidence: number;
}

export async function runTesseractOcrScan(
  sourceCanvas: HTMLCanvasElement,
  options: PreprocessOptions,
): Promise<OcrScanResult> {
  const started = performance.now();
  const { canvas: processed, scaleX, scaleY } = preprocessCanvasForOcr(sourceCanvas, options);
  const worker = await getOcrWorker();
  // Explicitly request blocks output because tesseract.js v7 sets blocks: false by default
  const { data } = await worker.recognize(processed, {}, { text: true, blocks: true });

  const tokens: OcrToken[] = [];
  let lineCounter = 0;

  const blocks = data.blocks || [];
  for (const block of blocks) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) {
          const text = word.text?.trim();
          if (!text) continue;
          const x = Math.max(0, word.bbox.x0 * scaleX);
          const y = Math.max(0, word.bbox.y0 * scaleY);
          const width = Math.max(8, (word.bbox.x1 - word.bbox.x0) * scaleX);
          const height = Math.max(10, (word.bbox.y1 - word.bbox.y0) * scaleY);
          tokens.push({
            id: `ocr-${lineCounter}-${tokens.length}`,
            text,
            confidence: Math.max(0, Math.min(1, (word.confidence || 80) / 100)),
            bbox: { x, y, width, height },
            lineIndex: lineCounter,
          });
        }
        lineCounter += 1;
      }
    }
  }

  const durationMs = Math.round(performance.now() - started);
  const meanConfidence =
    tokens.length > 0
      ? Number(
          (tokens.reduce((acc, t) => acc + t.confidence, 0) / tokens.length).toFixed(2),
        )
      : 0;

  return {
    tokens,
    rawText: data.text || '',
    durationMs,
    meanConfidence,
  };
}
