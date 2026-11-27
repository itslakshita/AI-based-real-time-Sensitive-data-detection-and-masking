import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, requireEnv } from './loadEnv.ts';
import type {
  AuditLogEntry,
  DetectionFeedbackEntry,
  DetectionLogEntry,
  MonitoringSession,
  ProtectionPolicy,
  SourceProfile,
  SystemConfig,
  UserPermissions,
  UserProfile,
  UserRole,
} from '../types/blurguard.ts';

export interface StoredUser extends UserProfile {
  passwordHash: string;
}

export interface BlurGuardDatabase {
  users: StoredUser[];
  policies: ProtectionPolicy[];
  sources: SourceProfile[];
  sessions: MonitoringSession[];
  logs: DetectionLogEntry[];
  feedback: DetectionFeedbackEntry[];
  auditLogs: AuditLogEntry[];
  config: SystemConfig;
}

export function defaultPermissionsForRole(role: UserRole): UserPermissions {
  if (role === 'Administrator') {
    return {
      managePolicies: true,
      manageSources: true,
      overrideMasks: true,
      exportLogs: true,
      triggerPanic: true,
    };
  }
  return {
    managePolicies: false,
    manageSources: true,
    overrideMasks: true,
    exportLogs: true,
    triggerPanic: true,
  };
}

const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'blurguard-db.json');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function createInitialDatabase(): BlurGuardDatabase {
  const now = new Date();
  const iso = (minutesAgo: number) =>
    new Date(now.getTime() - minutesAgo * 60_000).toISOString();

  const users: StoredUser[] = [
    {
      id: 'usr-admin-01',
      email: requireEnv('SEED_ADMIN_EMAIL'),
      name: 'Elena Vance',
      role: 'Administrator',
      avatarUrl: '/src/assets/images/avatar_admin_1795010641284.jpg',
      active: true,
      department: 'Security Operations',
      permissions: defaultPermissionsForRole('Administrator'),
      createdAt: iso(60 * 24 * 30),
      lastLoginAt: iso(15),
      passwordHash: hashPassword(requireEnv('SEED_ADMIN_PASSWORD')),
    },
    {
      id: 'usr-pres-01',
      email: requireEnv('SEED_PRESENTER_EMAIL'),
      name: 'Marcus Sterling',
      role: 'Presenter',
      avatarUrl: '/src/assets/images/avatar_presenter_1795010640626.jpg',
      active: true,
      department: 'Solutions Engineering',
      permissions: defaultPermissionsForRole('Presenter'),
      createdAt: iso(60 * 24 * 18),
      lastLoginAt: iso(45),
      passwordHash: hashPassword(requireEnv('SEED_PRESENTER_PASSWORD')),
    },
    {
      id: 'usr-pres-02',
      email: requireEnv('SEED_PRESENTER_2_EMAIL'),
      name: 'Priya Nair',
      role: 'Presenter',
      avatarUrl: '',
      active: true,
      department: 'Customer Success',
      permissions: {
        managePolicies: false,
        manageSources: false,
        overrideMasks: true,
        exportLogs: false,
        triggerPanic: true,
      },
      createdAt: iso(60 * 24 * 10),
      lastLoginAt: iso(180),
      passwordHash: hashPassword(requireEnv('SEED_PRESENTER_PASSWORD')),
    },
  ];

  const policies: ProtectionPolicy[] = [
    {
      id: 'pol-strict',
      name: 'Strict Enterprise Compliance',
      description:
        'Masks all credentials, financial cards, PII, and internal keywords with maximum blur or opaque redaction.',
      isDefault: true,
      minRiskThreshold: 'Low',
      blurIntensity: 18,
      pixelBlockSize: 12,
      paddingPx: 6,
      requireManualReviewForUncertain: true,
      categories: {
        api_key: { enabled: true, maskingStyle: 'blur', baseRisk: 'Critical' },
        password: { enabled: true, maskingStyle: 'blur', baseRisk: 'Critical' },
        credit_card: { enabled: true, maskingStyle: 'blur', baseRisk: 'Critical' },
        ssn: { enabled: true, maskingStyle: 'blur', baseRisk: 'Critical' },
        email: { enabled: true, maskingStyle: 'blur', baseRisk: 'Medium' },
        phone: { enabled: true, maskingStyle: 'blur', baseRisk: 'Medium' },
        confidential: { enabled: true, maskingStyle: 'blur', baseRisk: 'High' },
        qr_code: { enabled: true, maskingStyle: 'blur', baseRisk: 'High' },
        url: { enabled: true, maskingStyle: 'blur', baseRisk: 'High' },
        custom: { enabled: true, maskingStyle: 'blur', baseRisk: 'High' },
      },
      customRules: [
        {
          id: 'rule-internal-proj',
          name: 'Internal Codename Guard',
          pattern: '\\bPROJECT[-_ ]?(?:APOLLO|HELIOS|TITAN)\\b',
          flags: 'gi',
          riskLevel: 'High',
          maskingStyle: 'redact',
          enabled: true,
          description: 'Redacts confidential internal project codenames during partner calls.',
        },
        {
          id: 'rule-iban',
          name: 'Corporate IBAN',
          pattern: '\\b[A-Z]{2}\\d{2}[A-Z0-9]{10,24}\\b',
          flags: 'g',
          riskLevel: 'Critical',
          maskingStyle: 'redact',
          enabled: true,
          description: 'Detects European/International bank account identifiers.',
        },
      ],
      updatedAt: iso(120),
    },
    {
      id: 'pol-dev',
      name: 'Developer Coding & Live IDE',
      description:
        'Protects environment secrets, API keys, database URLs, and auth tokens while keeping non-sensitive emails visible.',
      isDefault: false,
      minRiskThreshold: 'Medium',
      blurIntensity: 16,
      pixelBlockSize: 10,
      paddingPx: 6,
      requireManualReviewForUncertain: false,
      categories: {
        api_key: { enabled: true, maskingStyle: 'blur', baseRisk: 'Critical' },
        password: { enabled: true, maskingStyle: 'redact', baseRisk: 'Critical' },
        credit_card: { enabled: true, maskingStyle: 'redact', baseRisk: 'Critical' },
        ssn: { enabled: true, maskingStyle: 'redact', baseRisk: 'Critical' },
        email: { enabled: false, maskingStyle: 'blur', baseRisk: 'Low' },
        phone: { enabled: true, maskingStyle: 'blur', baseRisk: 'Medium' },
        confidential: { enabled: true, maskingStyle: 'pixelate', baseRisk: 'High' },
        qr_code: { enabled: true, maskingStyle: 'blur', baseRisk: 'High' },
        url: { enabled: true, maskingStyle: 'blur', baseRisk: 'Medium' },
        custom: { enabled: true, maskingStyle: 'blur', baseRisk: 'High' },
      },
      customRules: [
        {
          id: 'rule-db-uri',
          name: 'Postgres / Mongo Connection URI',
          pattern: '(?:postgres|mongodb\\+srv|redis):\\/\\/[^\\s"\'`]+',
          flags: 'gi',
          riskLevel: 'Critical',
          maskingStyle: 'redact',
          enabled: true,
          description: 'Masks embedded credentials inside database connection strings.',
        },
      ],
      updatedAt: iso(360),
    },
    {
      id: 'pol-demo',
      name: 'Client Product Demo',
      description:
        'Balanced masking using pixelation for customer PII and solid redaction for payment or credential fields.',
      isDefault: false,
      minRiskThreshold: 'Medium',
      blurIntensity: 14,
      pixelBlockSize: 11,
      paddingPx: 5,
      requireManualReviewForUncertain: true,
      categories: {
        api_key: { enabled: true, maskingStyle: 'redact', baseRisk: 'Critical' },
        password: { enabled: true, maskingStyle: 'redact', baseRisk: 'Critical' },
        credit_card: { enabled: true, maskingStyle: 'redact', baseRisk: 'Critical' },
        ssn: { enabled: true, maskingStyle: 'redact', baseRisk: 'Critical' },
        email: { enabled: true, maskingStyle: 'pixelate', baseRisk: 'Medium' },
        phone: { enabled: true, maskingStyle: 'pixelate', baseRisk: 'Medium' },
        confidential: { enabled: true, maskingStyle: 'blur', baseRisk: 'High' },
        qr_code: { enabled: true, maskingStyle: 'blur', baseRisk: 'High' },
        url: { enabled: true, maskingStyle: 'blur', baseRisk: 'High' },
        custom: { enabled: true, maskingStyle: 'blur', baseRisk: 'Medium' },
      },
      customRules: [],
      updatedAt: iso(720),
    },
  ];

  const sources: SourceProfile[] = [
    {
      id: 'app-vscode',
      name: 'Visual Studio Code',
      kind: 'screen',
      applicationName: 'Visual Studio Code',
      description: 'Extreme mode · Masks .env secrets, API keys, and tokens',
      policyId: 'pol-strict',
      enabled: true,
      autoStartProtection: true,
      lastUsedAt: iso(12),
    },
    {
      id: 'app-chrome',
      name: 'Google Chrome',
      kind: 'screen',
      applicationName: 'Google Chrome',
      description: 'Strict · Protects banking, dashboards, and customer data',
      policyId: 'pol-strict',
      enabled: true,
      autoStartProtection: true,
      lastUsedAt: iso(40),
    },
    {
      id: 'app-slack',
      name: 'Slack',
      kind: 'screen',
      applicationName: 'Slack',
      description: 'Normal mode · Protects direct messages and shared credentials',
      policyId: 'pol-demo',
      enabled: true,
      autoStartProtection: true,
      lastUsedAt: iso(110),
    },
    {
      id: 'app-teams',
      name: 'Microsoft Teams',
      kind: 'screen',
      applicationName: 'Microsoft Teams',
      description: 'Strict · Shields private notifications during screen shares',
      policyId: 'pol-strict',
      enabled: true,
      autoStartProtection: true,
      lastUsedAt: iso(290),
    },
  ];

  const sessions: MonitoringSession[] = [
    {
      id: 'ses-1001',
      userId: 'usr-pres-01',
      userName: 'Marcus Sterling',
      sourceId: 'app-vscode',
      sourceName: 'Visual Studio Code',
      policyId: 'pol-dev',
      policyName: 'Developer Coding & Live IDE',
      status: 'ended',
      startedAt: iso(185),
      endedAt: iso(142),
      framesProcessed: 1290,
      detectionsCount: 7,
      maskedCount: 7,
      panicTriggeredCount: 0,
    },
    {
      id: 'ses-1002',
      userId: 'usr-pres-02',
      userName: 'Priya Nair',
      sourceId: 'app-chrome',
      sourceName: 'Google Chrome',
      policyId: 'pol-strict',
      policyName: 'Strict Enterprise Compliance',
      status: 'ended',
      startedAt: iso(95),
      endedAt: iso(64),
      framesProcessed: 930,
      detectionsCount: 11,
      maskedCount: 10,
      panicTriggeredCount: 1,
    },
  ];

  const logs: DetectionLogEntry[] = [
    {
      id: 'log-2001',
      sessionId: 'ses-1001',
      userId: 'usr-pres-01',
      userName: 'Marcus Sterling',
      sourceName: 'Visual Studio Code',
      category: 'api_key',
      ruleName: 'Stripe Live Secret Key',
      maskedSnippet: 'sk_live_••••••••••••••••7f9a',
      confidence: 0.99,
      riskLevel: 'Critical',
      actionTaken: 'auto_masked',
      maskingStyle: 'redact',
      timestamp: iso(182),
    },
    {
      id: 'log-2002',
      sessionId: 'ses-1001',
      userId: 'usr-pres-01',
      userName: 'Marcus Sterling',
      sourceName: 'Visual Studio Code',
      category: 'password',
      ruleName: 'Environment Password Assignment',
      maskedSnippet: 'DB_PASSWORD=••••••••••••',
      confidence: 0.97,
      riskLevel: 'Critical',
      actionTaken: 'auto_masked',
      maskingStyle: 'redact',
      timestamp: iso(176),
    },
    {
      id: 'log-2003',
      sessionId: 'ses-1002',
      userId: 'usr-pres-02',
      userName: 'Priya Nair',
      sourceName: 'Google Chrome',
      category: 'credit_card',
      ruleName: 'Luhn-Verified Payment Card',
      maskedSnippet: '4532 •••• •••• 8910',
      confidence: 0.99,
      riskLevel: 'Critical',
      actionTaken: 'auto_masked',
      maskingStyle: 'redact',
      timestamp: iso(91),
    },
    {
      id: 'log-2004',
      sessionId: 'ses-1002',
      userId: 'usr-pres-02',
      userName: 'Priya Nair',
      sourceName: 'Google Chrome',
      category: 'email',
      ruleName: 'Customer Email Address',
      maskedSnippet: 'j.••••••@acme-corp.com',
      confidence: 0.94,
      riskLevel: 'Medium',
      actionTaken: 'approved_visible',
      maskingStyle: 'blur',
      timestamp: iso(84),
    },
    {
      id: 'log-2005',
      sessionId: 'ses-1002',
      userId: 'usr-pres-02',
      userName: 'Priya Nair',
      sourceName: 'Google Chrome',
      category: 'phone',
      ruleName: 'North American Phone Number',
      maskedSnippet: '+1 (415) •••-8421',
      confidence: 0.91,
      riskLevel: 'Medium',
      actionTaken: 'auto_masked',
      maskingStyle: 'blur',
      timestamp: iso(79),
    },
    {
      id: 'log-2006',
      sessionId: 'ses-1002',
      userId: 'usr-pres-02',
      userName: 'Priya Nair',
      sourceName: 'Google Chrome',
      category: 'confidential',
      ruleName: 'Confidential Classification Marker',
      maskedSnippet: 'CONFIDENTIAL ••••••••',
      confidence: 0.88,
      riskLevel: 'High',
      actionTaken: 'auto_masked',
      maskingStyle: 'pixelate',
      timestamp: iso(72),
    },
  ];

  const feedback: DetectionFeedbackEntry[] = [
    {
      id: 'fb-3001',
      userId: 'usr-pres-01',
      userName: 'Marcus Sterling',
      category: 'api_key',
      ruleName: 'Stripe / Payment Secret Key',
      maskedSnippet: 'sk_live_••••••••7f9a',
      verdict: 'correct',
      timestamp: iso(170),
    },
    {
      id: 'fb-3002',
      userId: 'usr-pres-02',
      userName: 'Priya Nair',
      category: 'credit_card',
      ruleName: 'Luhn-Verified Payment Card',
      maskedSnippet: '•••• •••• •••• 8910',
      verdict: 'correct',
      timestamp: iso(88),
    },
  ];

  const auditLogs: AuditLogEntry[] = [
    {
      id: 'aud-4001',
      actorId: 'usr-admin-01',
      actorName: 'Elena Vance',
      action: 'UPDATE_POLICY',
      target: 'Strict Enterprise Compliance',
      details: 'Configured default masking policy for workspace screens',
      timestamp: iso(120),
    },
    {
      id: 'aud-4002',
      actorId: 'usr-admin-01',
      actorName: 'Elena Vance',
      action: 'UPDATE_CONFIG',
      target: 'System Privacy',
      details: 'Enforced local-only processing and redacted snippet storage',
      timestamp: iso(60),
    },
  ];

  const config: SystemConfig = {
    ocrEngine: 'tesseract_wasm',
    preprocessGrayscale: true,
    preprocessContrastBoost: true,
    scanIntervalMs: 800,
    confidenceThreshold: 0.75,
    performanceMode: 'balanced',
    launchAtStartup: true,
    autoStartMonitoring: false,
    systemTrayEnabled: true,
    localProcessingOnly: true,
    cloudAnalysisDisabled: true,
    defaultMaskingStyle: 'blur',
    storeRedactedSnippetsOnly: true,
    retentionDays: 30,
    enableSoundAlerts: false,
    enableDesktopAlerts: true,
    autoPauseOnIdleMinutes: 15,
    enforceStrictPolicyForGuests: true,
    auditLoggingEnabled: true,
    updatedAt: iso(60),
  };

  return { users, policies, sources, sessions, logs, feedback, auditLogs, config };
}

class JsonStore {
  private data: BlurGuardDatabase;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<BlurGuardDatabase>;
        const fresh = createInitialDatabase();
        this.data = {
          users: (parsed.users || fresh.users).map((u) => ({
            ...u,
            permissions: u.permissions || defaultPermissionsForRole(u.role),
          })),
          policies: (parsed.policies || fresh.policies).map((p) => ({
            ...p,
            categories: {
              ...p.categories,
              qr_code: p.categories?.qr_code || {
                enabled: true,
                maskingStyle: 'blur',
                baseRisk: 'High',
              },
              url: p.categories?.url || {
                enabled: true,
                maskingStyle: 'blur',
                baseRisk: 'High',
              },
            },
          })),
          sources: parsed.sources || fresh.sources,
          sessions: parsed.sessions || fresh.sessions,
          logs: parsed.logs || fresh.logs,
          feedback: parsed.feedback || fresh.feedback,
          auditLogs: parsed.auditLogs || fresh.auditLogs,
          config: { ...fresh.config, ...(parsed.config || {}) },
        };
        const hasLegacySimSources = this.data.sources?.some(
          (s) =>
            String(s.kind).startsWith('sim-') ||
            ['src-ide', 'src-crm', 'src-cloud', 'src-hr', 'src-screen'].includes(s.id),
        );
        if (hasLegacySimSources) {
          const customSources = (this.data.sources || []).filter(
            (s) =>
              !String(s.kind).startsWith('sim-') &&
              !['src-ide', 'src-crm', 'src-cloud', 'src-hr', 'src-screen'].includes(s.id),
          );
          this.data.sources = [...fresh.sources, ...customSources];
        }
        this.persist();
      } catch {
        this.data = createInitialDatabase();
        this.persist();
      }
    } else {
      this.data = createInitialDatabase();
      this.persist();
    }
  }

  private persist(): void {
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_FILE);
  }

  public getSnapshot(): BlurGuardDatabase {
    return this.data;
  }

  public sanitizeUser(u: StoredUser): UserProfile {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      avatarUrl: u.avatarUrl,
      active: u.active,
      department: u.department,
      permissions: u.permissions || defaultPermissionsForRole(u.role),
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    };
  }

  public findUserByEmail(email: string): StoredUser | undefined {
    const normalized = email.trim().toLowerCase();
    return this.data.users.find((u) => u.email.toLowerCase() === normalized);
  }

  public findUserById(id: string): StoredUser | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  public createUser(input: {
    email: string;
    name: string;
    password: string;
    role: UserRole;
    department?: string;
    permissions?: UserPermissions;
  }): UserProfile {
    const now = new Date().toISOString();
    const user: StoredUser = {
      id: `usr-${crypto.randomUUID().slice(0, 8)}`,
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      role: input.role,
      avatarUrl: '',
      active: true,
      department: input.department?.trim() || 'General',
      permissions: input.permissions || defaultPermissionsForRole(input.role),
      createdAt: now,
      lastLoginAt: now,
      passwordHash: hashPassword(input.password),
    };
    this.data.users.push(user);
    this.persist();
    return this.sanitizeUser(user);
  }

  public updateUser(
    id: string,
    patch: Partial<
      Pick<StoredUser, 'name' | 'role' | 'active' | 'department' | 'lastLoginAt' | 'permissions'>
    > & {
      password?: string;
    },
  ): UserProfile | null {
    const idx = this.data.users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    const current = this.data.users[idx];
    const nextRole = patch.role !== undefined ? patch.role : current.role;
    const updated: StoredUser = {
      ...current,
      name: patch.name !== undefined ? patch.name : current.name,
      role: nextRole,
      active: patch.active !== undefined ? patch.active : current.active,
      department: patch.department !== undefined ? patch.department : current.department,
      permissions:
        patch.permissions !== undefined
          ? patch.permissions
          : patch.role && patch.role !== current.role
            ? defaultPermissionsForRole(nextRole)
            : current.permissions || defaultPermissionsForRole(nextRole),
      lastLoginAt: patch.lastLoginAt !== undefined ? patch.lastLoginAt : current.lastLoginAt,
      passwordHash: patch.password ? hashPassword(patch.password) : current.passwordHash,
    };
    this.data.users[idx] = updated;
    this.persist();
    return this.sanitizeUser(updated);
  }

  public deleteUser(id: string): boolean {
    const before = this.data.users.length;
    this.data.users = this.data.users.filter((u) => u.id !== id);
    if (this.data.users.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  public listUsers(): UserProfile[] {
    return this.data.users.map((u) => this.sanitizeUser(u));
  }

  public listPolicies(): ProtectionPolicy[] {
    return this.data.policies;
  }

  public upsertPolicy(policy: ProtectionPolicy): ProtectionPolicy {
    const now = new Date().toISOString();
    const clean: ProtectionPolicy = { ...policy, updatedAt: now };
    if (clean.isDefault) {
      this.data.policies = this.data.policies.map((p) => ({ ...p, isDefault: false }));
    }
    const idx = this.data.policies.findIndex((p) => p.id === clean.id);
    if (idx >= 0) {
      this.data.policies[idx] = clean;
    } else {
      this.data.policies.push(clean);
    }
    this.persist();
    return clean;
  }

  public deletePolicy(id: string): boolean {
    if (this.data.policies.length <= 1) return false;
    const target = this.data.policies.find((p) => p.id === id);
    if (!target || target.isDefault) return false;
    this.data.policies = this.data.policies.filter((p) => p.id !== id);
    const fallbackId = this.data.policies[0].id;
    this.data.sources = this.data.sources.map((s) =>
      s.policyId === id ? { ...s, policyId: fallbackId } : s,
    );
    this.persist();
    return true;
  }

  public listSources(): SourceProfile[] {
    return this.data.sources;
  }

  public upsertSource(source: SourceProfile): SourceProfile {
    const idx = this.data.sources.findIndex((s) => s.id === source.id);
    if (idx >= 0) {
      this.data.sources[idx] = source;
    } else {
      this.data.sources.push(source);
    }
    this.persist();
    return source;
  }

  public deleteSource(id: string): boolean {
    const before = this.data.sources.length;
    this.data.sources = this.data.sources.filter((s) => s.id !== id);
    if (this.data.sources.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  public listSessions(): MonitoringSession[] {
    return [...this.data.sessions].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }

  public createSession(session: MonitoringSession): MonitoringSession {
    this.data.sessions.unshift(session);
    this.persist();
    return session;
  }

  public updateSession(id: string, patch: Partial<MonitoringSession>): MonitoringSession | null {
    const idx = this.data.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    this.data.sessions[idx] = { ...this.data.sessions[idx], ...patch };
    this.persist();
    return this.data.sessions[idx];
  }

  public listLogs(): DetectionLogEntry[] {
    return [...this.data.logs].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  public appendLogs(entries: DetectionLogEntry[]): void {
    if (!this.data.config.auditLoggingEnabled || entries.length === 0) return;
    this.data.logs.unshift(...entries);
    if (this.data.logs.length > 500) {
      this.data.logs = this.data.logs.slice(0, 500);
    }
    this.persist();
  }

  public purgeLogs(): number {
    const count = this.data.logs.length;
    this.data.logs = [];
    this.persist();
    return count;
  }

  public listFeedback(): DetectionFeedbackEntry[] {
    return [...this.data.feedback].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  public appendFeedback(entry: DetectionFeedbackEntry): DetectionFeedbackEntry {
    this.data.feedback.unshift(entry);
    if (this.data.feedback.length > 500) {
      this.data.feedback = this.data.feedback.slice(0, 500);
    }
    this.persist();
    return entry;
  }

  public listAuditLogs(): AuditLogEntry[] {
    return [...this.data.auditLogs].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  public appendAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry | null {
    if (!this.data.config.auditLoggingEnabled) return null;
    const created: AuditLogEntry = {
      ...entry,
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
    };
    this.data.auditLogs.unshift(created);
    if (this.data.auditLogs.length > 500) {
      this.data.auditLogs = this.data.auditLogs.slice(0, 500);
    }
    this.persist();
    return created;
  }

  public getConfig(): SystemConfig {
    return this.data.config;
  }

  public updateConfig(patch: Partial<SystemConfig>): SystemConfig {
    this.data.config = {
      ...this.data.config,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.data.config;
  }
}

export const db = new JsonStore();
