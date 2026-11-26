import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { PROJECT_ROOT, requireEnv } from './src/server/loadEnv.ts';
import { db, defaultPermissionsForRole, verifyPassword } from './src/server/store.ts';
import type {
  DetectionCategory,
  DetectionFeedbackEntry,
  DetectionLogEntry,
  MonitoringSession,
  ProtectionPolicy,
  SourceProfile,
  UserPermissions,
  UserProfile,
} from './src/types/blurguard.ts';

function hasPermission(user: UserProfile | undefined, perm: keyof UserPermissions): boolean {
  if (!user) return false;
  if (user.role === 'Administrator') return true;
  return Boolean(user.permissions?.[perm]);
}

const PORT = Number(process.env.PORT) || 3000;
const TOKEN_SECRET = requireEnv('BLURGUARD_SESSION_SECRET');

interface TokenPayload {
  sub: string;
  exp: number;
}

function signToken(userId: string): string {
  const payload: TokenPayload = {
    sub: userId,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as TokenPayload;
    if (!payload.sub || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      map[k] = decodeURIComponent(v);
    }
  }
  return map;
}

interface AuthedRequest extends Request {
  user?: UserProfile;
}

function extractTokenFromRequest(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (queryToken) {
    return queryToken;
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies['bg_token'] || '';
}

function authenticate(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  const stored = db.findUserById(payload.sub);
  if (!stored || !stored.active) {
    res.status(401).json({ error: 'Account unavailable or deactivated' });
    return;
  }

  req.user = db.sanitizeUser(stored);
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'Administrator') {
    res.status(403).json({ error: 'Administrator privileges required' });
    return;
  }
  next();
}

interface SseClient {
  id: string;
  userId: string;
  role: UserProfile['role'];
  res: Response;
}

const sseClients = new Set<SseClient>();

function broadcastEvent(
  eventName: string,
  payload: unknown,
  scopeUserId?: string,
): void {
  const line = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    if (
      scopeUserId &&
      client.role !== 'Administrator' &&
      client.userId !== scopeUserId
    ) {
      continue;
    }
    try {
      client.res.write(line);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/events', authenticate, (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const client: SseClient = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      role: req.user.role,
      res,
    };
    sseClients.add(client);
    res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(client);
      }
    }, 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(client);
    });
  });

  app.post('/api/panic', authenticate, (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!hasPermission(req.user, 'triggerPanic')) {
      res.status(403).json({ error: 'You do not have permission to trigger Panic Protection' });
      return;
    }
    const { active } = req.body as { active?: boolean };
    const next = Boolean(active);
    db.appendAuditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: next ? 'PANIC_ENGAGED' : 'PANIC_CLEARED',
      target: 'Live Screen Output',
      details: next ? 'Protected output engaged' : 'Normal live monitoring resumed',
    });
    broadcastEvent('panic:updated', { userId: req.user.id, active: next }, req.user.id);
    res.json({ active: next });
  });

  // Module 1: Authentication & Profile Routes
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const stored = db.findUserByEmail(email);
    if (!stored || !verifyPassword(password, stored.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (!stored.active) {
      res.status(403).json({ error: 'This account has been deactivated by an administrator' });
      return;
    }

    const updated = db.updateUser(stored.id, { lastLoginAt: new Date().toISOString() });
    db.appendAuditLog({
      actorId: stored.id,
      actorName: stored.name,
      action: 'USER_LOGIN',
      target: stored.email,
      details: `Signed in as ${stored.role}`,
    });
    const token = signToken(stored.id);

    res.setHeader(
      'Set-Cookie',
      `bg_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`,
    );
    res.json({ user: updated, token });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { email, password, name, department, role } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      department?: string;
      role?: string;
    };

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    if (db.findUserByEmail(email)) {
      res.status(409).json({ error: 'An account with that email already exists' });
      return;
    }

    const safeRole = role === 'Administrator' ? 'Presenter' : 'Presenter';
    const user = db.createUser({
      email,
      password,
      name,
      department: department || 'Product & Engineering',
      role: safeRole,
    });
    const token = signToken(user.id);

    res.setHeader(
      'Set-Cookie',
      `bg_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`,
    );
    res.status(201).json({ user, token });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', 'bg_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', authenticate, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  app.patch('/api/auth/profile', authenticate, (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { name, department, password } = req.body as {
      name?: string;
      department?: string;
      password?: string;
    };
    if (password && password.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters' });
      return;
    }
    const updated = db.updateUser(req.user.id, {
      name: name?.trim() || req.user.name,
      department: department?.trim() || req.user.department,
      password: password || undefined,
    });
    res.json({ user: updated });
  });

  // Module 8: Policies & Detection Rules
  app.get('/api/policies', authenticate, (_req: AuthedRequest, res: Response) => {
    res.json({ policies: db.listPolicies() });
  });

  app.post('/api/policies', authenticate, (req: AuthedRequest, res: Response) => {
    if (!hasPermission(req.user, 'managePolicies')) {
      res.status(403).json({ error: 'Policy management permission required' });
      return;
    }
    const policy = req.body as ProtectionPolicy;
    if (!policy || !policy.name) {
      res.status(400).json({ error: 'Policy name is required' });
      return;
    }
    const saved = db.upsertPolicy({
      ...policy,
      id: policy.id || `pol-${crypto.randomUUID().slice(0, 8)}`,
    });
    db.appendAuditLog({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'CREATE_POLICY',
      target: saved.name,
      details: `Threshold ${saved.minRiskThreshold} · Default=${saved.isDefault}`,
    });
    broadcastEvent('policy:updated', { policy: saved });
    res.status(201).json({ policy: saved });
  });

  app.put('/api/policies/:id', authenticate, (req: AuthedRequest, res: Response) => {
    if (!hasPermission(req.user, 'managePolicies')) {
      res.status(403).json({ error: 'Policy management permission required' });
      return;
    }
    const policy = req.body as ProtectionPolicy;
    const saved = db.upsertPolicy({ ...policy, id: req.params.id });
    db.appendAuditLog({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'UPDATE_POLICY',
      target: saved.name,
      details: `Updated policy rules & masking preferences`,
    });
    broadcastEvent('policy:updated', { policy: saved });
    res.json({ policy: saved });
  });

  app.delete('/api/policies/:id', authenticate, (req: AuthedRequest, res: Response) => {
    if (!hasPermission(req.user, 'managePolicies')) {
      res.status(403).json({ error: 'Policy management permission required' });
      return;
    }
    const existing = db.listPolicies().find((p) => p.id === req.params.id);
    const deleted = db.deletePolicy(req.params.id);
    if (!deleted) {
      res.status(400).json({ error: 'Cannot delete the default or sole active policy' });
      return;
    }
    db.appendAuditLog({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'DELETE_POLICY',
      target: existing?.name || req.params.id,
      details: 'Removed protection policy preset',
    });
    broadcastEvent('policy:deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  // Module 9: Sources & Application Profiles
  app.get('/api/sources', authenticate, (_req: AuthedRequest, res: Response) => {
    res.json({ sources: db.listSources() });
  });

  app.post('/api/sources', authenticate, (req: AuthedRequest, res: Response) => {
    if (!hasPermission(req.user, 'manageSources')) {
      res.status(403).json({ error: 'Application management permission required' });
      return;
    }
    const source = req.body as SourceProfile;
    if (!source || !source.name) {
      res.status(400).json({ error: 'Source name is required' });
      return;
    }
    const saved = db.upsertSource({
      ...source,
      id: source.id || `src-${crypto.randomUUID().slice(0, 8)}`,
      lastUsedAt: source.lastUsedAt || new Date().toISOString(),
    });
    db.appendAuditLog({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'CREATE_APPLICATION',
      target: saved.applicationName,
      details: `Bound policy ${saved.policyId}`,
    });
    broadcastEvent('source:updated', { source: saved });
    res.status(201).json({ source: saved });
  });

  app.put('/api/sources/:id', authenticate, (req: AuthedRequest, res: Response) => {
    if (!hasPermission(req.user, 'manageSources')) {
      res.status(403).json({ error: 'Application management permission required' });
      return;
    }
    const source = req.body as SourceProfile;
    const saved = db.upsertSource({ ...source, id: req.params.id });
    broadcastEvent('source:updated', { source: saved });
    res.json({ source: saved });
  });

  app.delete('/api/sources/:id', authenticate, (req: AuthedRequest, res: Response) => {
    if (!hasPermission(req.user, 'manageSources')) {
      res.status(403).json({ error: 'Application management permission required' });
      return;
    }
    const deleted = db.deleteSource(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Source profile not found' });
      return;
    }
    broadcastEvent('source:deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  // Module 2 & 11: Sessions & Detection Logs
  app.get('/api/sessions', authenticate, (req: AuthedRequest, res: Response) => {
    const all = db.listSessions();
    const visible =
      req.user?.role === 'Administrator' ? all : all.filter((s) => s.userId === req.user?.id);
    res.json({ sessions: visible });
  });

  app.post('/api/sessions', authenticate, (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const body = req.body as Partial<MonitoringSession>;
    const session: MonitoringSession = {
      id: `ses-${crypto.randomUUID().slice(0, 8)}`,
      userId: req.user.id,
      userName: req.user.name,
      sourceId: body.sourceId || 'app-vscode',
      sourceName: body.sourceName || 'Live Monitor',
      policyId: body.policyId || 'pol-strict',
      policyName: body.policyName || 'Strict Enterprise Compliance',
      status: 'active',
      startedAt: new Date().toISOString(),
      endedAt: null,
      framesProcessed: 0,
      detectionsCount: 0,
      maskedCount: 0,
      panicTriggeredCount: 0,
    };
    const created = db.createSession(session);
    broadcastEvent('session:created', { session: created }, req.user.id);
    res.status(201).json({ session: created });
  });

  app.patch('/api/sessions/:id', authenticate, (req: AuthedRequest, res: Response) => {
    const patch = req.body as Partial<MonitoringSession>;
    const updated = db.updateSession(req.params.id, patch);
    if (!updated) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    broadcastEvent('session:updated', { session: updated }, updated.userId);
    res.json({ session: updated });
  });

  app.get('/api/logs', authenticate, (req: AuthedRequest, res: Response) => {
    const all = db.listLogs();
    const visible =
      req.user?.role === 'Administrator' ? all : all.filter((l) => l.userId === req.user?.id);
    res.json({ logs: visible });
  });

  app.post('/api/logs', authenticate, (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { entries } = req.body as { entries?: Partial<DetectionLogEntry>[] };
    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: 'entries array required' });
      return;
    }
    const normalized: DetectionLogEntry[] = entries.map((e) => ({
      id: e.id || `log-${crypto.randomUUID().slice(0, 8)}`,
      sessionId: e.sessionId || 'ses-live',
      userId: req.user!.id,
      userName: req.user!.name,
      sourceName: e.sourceName || 'Active Capture',
      category: e.category || 'confidential',
      ruleName: e.ruleName || 'Pattern Match',
      maskedSnippet: e.maskedSnippet || '••••••••',
      confidence: typeof e.confidence === 'number' ? e.confidence : 0.9,
      riskLevel: e.riskLevel || 'Medium',
      actionTaken: e.actionTaken || 'auto_masked',
      maskingStyle: e.maskingStyle || 'blur',
      timestamp: e.timestamp || new Date().toISOString(),
    }));
    db.appendLogs(normalized);

    const sessionId = normalized[0]?.sessionId;
    if (sessionId) {
      const targetSession = db.listSessions().find((s) => s.id === sessionId);
      if (targetSession) {
        const maskedDelta = normalized.filter((n) => n.actionTaken !== 'approved_visible').length;
        const updatedSession = db.updateSession(sessionId, {
          detectionsCount: targetSession.detectionsCount + normalized.length,
          maskedCount: targetSession.maskedCount + maskedDelta,
        });
        if (updatedSession) {
          broadcastEvent('session:updated', { session: updatedSession }, updatedSession.userId);
        }
      }
    }

    broadcastEvent('logs:appended', { entries: normalized }, req.user.id);
    res.status(201).json({ appended: normalized.length });
  });

  // Module 9 Part B: Detection Accuracy Feedback
  app.get('/api/feedback', authenticate, (req: AuthedRequest, res: Response) => {
    const all = db.listFeedback();
    const visible =
      req.user?.role === 'Administrator' ? all : all.filter((f) => f.userId === req.user?.id);
    res.json({ feedback: visible });
  });

  app.post('/api/feedback', authenticate, (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { category, ruleName, maskedSnippet, verdict } = req.body as {
      category?: DetectionCategory;
      ruleName?: string;
      maskedSnippet?: string;
      verdict?: 'correct' | 'false_positive';
    };
    if (!verdict || (verdict !== 'correct' && verdict !== 'false_positive')) {
      res.status(400).json({ error: 'verdict must be "correct" or "false_positive"' });
      return;
    }
    const entry: DetectionFeedbackEntry = {
      id: `fb-${crypto.randomUUID().slice(0, 8)}`,
      userId: req.user.id,
      userName: req.user.name,
      category: category || 'confidential',
      ruleName: ruleName || 'Pattern Match',
      maskedSnippet: maskedSnippet || '••••••••',
      verdict,
      timestamp: new Date().toISOString(),
    };
    const saved = db.appendFeedback(entry);
    db.appendAuditLog({
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'DETECTION_FEEDBACK',
      target: saved.ruleName,
      details: `Marked detection as ${verdict === 'correct' ? 'Correct' : 'False Positive'}`,
    });
    broadcastEvent('feedback:created', { feedback: saved }, req.user.id);
    res.status(201).json({ feedback: saved });
  });

  // Module 11 & 12: Administration, Users, Permissions, Audit Logs & System Configuration
  app.get('/api/config', authenticate, (_req: AuthedRequest, res: Response) => {
    res.json({ config: db.getConfig() });
  });

  app.put('/api/admin/config', authenticate, requireAdmin, (req: AuthedRequest, res: Response) => {
    const updated = db.updateConfig(req.body);
    db.appendAuditLog({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'UPDATE_CONFIG',
      target: 'System & Privacy Settings',
      details: `Engine=${updated.ocrEngine} · Perf=${updated.performanceMode} · LocalOnly=${updated.localProcessingOnly}`,
    });
    broadcastEvent('config:updated', { config: updated });
    res.json({ config: updated });
  });

  app.get('/api/admin/audit-logs', authenticate, requireAdmin, (_req: AuthedRequest, res: Response) => {
    res.json({ auditLogs: db.listAuditLogs() });
  });

  app.get('/api/admin/users', authenticate, requireAdmin, (_req: AuthedRequest, res: Response) => {
    res.json({ users: db.listUsers() });
  });

  app.post('/api/admin/users', authenticate, requireAdmin, (req: AuthedRequest, res: Response) => {
    const { email, name, password, role, department, permissions } = req.body as {
      email?: string;
      name?: string;
      password?: string;
      role?: 'Administrator' | 'Presenter';
      department?: string;
      permissions?: UserPermissions;
    };
    if (!email || !name || !password) {
      res.status(400).json({ error: 'Email, name, and password are required' });
      return;
    }
    if (db.findUserByEmail(email)) {
      res.status(409).json({ error: 'User with that email already exists' });
      return;
    }
    const safeRole = role === 'Administrator' ? 'Administrator' : 'Presenter';
    const user = db.createUser({
      email,
      name,
      password,
      role: safeRole,
      department,
      permissions: permissions || defaultPermissionsForRole(safeRole),
    });
    db.appendAuditLog({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'ADD_USER',
      target: user.email,
      details: `Added ${user.name} (${user.role})`,
    });
    res.status(201).json({ user });
  });

  app.patch('/api/admin/users/:id', authenticate, requireAdmin, (req: AuthedRequest, res: Response) => {
    const { role, active, name, department, permissions } = req.body as {
      role?: 'Administrator' | 'Presenter';
      active?: boolean;
      name?: string;
      department?: string;
      permissions?: UserPermissions;
    };
    if (req.params.id === req.user?.id && active === false) {
      res.status(400).json({ error: 'You cannot deactivate your own active administrator account' });
      return;
    }
    const updated = db.updateUser(req.params.id, { role, active, name, department, permissions });
    if (!updated) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    db.appendAuditLog({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'UPDATE_USER',
      target: updated.email,
      details: `Role=${updated.role} · Active=${updated.active}`,
    });
    res.json({ user: updated });
  });

  app.delete('/api/admin/users/:id', authenticate, requireAdmin, (req: AuthedRequest, res: Response) => {
    if (req.params.id === req.user?.id) {
      res.status(400).json({ error: 'You cannot delete your own active administrator account' });
      return;
    }
    const existing = db.findUserById(req.params.id);
    const ok = db.deleteUser(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    db.appendAuditLog({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'REMOVE_USER',
      target: existing?.email || req.params.id,
      details: `Removed member ${existing?.name || req.params.id}`,
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/logs/purge', authenticate, requireAdmin, (req: AuthedRequest, res: Response) => {
    const purged = db.purgeLogs();
    db.appendAuditLog({
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'PURGE_LOGS',
      target: 'Detection Logs',
      details: `Cleared ${purged} detection records`,
    });
    broadcastEvent('logs:purged', { purged });
    res.json({ purged });
  });

  // Vite dev middleware or production static assets
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start';
  if (!isProd) {
    const vite = await createViteServer({
      root: PROJECT_ROOT,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(PROJECT_ROOT, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BlurGuard server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BlurGuard server:', err);
  process.exit(1);
});
