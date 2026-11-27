import jsQR from 'jsqr';
import type {
  BoundingBox,
  DetectedItem,
  MaskingStyle,
  ProtectionPolicy,
  ReviewAction,
  RiskLevel,
} from '../types/blurguard.ts';

export interface QrScanHit {
  id: string;
  data: string;
  bbox: BoundingBox;
}

const RISK_ORDER: Record<RiskLevel, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

interface BrowserBarcodeDetector {
  detect(image: ImageBitmapSource): Promise<
    Array<{
      rawValue?: string;
      boundingBox?: { x: number; y: number; width: number; height: number };
    }>
  >;
}

let scratchQrCanvas: HTMLCanvasElement | null = null;
let sharedBarcodeDetector: BrowserBarcodeDetector | null | undefined;

function getBarcodeDetector(): BrowserBarcodeDetector | null {
  if (sharedBarcodeDetector !== undefined) return sharedBarcodeDetector;
  try {
    const Ctor = (
      window as unknown as {
        BarcodeDetector?: new (opts?: { formats?: string[] }) => BrowserBarcodeDetector;
      }
    ).BarcodeDetector;
    sharedBarcodeDetector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null;
  } catch {
    sharedBarcodeDetector = null;
  }
  return sharedBarcodeDetector;
}

function getQrScratchCanvas(width: number, height: number): HTMLCanvasElement {
  if (!scratchQrCanvas) {
    scratchQrCanvas = document.createElement('canvas');
  }
  if (scratchQrCanvas.width !== width || scratchQrCanvas.height !== height) {
    scratchQrCanvas.width = width;
    scratchQrCanvas.height = height;
  }
  return scratchQrCanvas;
}

function isDuplicateBox(existing: QrScanHit[], candidate: BoundingBox): boolean {
  return existing.some(
    (item) =>
      Math.abs(item.bbox.x - candidate.x) < 18 &&
      Math.abs(item.bbox.y - candidate.y) < 18 &&
      Math.abs(item.bbox.width - candidate.width) < 24,
  );
}

/**
 * Scans a canvas for one or more QR codes using native BarcodeDetector (if supported)
 * plus multi-pass jsQR (supporting both light and dark-mode inverted QR codes).
 */
export async function scanQrCodesOnCanvas(
  sourceCanvas: HTMLCanvasElement,
  maxWidth = 1120,
): Promise<QrScanHit[]> {
  if (sourceCanvas.width === 0 || sourceCanvas.height === 0) return [];

  const targetWidth =
    sourceCanvas.width > maxWidth ? maxWidth : Math.max(1, sourceCanvas.width);
  const scale = targetWidth / sourceCanvas.width;
  const targetHeight = Math.max(1, Math.round(sourceCanvas.height * scale));
  const invScale = 1 / scale;

  const scratch = getQrScratchCanvas(targetWidth, targetHeight);
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

  const hits: QrScanHit[] = [];

  // 1. Try native BarcodeDetector first if supported (very fast & multi-QR native)
  const detector = getBarcodeDetector();
  if (detector) {
    try {
      const nativeResults = await detector.detect(scratch);
      for (const res of nativeResults) {
        if (!res.boundingBox || res.boundingBox.width <= 4 || res.boundingBox.height <= 4) {
          continue;
        }
        const pad = 6;
        const rx = Math.max(0, res.boundingBox.x - pad);
        const ry = Math.max(0, res.boundingBox.y - pad);
        const rw = Math.min(targetWidth - rx, res.boundingBox.width + pad * 2);
        const rh = Math.min(targetHeight - ry, res.boundingBox.height + pad * 2);
        const bbox: BoundingBox = {
          x: rx * invScale,
          y: ry * invScale,
          width: Math.max(20, rw * invScale),
          height: Math.max(20, rh * invScale),
        };
        if (!isDuplicateBox(hits, bbox)) {
          hits.push({
            id: `qr-${Math.round(bbox.x)}-${Math.round(bbox.y)}-${Math.round(bbox.width)}`,
            data: res.rawValue || 'QR_CODE',
            bbox,
          });
          ctx.fillStyle = '#808080';
          ctx.fillRect(rx, ry, rw, rh);
        }
      }
    } catch {
      // Fall back cleanly to jsQR
    }
  }

  // 2. Multi-pass jsQR detection (handles inverted QR codes + universal browser support)
  for (let pass = 0; pass < 4; pass += 1) {
    const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const code = jsQR(imgData.data, targetWidth, targetHeight, {
      inversionAttempts: 'attemptBoth',
    });
    if (!code) break;

    const pts = [
      code.location.topLeftCorner,
      code.location.topRightCorner,
      code.location.bottomLeftCorner,
      code.location.bottomRightCorner,
    ];
    const minX = Math.max(0, Math.min(...pts.map((p) => p.x)));
    const minY = Math.max(0, Math.min(...pts.map((p) => p.y)));
    const maxX = Math.min(targetWidth, Math.max(...pts.map((p) => p.x)));
    const maxY = Math.min(targetHeight, Math.max(...pts.map((p) => p.y)));

    const pad = 6;
    const rx = Math.max(0, minX - pad);
    const ry = Math.max(0, minY - pad);
    const rw = Math.min(targetWidth - rx, maxX - minX + pad * 2);
    const rh = Math.min(targetHeight - ry, maxY - minY + pad * 2);

    const bbox: BoundingBox = {
      x: rx * invScale,
      y: ry * invScale,
      width: Math.max(20, rw * invScale),
      height: Math.max(20, rh * invScale),
    };

    if (!isDuplicateBox(hits, bbox)) {
      hits.push({
        id: `qr-${Math.round(bbox.x)}-${Math.round(bbox.y)}-${Math.round(bbox.width)}`,
        data: code.data || 'QR_CODE',
        bbox,
      });
    }

    // Blank out found QR box on scratch canvas so next pass can locate additional QR codes
    ctx.fillStyle = '#808080';
    ctx.fillRect(rx, ry, rw, rh);
  }

  return hits;
}

export function qrHitsToDetections(
  hits: QrScanHit[],
  policy: ProtectionPolicy,
  sourceLabel: string,
  overrides?: Record<string, ReviewAction>,
  options?: {
    bboxOverrides?: Record<string, BoundingBox>;
    styleOverrides?: Record<string, MaskingStyle>;
  },
): DetectedItem[] {
  const catSetting = policy.categories.qr_code;
  if (!catSetting || !catSetting.enabled) return [];

  const riskLevel: RiskLevel = catSetting.baseRisk || 'High';
  if (RISK_ORDER[riskLevel] < RISK_ORDER[policy.minRiskThreshold]) {
    return [];
  }

  return hits.map((hit) => {
    const clean = hit.data.trim();
    const isOtpOrSecret =
      /otpauth:|totp|secret|token|key=|password|upi:|bitcoin:|stripe/i.test(clean);
    const resolvedRisk: RiskLevel = isOtpOrSecret ? 'Critical' : riskLevel;
    const maskedPreview =
      clean.length > 6 ? `QR ••••••••${clean.slice(-4)}` : 'QR Code (masked)';
    const finalBbox = options?.bboxOverrides?.[hit.id] || hit.bbox;
    const finalStyle = options?.styleOverrides?.[hit.id] || catSetting.maskingStyle || 'blur';
    const status: ReviewAction = overrides?.[hit.id] || 'auto_masked';

    return {
      id: hit.id,
      text: hit.data,
      maskedPreview,
      category: 'qr_code',
      ruleName: isOtpOrSecret ? '2FA / Secret QR Code' : 'QR Code Detected',
      confidence: 0.99,
      riskLevel: resolvedRisk,
      riskScore: resolvedRisk === 'Critical' ? 96 : 82,
      bbox: finalBbox,
      maskingStyle: finalStyle,
      status,
      sourceLabel,
    };
  });
}
