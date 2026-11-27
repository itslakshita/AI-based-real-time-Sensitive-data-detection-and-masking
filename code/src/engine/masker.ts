import type {
  BoundingBox,
  DetectedItem,
  ManualMaskRegion,
  MaskingStyle,
  ProtectionPolicy,
} from '../types/blurguard.ts';

let pixelScratchCanvas: HTMLCanvasElement | null = null;

function getScratchCanvas(): HTMLCanvasElement {
  if (!pixelScratchCanvas) {
    pixelScratchCanvas = document.createElement('canvas');
  }
  return pixelScratchCanvas;
}

function applyMaskRegion(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  bbox: BoundingBox,
  style: MaskingStyle,
  policy: ProtectionPolicy,
  label?: string,
): void {
  const pad = policy.paddingPx;
  const x = Math.max(0, Math.floor(bbox.x - pad));
  const y = Math.max(0, Math.floor(bbox.y - pad));
  const w = Math.min(sourceCanvas.width - x, Math.ceil(bbox.width + pad * 2));
  const h = Math.min(sourceCanvas.height - y, Math.ceil(bbox.height + pad * 2));
  if (w <= 2 || h <= 2) return;

  if (style === 'redact') {
    ctx.save();
    ctx.fillStyle = '#090D16';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (w >= 72 && h >= 18) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(label || 'REDACTED', x + 7, y + h / 2);
    }
    ctx.restore();
    return;
  }

  if (style === 'pixelate') {
    const blockSize = Math.max(6, policy.pixelBlockSize);
    const smallW = Math.max(2, Math.floor(w / blockSize));
    const smallH = Math.max(2, Math.floor(h / blockSize));
    const scratch = getScratchCanvas();
    scratch.width = smallW;
    scratch.height = smallH;
    const sCtx = scratch.getContext('2d');
    if (sCtx) {
      sCtx.imageSmoothingEnabled = false;
      sCtx.clearRect(0, 0, smallW, smallH);
      sCtx.drawImage(sourceCanvas, x, y, w, h, 0, 0, smallW, smallH);

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scratch, 0, 0, smallW, smallH, x, y, w, h);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    return;
  }

  // Default: Gaussian Blur
  const blurRadius = Math.max(12, policy.blurIntensity);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.clip();

  if (typeof ctx.filter === 'string') {
    const padSrc = 28;
    const sx = Math.max(0, x - padSrc);
    const sy = Math.max(0, y - padSrc);
    const sw = Math.min(sourceCanvas.width - sx, w + padSrc * 2);
    const sh = Math.min(sourceCanvas.height - sy, h + padSrc * 2);
    ctx.filter = `blur(${blurRadius}px)`;
    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
    ctx.filter = 'none';
  } else {
    // Fallback downsample blur when CanvasRenderingContext2D.filter is unavailable
    const scratch = getScratchCanvas();
    scratch.width = Math.max(2, Math.floor(w / 10));
    scratch.height = Math.max(2, Math.floor(h / 10));
    const sCtx = scratch.getContext('2d');
    if (sCtx) {
      sCtx.imageSmoothingEnabled = true;
      sCtx.clearRect(0, 0, scratch.width, scratch.height);
      sCtx.drawImage(sourceCanvas, x, y, w, h, 0, 0, scratch.width, scratch.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height, x, y, w, h);
    }
  }

  ctx.fillStyle = 'rgba(8, 15, 30, 0.24)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

export function renderProtectedOutput(
  sourceCanvas: HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement,
  detections: DetectedItem[],
  manualRegions: ManualMaskRegion[],
  policy: ProtectionPolicy,
  options: {
    panicProtect: boolean;
    protectionActive: boolean;
    overrideMaskStyle?: MaskingStyle | 'policy';
  },
): void {
  if (targetCanvas.width !== sourceCanvas.width || targetCanvas.height !== sourceCanvas.height) {
    targetCanvas.width = sourceCanvas.width;
    targetCanvas.height = sourceCanvas.height;
  }
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  if (options.panicProtect) {
    ctx.fillStyle = '#090D16';
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

    // Subtle geometric security grid
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < targetCanvas.width; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, targetCanvas.height);
      ctx.stroke();
    }
    for (let gy = 0; gy < targetCanvas.height; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(targetCanvas.width, gy);
      ctx.stroke();
    }

    const cx = targetCanvas.width / 2;
    const cy = targetCanvas.height / 2;

    ctx.fillStyle = '#111827';
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - 240, cy - 82, 480, 164, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#EF4444';
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PANIC PROTECT · ACTIVE', cx, cy - 32);

    ctx.fillStyle = '#F8FAFC';
    ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Protected output engaged', cx, cy + 4);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '400 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(
      'Screen output is hidden until you resume normal monitoring.',
      cx,
      cy + 36,
    );
    ctx.textAlign = 'left';
    return;
  }

  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  ctx.drawImage(sourceCanvas, 0, 0);

  if (!options.protectionActive) return;

  for (const det of detections) {
    if (det.status === 'approved_visible') continue;
    const style =
      options.overrideMaskStyle && options.overrideMaskStyle !== 'policy'
        ? options.overrideMaskStyle
        : det.maskingStyle;
    applyMaskRegion(
      ctx,
      sourceCanvas,
      det.bbox,
      style,
      policy,
      det.riskLevel === 'Critical' ? 'REDACTED' : 'MASKED',
    );
  }

  for (const region of manualRegions) {
    const style =
      options.overrideMaskStyle && options.overrideMaskStyle !== 'policy'
        ? options.overrideMaskStyle
        : region.maskingStyle;
    applyMaskRegion(ctx, sourceCanvas, region.bbox, style, policy, 'MANUAL MASK');
  }
}

export function renderPresenterMonitor(
  sourceCanvas: HTMLCanvasElement,
  monitorCanvas: HTMLCanvasElement,
  detections: DetectedItem[],
  manualRegions: ManualMaskRegion[],
  policy: ProtectionPolicy,
  draftBox: BoundingBox | null,
  selectedRegionId?: string | null,
): void {
  if (monitorCanvas.width !== sourceCanvas.width || monitorCanvas.height !== sourceCanvas.height) {
    monitorCanvas.width = sourceCanvas.width;
    monitorCanvas.height = sourceCanvas.height;
  }
  const ctx = monitorCanvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, monitorCanvas.width, monitorCanvas.height);
  ctx.drawImage(sourceCanvas, 0, 0);

  const pad = policy.paddingPx;

  const drawResizeHandle = (rx: number, ry: number, rw: number, rh: number) => {
    const hs = 10;
    const hx = rx + rw - hs / 2;
    const hy = ry + rh - hs / 2;
    ctx.save();
    ctx.fillStyle = '#38BDF8';
    ctx.strokeStyle = '#070E1A';
    ctx.lineWidth = 1.5;
    ctx.fillRect(hx, hy, hs, hs);
    ctx.strokeRect(hx, hy, hs, hs);
    ctx.restore();
  };

  for (const det of detections) {
    const isSelected = selectedRegionId === det.id;
    const x = Math.max(0, det.bbox.x - pad);
    const y = Math.max(0, det.bbox.y - pad);
    const w = det.bbox.width + pad * 2;
    const h = det.bbox.height + pad * 2;

    const color = isSelected
      ? '#38BDF8'
      : det.status === 'approved_visible'
        ? '#16A34A'
        : det.riskLevel === 'Critical'
          ? '#DC2626'
          : det.riskLevel === 'High'
            ? '#EA580C'
            : '#D97706';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : 2;
    if (det.status === 'approved_visible' && !isSelected) {
      ctx.setLineDash([4, 4]);
    }
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = isSelected
      ? 'rgba(56, 189, 248, 0.16)'
      : det.status === 'approved_visible'
        ? 'rgba(22, 163, 74, 0.1)'
        : det.riskLevel === 'Critical'
          ? 'rgba(220, 38, 38, 0.14)'
          : 'rgba(217, 119, 6, 0.12)';
    ctx.fillRect(x, y, w, h);

    const tagText = `${det.riskLevel} · ${det.category.replace('_', ' ')}`;
    ctx.font = '600 10px "JetBrains Mono", monospace';
    const textW = ctx.measureText(tagText).width + 10;
    const labelY = Math.max(0, y - 18);
    ctx.fillStyle = color;
    ctx.fillRect(x, labelY, textW, 16);
    ctx.fillStyle = isSelected ? '#070E1A' : '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(tagText, x + 5, labelY + 8);
    ctx.restore();

    if (isSelected) {
      drawResizeHandle(det.bbox.x, det.bbox.y, det.bbox.width, det.bbox.height);
    }
  }

  for (const region of manualRegions) {
    const isSelected = selectedRegionId === region.id;
    ctx.save();
    ctx.strokeStyle = isSelected ? '#38BDF8' : '#2563EB';
    ctx.lineWidth = isSelected ? 2.5 : 2;
    ctx.strokeRect(region.bbox.x, region.bbox.y, region.bbox.width, region.bbox.height);
    ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.18)' : 'rgba(37, 99, 235, 0.14)';
    ctx.fillRect(region.bbox.x, region.bbox.y, region.bbox.width, region.bbox.height);
    ctx.restore();

    if (isSelected) {
      drawResizeHandle(region.bbox.x, region.bbox.y, region.bbox.width, region.bbox.height);
    }
  }

  if (draftBox && draftBox.width > 4 && draftBox.height > 4) {
    ctx.save();
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(draftBox.x, draftBox.y, draftBox.width, draftBox.height);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fillRect(draftBox.x, draftBox.y, draftBox.width, draftBox.height);
    ctx.restore();
  }
}
