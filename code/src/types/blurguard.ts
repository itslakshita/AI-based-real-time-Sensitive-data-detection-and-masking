export type UserRole = 'Administrator' | 'Presenter';

export interface UserPermissions {
  managePolicies: boolean;
  manageSources: boolean;
  overrideMasks: boolean;
  exportLogs: boolean;
  triggerPanic: boolean;
}

export type DetectionCategory =
  | 'api_key'
  | 'password'
  | 'credit_card'
  | 'email'
  | 'phone'
  | 'ssn'
  | 'confidential'
  | 'qr_code'
  | 'url'
  | 'custom';

export type RiskLevel = 'Critical' | 'High' | 'Medium' | 'Low';

export type MaskingStyle = 'blur' | 'pixelate' | 'redact';

export type SourceKind =
  | 'screen'
  | 'upload'
  | 'sim-ide'
  | 'sim-crm'
  | 'sim-cloud'
  | 'sim-hr';

export type ReviewAction = 'auto_masked' | 'pending_review' | 'approved_visible' | 'manual_masked';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl: string;
  active: boolean;
  department: string;
  permissions?: UserPermissions;
  createdAt: string;
  lastLoginAt: string;
}

export interface CategoryPolicySetting {
  enabled: boolean;
  maskingStyle: MaskingStyle;
  baseRisk: RiskLevel;
}

export interface CustomDetectionRule {
  id: string;
  name: string;
  pattern: string;
  flags: string;
  riskLevel: RiskLevel;
  maskingStyle: MaskingStyle;
  enabled: boolean;
  description: string;
}

export interface ProtectionPolicy {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  minRiskThreshold: RiskLevel;
  blurIntensity: number;
  pixelBlockSize: number;
  paddingPx: number;
  requireManualReviewForUncertain: boolean;
  categories: Record<DetectionCategory, CategoryPolicySetting>;
  customRules: CustomDetectionRule[];
  updatedAt: string;
}

export interface SourceProfile {
  id: string;
  name: string;
  kind: SourceKind;
  applicationName: string;
  description: string;
  policyId: string;
  enabled: boolean;
  autoStartProtection: boolean;
  lastUsedAt: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrToken {
  id: string;
  text: string;
  confidence: number;
  bbox: BoundingBox;
  lineIndex: number;
}

export interface DetectedItem {
  id: string;
  text: string;
  maskedPreview: string;
  category: DetectionCategory;
  ruleName: string;
  confidence: number;
  riskLevel: RiskLevel;
  riskScore: number;
  bbox: BoundingBox;
  maskingStyle: MaskingStyle;
  status: ReviewAction;
  sourceLabel: string;
}

export interface ManualMaskRegion {
  id: string;
  label: string;
  bbox: BoundingBox;
  maskingStyle: MaskingStyle;
  createdAt: string;
}

export interface DetectionFeedbackEntry {
  id: string;
  userId: string;
  userName: string;
  category: DetectionCategory;
  ruleName: string;
  maskedSnippet: string;
  verdict: 'correct' | 'false_positive';
  timestamp: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  target: string;
  details: string;
  timestamp: string;
}

export interface MonitoringSession {
  id: string;
  userId: string;
  userName: string;
  sourceId: string;
  sourceName: string;
  policyId: string;
  policyName: string;
  status: 'active' | 'paused' | 'ended';
  startedAt: string;
  endedAt: string | null;
  framesProcessed: number;
  detectionsCount: number;
  maskedCount: number;
  panicTriggeredCount: number;
}

export interface DetectionLogEntry {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  sourceName: string;
  category: DetectionCategory;
  ruleName: string;
  maskedSnippet: string;
  confidence: number;
  riskLevel: RiskLevel;
  actionTaken: ReviewAction;
  maskingStyle: MaskingStyle;
  timestamp: string;
}

export interface SystemConfig {
  ocrEngine: 'tesseract_wasm' | 'hybrid_fast';
  preprocessGrayscale: boolean;
  preprocessContrastBoost: boolean;
  scanIntervalMs: number;
  confidenceThreshold: number;
  performanceMode: 'high_accuracy' | 'balanced' | 'low_cpu';
  launchAtStartup: boolean;
  autoStartMonitoring: boolean;
  systemTrayEnabled: boolean;
  localProcessingOnly: boolean;
  cloudAnalysisDisabled: boolean;
  defaultMaskingStyle: MaskingStyle;
  storeRedactedSnippetsOnly: boolean;
  retentionDays: number;
  enableSoundAlerts: boolean;
  enableDesktopAlerts: boolean;
  autoPauseOnIdleMinutes: number;
  enforceStrictPolicyForGuests: boolean;
  auditLoggingEnabled: boolean;
  updatedAt: string;
}
