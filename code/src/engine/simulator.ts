import type { OcrToken } from '../types/blurguard.ts';

export const SIM_WIDTH = 1120;
export const SIM_HEIGHT = 560;

function drawTextWithTokens(
  ctx: CanvasRenderingContext2D,
  text: string,
  startX: number,
  y: number,
  font: string,
  color: string,
  lineIndex: number,
  tokens: OcrToken[],
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';

  const metricsSample = ctx.measureText('Mg');
  const lineHeight =
    (metricsSample.actualBoundingBoxAscent || 12) +
    (metricsSample.actualBoundingBoxDescent || 4) +
    6;

  const words = text.split(/\s+/).filter(Boolean);
  let cursorX = startX;
  const spaceWidth = ctx.measureText(' ').width;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const w = ctx.measureText(word).width;
    ctx.fillText(word, cursorX, y);
    tokens.push({
      id: `demo-${lineIndex}-${i}`,
      text: word,
      confidence: 0.99,
      bbox: {
        x: cursorX,
        y: y - 1,
        width: w,
        height: Math.max(18, lineHeight),
      },
      lineIndex,
    });
    cursorX += w + spaceWidth;
  }
}

export function renderDemoScreen(canvas: HTMLCanvasElement): OcrToken[] {
  canvas.width = SIM_WIDTH;
  canvas.height = SIM_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const tokens: OcrToken[] = [];

  // Outer browser/editor frame matching video
  ctx.fillStyle = '#070E1A';
  ctx.fillRect(0, 0, SIM_WIDTH, SIM_HEIGHT);

  // Top browser address bar
  ctx.fillStyle = '#0D1628';
  ctx.fillRect(0, 0, SIM_WIDTH, 46);
  ctx.strokeStyle = '#1E293B';
  ctx.beginPath();
  ctx.moveTo(0, 46);
  ctx.lineTo(SIM_WIDTH, 46);
  ctx.stroke();

  // Window dots
  const dotColors = ['#EF4444', '#F59E0B', '#10B981'];
  dotColors.forEach((c, idx) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(26 + idx * 20, 23, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  // URL pill
  ctx.fillStyle = '#091120';
  ctx.strokeStyle = '#1E293B';
  ctx.beginPath();
  ctx.roundRect(102, 11, 220, 24, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 12px "JetBrains Mono", monospace';
  ctx.fillText('localhost / demo-screen', 120, 27);

  // Left Explorer Sidebar
  ctx.fillStyle = '#0A1221';
  ctx.fillRect(0, 46, 210, SIM_HEIGHT - 46);
  ctx.strokeStyle = '#1E293B';
  ctx.beginPath();
  ctx.moveTo(210, 46);
  ctx.lineTo(210, SIM_HEIGHT);
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('EXPLORER', 28, 84);

  const files = ['src', 'components', 'lib', '.env', 'package.json'];
  files.forEach((file, idx) => {
    const fy = 120 + idx * 38;
    ctx.fillStyle = file === '.env' ? '#F43F5E' : '#94A3B8';
    ctx.font = '500 14px "JetBrains Mono", monospace';
    ctx.fillText(file, 28, fy);
  });

  const lines = [
    { num: '01', text: 'DATABASE_URL=postgres://admin:ProdPass992@db.internal:5432/app', color: '#CBD5E1' },
    { num: '02', text: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE', color: '#CBD5E1' },
    { num: '03', text: 'API_KEY=sk_live_51Nx92KmQp84LzR9201x7f9a', color: '#CBD5E1' },
    { num: '04', text: 'SUPPORT_EMAIL=security.ops@company-demo.io', color: '#CBD5E1' },
    { num: '05', text: 'NODE_ENV=production', color: '#94A3B8' },
  ];

  lines.forEach((line, idx) => {
    const y = 114 + idx * 46;
    ctx.fillStyle = '#475569';
    ctx.font = '400 14px "JetBrains Mono", monospace';
    ctx.fillText(line.num, 248, y);

    drawTextWithTokens(
      ctx,
      line.text,
      290,
      y,
      '500 15px "JetBrains Mono", monospace',
      line.color,
      idx,
      tokens,
    );
  });

  return tokens;
}
