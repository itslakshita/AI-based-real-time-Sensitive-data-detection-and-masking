import type {
  BoundingBox,
  DetectedItem,
  DetectionCategory,
  MaskingStyle,
  OcrToken,
  ProtectionPolicy,
  ReviewAction,
  RiskLevel,
} from '../types/blurguard.ts';

const RISK_ORDER: Record<RiskLevel, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

export function luhnCheck(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = parseInt(digits[i], 10);
    if (Number.isNaN(digit)) return false;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function shannonEntropy(str: string): number {
  if (!str) return 0;
  const freq: Record<string, number> = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let entropy = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isLikelySecretString(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 20) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  const hasLower = /[a-z]/.test(trimmed);
  const hasUpper = /[A-Z]/.test(trimmed);
  const hasDigitOrSymbol = /[0-9/+_-]/.test(trimmed);
  return hasLower && hasUpper && hasDigitOrSymbol && shannonEntropy(trimmed) >= 3.6;
}

export function maskSnippet(raw: string, category: DetectionCategory): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 4) return '••••';
  if (category === 'email') {
    const atIdx = trimmed.indexOf('@');
    if (atIdx > 1) {
      return `${trimmed[0]}••••${trimmed.slice(atIdx)}`;
    }
  }
  if (category === 'credit_card') {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 4) {
      return `•••• •••• •••• ${digits.slice(-4)}`;
    }
  }
  if (category === 'password') {
    const eqIdx = trimmed.search(/[:=]/);
    if (eqIdx > 0) {
      return `${trimmed.slice(0, eqIdx + 1)} ••••••••••`;
    }
    return '••••••••••••';
  }
  if (category === 'url') {
    const schemeMatch = trimmed.match(/^https?:\/\//i);
    if (schemeMatch) {
      return `${schemeMatch[0]}••••••••${trimmed.slice(-4)}`;
    }
    return `url ••••••••${trimmed.slice(-4)}`;
  }
  if (trimmed.length > 10) {
    return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
  }
  return `${trimmed.slice(0, 2)}••••••`;
}

function mergeBoxes(boxes: BoundingBox[]): BoundingBox {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(8, maxX - minX),
    height: Math.max(8, maxY - minY),
  };
}

interface BuiltinRule {
  category: DetectionCategory;
  ruleName: string;
  regex: RegExp;
  baseConfidence: number;
  maskOnlyValue?: boolean;
  validate?: (match: string) => boolean;
}

const BUILTIN_RULES: BuiltinRule[] = [
  {
    category: 'api_key',
    ruleName: 'Stripe / Payment Secret Key',
    regex: /\b(?:sk_live|sk_test|pk_live|rk_live)_[A-Za-z0-9]{10,}\b/g,
    baseConfidence: 0.99,
  },
  {
    category: 'api_key',
    ruleName: 'AI / Cloud API Key',
    regex:
      /\b(?:sk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{14,}|(?:ghp|gho|ghu|ghs|AIza|xoxb|xoxp|hf_)[A-Za-z0-9_-]{12,})\b/g,
    baseConfidence: 0.99,
  },
  {
    category: 'api_key',
    ruleName: 'AWS Access Key ID',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    baseConfidence: 0.99,
  },
  {
    category: 'api_key',
    ruleName: 'JWT / Bearer Token',
    regex: /\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
    baseConfidence: 0.98,
  },
  {
    category: 'api_key',
    ruleName: 'High-Entropy Secret Key',
    regex: /\b[A-Za-z0-9][A-Za-z0-9/+_-]{19,}\b/g,
    baseConfidence: 0.93,
    validate: (m) => isLikelySecretString(m),
  },
  {
    category: 'password',
    ruleName: 'Database Connection URI Secret',
    regex:
      /(?:postgres|postgresql|mongodb(?:\+srv)?|mysql|redis):\/\/[^\s:"'`]+:[^\s@"'`]+@[^\s"'`]+/gi,
    baseConfidence: 0.99,
  },
  {
    category: 'password',
    ruleName: 'Credential / Secret Assignment',
    regex:
      /\b[A-Z0-9_]*(?:PASSWORD|PASSWD|PASSCODE|PWD|DB_PASS|API_KEY|API_SECRET|SECRET_KEY|AWS_SECRET_ACCESS_KEY|CLIENT_SECRET|AUTH_SECRET|JWT_SECRET|ACCESS_TOKEN|PRIVATE_KEY|TOKEN|SECRET|PIN)\b\s*(?:[:=]|is\b)\s*["']?([^\s"';,]{3,})["']?/gi,
    baseConfidence: 0.96,
    maskOnlyValue: true,
  },
  {
    category: 'api_key',
    ruleName: 'Bearer Authorization Header',
    regex: /\bBearer\s+([A-Za-z0-9._-]{12,})/gi,
    baseConfidence: 0.97,
    maskOnlyValue: true,
  },
  {
    category: 'credit_card',
    ruleName: 'Luhn-Verified Payment Card',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    baseConfidence: 0.99,
    validate: (m) => luhnCheck(m),
  },
  {
    category: 'ssn',
    ruleName: 'Contextual ID / Account / Card Number',
    regex:
      /\b(?:id|ssn|aadhar|aadhaar|pan|passport|license|account|acct|debit\s+card|credit\s+card|card|cvv|otp|code\s*name|codename)\b(?:\s*(?:no\.?|number|num|id)?\s*(?:is)?\s*[:=-]+|\s+is\b)\s*([A-Za-z0-9._-]{4,28})/gi,
    baseConfidence: 0.93,
    maskOnlyValue: true,
  },
  {
    category: 'ssn',
    ruleName: 'US Social Security / Tax ID',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    baseConfidence: 0.95,
  },
  {
    category: 'email',
    ruleName: 'Email Address',
    regex: /(?:\b[A-Za-z0-9._%+-]+)?@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    baseConfidence: 0.95,
  },
  {
    category: 'phone',
    ruleName: 'Phone Number',
    regex:
      /(?:\+\d{1,3}[\s.-]?(?:\d[\s.-]?){7,12}\d|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})\b/g,
    baseConfidence: 0.9,
  },
  {
    category: 'url',
    ruleName: 'Web Link / Address Bar URL',
    regex:
      /(?:https?:\s*\/\/[^\s"'<>|]{3,}|\bwww\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/[^\s"'<>|]*)?)/gi,
    baseConfidence: 0.96,
  },
  {
    category: 'url',
    ruleName: 'Domain Path / Query URL',
    regex:
      /\b[a-z0-9-]{2,}(?:\.[a-z0-9-]{2,})+\/(?:[^\s"'<>|]*[?&=][^\s"'<>|]+|[^\s"'<>|]{4,})/gi,
    baseConfidence: 0.91,
  },
  {
    category: 'confidential',
    ruleName: 'Confidentiality & Restricted Marker',
    regex:
      /\b(?:CONFIDENTIAL|INTERNAL ONLY|DO NOT DISTRIBUTE|STRICTLY PRIVATE|SALARY REVIEW|RESTRICTED)\b/gi,
    baseConfidence: 0.86,
  },
];

function computeRiskAssessment(
  category: DetectionCategory,
  confidence: number,
  matchedText: string,
  policy: ProtectionPolicy,
): { riskLevel: RiskLevel; riskScore: number; maskingStyle: MaskingStyle } {
  const catSetting = policy.categories[category];
  let level: RiskLevel = catSetting?.baseRisk || 'Medium';
  let score =
    level === 'Critical' ? 92 : level === 'High' ? 76 : level === 'Medium' ? 54 : 28;

  const lower = matchedText.toLowerCase();
  if (lower.includes('live') || lower.includes('prod') || lower.includes('secret')) {
    score = Math.min(100, score + 6);
  }
  score = Math.round(score * (0.65 + 0.35 * confidence));

  if (score >= 88) level = 'Critical';
  else if (score >= 68) level = 'High';
  else if (score >= 42) level = 'Medium';
  else level = 'Low';

  const maskingStyle: MaskingStyle = catSetting?.maskingStyle || 'blur';
  return { riskLevel: level, riskScore: score, maskingStyle };
}

interface LineTokenSpan {
  token: OcrToken;
  start: number;
  end: number;
}

export function detectSensitiveData(
  tokens: OcrToken[],
  policy: ProtectionPolicy,
  sourceLabel: string,
  overrides?: Record<string, ReviewAction>,
  options?: {
    minConfidence?: number;
    bboxOverrides?: Record<string, BoundingBox>;
    styleOverrides?: Record<string, MaskingStyle>;
  },
): DetectedItem[] {
  if (tokens.length === 0) return [];
  const minConf = options?.minConfidence ?? 0;

  const byLine = new Map<number, OcrToken[]>();
  for (const t of tokens) {
    const arr = byLine.get(t.lineIndex) || [];
    arr.push(t);
    byLine.set(t.lineIndex, arr);
  }

  const orderedLines = Array.from(byLine.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([lineIdx, lineTokens]) => ({
      lineIdx,
      tokens: [...lineTokens].sort((a, b) => a.bbox.x - b.bbox.x),
    }));

  // Build evaluation windows: each single line PLUS stitched adjacent line pairs (for wrapped keys, emails, and IDs)
  const segments: { text: string; spans: LineTokenSpan[] }[] = [];

  const buildSpans = (tokList: OcrToken[], joinWithoutSpaceAt?: Set<number>) => {
    let text = '';
    const spans: LineTokenSpan[] = [];
    for (let i = 0; i < tokList.length; i += 1) {
      const tok = tokList[i];
      if (text.length > 0 && !joinWithoutSpaceAt?.has(i)) {
        text += ' ';
      }
      const start = text.length;
      text += tok.text;
      const end = text.length;
      spans.push({ token: tok, start, end });
    }
    return { text, spans };
  };

  for (let i = 0; i < orderedLines.length; i += 1) {
    segments.push(buildSpans(orderedLines[i].tokens));

    if (i + 1 < orderedLines.length) {
      const curr = orderedLines[i].tokens;
      const next = orderedLines[i + 1].tokens;
      const lastCurr = curr[curr.length - 1]?.text || '';
      const firstNext = next[0]?.text || '';

      const shouldJoinTight =
        lastCurr.endsWith('=') ||
        lastCurr.endsWith(':') ||
        lastCurr.endsWith('/') ||
        firstNext.startsWith('@') ||
        (lastCurr.length >= 16 && !lastCurr.includes(' ') && /^[A-Za-z0-9/+_=-]+$/.test(lastCurr));

      const joinIdx = shouldJoinTight ? new Set([curr.length]) : undefined;
      segments.push(buildSpans([...curr, ...next], joinIdx));
    }
  }

  const detections: DetectedItem[] = [];
  const seenBoxes: { x: number; y: number; w: number; h: number }[] = [];

  for (const seg of segments) {
    const { text: lineText, spans } = seg;

    const collectMatch = (
      matchStart: number,
      matchEnd: number,
      matchedText: string,
      category: DetectionCategory,
      ruleName: string,
      baseConf: number,
      forcedRisk?: RiskLevel,
      forcedMask?: MaskingStyle,
    ) => {
      const overlapped = spans.filter((s) => s.end > matchStart && s.start < matchEnd);
      if (overlapped.length === 0) return;

      // Group bounding boxes per visual line so wrapped matches don't blur unrelated text across the screen
      const groupedByLine = new Map<number, LineTokenSpan[]>();
      for (const s of overlapped) {
        const arr = groupedByLine.get(s.token.lineIndex) || [];
        arr.push(s);
        groupedByLine.set(s.token.lineIndex, arr);
      }

      for (const lineSpans of groupedByLine.values()) {
        const avgOcrConf =
          lineSpans.reduce((acc, s) => acc + s.token.confidence, 0) / lineSpans.length;
        const confidence = Math.min(0.99, Number((baseConf * (0.7 + 0.3 * avgOcrConf)).toFixed(2)));
        const bbox = mergeBoxes(lineSpans.map((s) => s.token.bbox));

        const dup = seenBoxes.some(
          (sb) =>
            Math.abs(sb.x - bbox.x) < 10 &&
            Math.abs(sb.y - bbox.y) < 10 &&
            Math.abs(sb.w - bbox.width) < 18,
        );
        if (dup) continue;
        seenBoxes.push({ x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height });

        const assessed = computeRiskAssessment(category, confidence, matchedText, policy);
        const riskLevel = forcedRisk || assessed.riskLevel;
        const maskingStyle = forcedMask || assessed.maskingStyle;

        if (RISK_ORDER[riskLevel] < RISK_ORDER[policy.minRiskThreshold]) {
          continue;
        }

        const stableId = `det-${Math.round(bbox.x)}-${Math.round(bbox.y)}-${category}-${matchedText.length}`;
        if (confidence < minConf && !overrides?.[stableId]) {
          continue;
        }
        const finalBbox = options?.bboxOverrides?.[stableId] || bbox;
        const finalStyle = options?.styleOverrides?.[stableId] || maskingStyle;
        const overrideStatus = overrides?.[stableId];
        let status: ReviewAction = 'auto_masked';
        if (overrideStatus) {
          status = overrideStatus;
        } else if (policy.requireManualReviewForUncertain && confidence < 0.86) {
          status = 'pending_review';
        }

        detections.push({
          id: stableId,
          text: matchedText,
          maskedPreview: maskSnippet(matchedText, category),
          category,
          ruleName,
          confidence,
          riskLevel,
          riskScore: assessed.riskScore,
          bbox: finalBbox,
          maskingStyle: finalStyle,
          status,
          sourceLabel,
        });
      }
    };

    for (const rule of BUILTIN_RULES) {
      const catPolicy = policy.categories[rule.category];
      if (!catPolicy || !catPolicy.enabled) continue;

      const regex = new RegExp(rule.regex.source, rule.regex.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(lineText)) !== null) {
        const fullMatch = match[0];
        if (!fullMatch) break;
        if (rule.validate && !rule.validate(fullMatch)) {
          continue;
        }
        let targetText = fullMatch;
        let targetStart = match.index;
        let targetEnd = match.index + fullMatch.length;

        if (rule.maskOnlyValue && match[1]) {
          const valIdx = fullMatch.lastIndexOf(match[1]);
          if (valIdx >= 0) {
            targetStart = match.index + valIdx;
            targetEnd = targetStart + match[1].length;
            targetText = match[1];
          }
        }
        collectMatch(
          targetStart,
          targetEnd,
          targetText,
          rule.category,
          rule.ruleName,
          rule.baseConfidence,
        );
      }
    }

    for (const custom of policy.customRules) {
      if (!custom.enabled || !policy.categories.custom?.enabled) continue;
      try {
        const flags = custom.flags.includes('g') ? custom.flags : `${custom.flags}g`;
        const regex = new RegExp(custom.pattern, flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(lineText)) !== null) {
          if (!match[0]) break;
          collectMatch(
            match.index,
            match.index + match[0].length,
            match[0],
            'custom',
            custom.name,
            0.93,
            custom.riskLevel,
            custom.maskingStyle,
          );
        }
      } catch {
        // Ignore malformed user regex gracefully
      }
    }
  }

  return detections.sort((a, b) => RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel]);
}
