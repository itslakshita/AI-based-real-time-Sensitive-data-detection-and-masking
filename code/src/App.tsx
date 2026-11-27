import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  AppWindow,
  Home,
  MoreHorizontal,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { AdminView } from './components/AdminView.tsx';
import { AuthView } from './components/AuthView.tsx';
import { LogsReportsView } from './components/LogsReportsView.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { PoliciesView } from './components/PoliciesView.tsx';
import { ProfileModal } from './components/ProfileModal.tsx';
import { ProtectionStudio } from './components/ProtectionStudio.tsx';
import { SourcesView } from './components/SourcesView.tsx';
import { apiRequest, getAuthToken, setAuthToken } from './lib/api.ts';
import type {
  DetectionLogEntry,
  MonitoringSession,
  ProtectionPolicy,
  SourceProfile,
  SystemConfig,
  UserProfile,
} from './types/blurguard.ts';

type WorkspaceTab = 'overview' | 'monitor' | 'detections' | 'policies' | 'applications' | 'settings';

const TAB_TITLES: Record<WorkspaceTab, string> = {
  overview: 'Overview',
  monitor: 'Live Monitor',
  detections: 'Detections',
  policies: 'Policies',
  applications: 'Applications',
  settings: 'Settings',
};

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [profileOpen, setProfileOpen] = useState(false);

  const [policies, setPolicies] = useState<ProtectionPolicy[]>([]);
  const [sources, setSources] = useState<SourceProfile[]>([]);
  const [sessions, setSessions] = useState<MonitoringSession[]>([]);
  const [logs, setLogs] = useState<DetectionLogEntry[]>([]);
  const [config, setConfig] = useState<SystemConfig | null>(null);

  const [selectedSourceId, setSelectedSourceId] = useState<string>('app-vscode');
  const [panicProtect, setPanicProtect] = useState<boolean>(false);

  const loadWorkspaceData = useCallback(async () => {
    const [polRes, srcRes, sesRes, logRes, cfgRes] = await Promise.all([
      apiRequest<{ policies: ProtectionPolicy[] }>('/api/policies'),
      apiRequest<{ sources: SourceProfile[] }>('/api/sources'),
      apiRequest<{ sessions: MonitoringSession[] }>('/api/sessions'),
      apiRequest<{ logs: DetectionLogEntry[] }>('/api/logs'),
      apiRequest<{ config: SystemConfig }>('/api/config'),
    ]);
    setPolicies(polRes.policies);
    setSources(srcRes.sources);
    setSessions(sesRes.sessions);
    setLogs(logRes.logs);
    setConfig(cfgRes.config);
  }, []);

  useEffect(() => {
    let mounted = true;
    apiRequest<{ user: UserProfile }>('/api/auth/me')
      .then(async (res) => {
        if (!mounted) return;
        setUser(res.user);
        await loadWorkspaceData();
      })
      .catch(() => {
        if (!mounted) return;
        setUser(null);
      })
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [loadWorkspaceData]);

  const togglePanic = useCallback((nextOrUpdater: boolean | ((prev: boolean) => boolean)) => {
    setPanicProtect((prev) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
      void apiRequest('/api/panic', {
        method: 'POST',
        body: JSON.stringify({ active: next }),
      }).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        togglePanic((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePanic]);

  useEffect(() => {
    if (!user) return;
    const token = getAuthToken();
    const url = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
    const es = new EventSource(url);

    es.addEventListener('logs:appended', (ev) => {
      try {
        const { entries } = JSON.parse((ev as MessageEvent).data) as {
          entries: DetectionLogEntry[];
        };
        if (!Array.isArray(entries) || entries.length === 0) return;
        setLogs((prev) => {
          const existingIds = new Set(prev.map((l) => l.id));
          const fresh = entries.filter((e) => !existingIds.has(e.id));
          if (fresh.length === 0) return prev;
          return [...fresh, ...prev].slice(0, 500);
        });
      } catch {
        // Ignore parse error
      }
    });

    es.addEventListener('logs:purged', () => {
      setLogs([]);
    });

    es.addEventListener('session:created', (ev) => {
      try {
        const { session } = JSON.parse((ev as MessageEvent).data) as {
          session: MonitoringSession;
        };
        setSessions((prev) =>
          prev.some((s) => s.id === session.id) ? prev : [session, ...prev],
        );
      } catch {
        // Ignore
      }
    });

    es.addEventListener('session:updated', (ev) => {
      try {
        const { session } = JSON.parse((ev as MessageEvent).data) as {
          session: MonitoringSession;
        };
        setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? session : s)),
        );
      } catch {
        // Ignore
      }
    });

    es.addEventListener('policy:updated', (ev) => {
      try {
        const { policy } = JSON.parse((ev as MessageEvent).data) as {
          policy: ProtectionPolicy;
        };
        setPolicies((prev) => {
          const normalized = policy.isDefault
            ? prev.map((p) => ({ ...p, isDefault: false }))
            : prev;
          const exists = normalized.some((p) => p.id === policy.id);
          return exists
            ? normalized.map((p) => (p.id === policy.id ? policy : p))
            : [...normalized, policy];
        });
      } catch {
        // Ignore
      }
    });

    es.addEventListener('policy:deleted', (ev) => {
      try {
        const { id } = JSON.parse((ev as MessageEvent).data) as { id: string };
        setPolicies((prev) => prev.filter((p) => p.id !== id));
      } catch {
        // Ignore
      }
    });

    es.addEventListener('source:updated', (ev) => {
      try {
        const { source } = JSON.parse((ev as MessageEvent).data) as {
          source: SourceProfile;
        };
        setSources((prev) =>
          prev.some((s) => s.id === source.id)
            ? prev.map((s) => (s.id === source.id ? source : s))
            : [...prev, source],
        );
      } catch {
        // Ignore
      }
    });

    es.addEventListener('source:deleted', (ev) => {
      try {
        const { id } = JSON.parse((ev as MessageEvent).data) as { id: string };
        setSources((prev) => prev.filter((s) => s.id !== id));
      } catch {
        // Ignore
      }
    });

    es.addEventListener('config:updated', (ev) => {
      try {
        const { config: updatedCfg } = JSON.parse((ev as MessageEvent).data) as {
          config: SystemConfig;
        };
        setConfig(updatedCfg);
      } catch {
        // Ignore
      }
    });

    es.addEventListener('panic:updated', (ev) => {
      try {
        const { active } = JSON.parse((ev as MessageEvent).data) as { active: boolean };
        setPanicProtect(Boolean(active));
      } catch {
        // Ignore
      }
    });

    return () => {
      es.close();
    };
  }, [user]);

  const activePolicy = useMemo(
    () => policies.find((p) => p.isDefault) || policies[0],
    [policies],
  );

  const highRiskBadge = useMemo(
    () => logs.filter((l) => l.riskLevel === 'Critical' || l.riskLevel === 'High').length,
    [logs],
  );

  const handleAuthenticated = async (authedUser: UserProfile) => {
    setUser(authedUser);
    await loadWorkspaceData();
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    setAuthToken(null);
    setProfileOpen(false);
    setUser(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#070E1A] flex items-center justify-center">
        <div className="text-center space-y-2">
          <Shield className="w-8 h-8 text-sky-400 mx-auto" />
          <p className="text-sm font-medium text-slate-300">Loading BlurGuard...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView onAuthenticated={handleAuthenticated} />;
  }

  const navItems: {
    id: WorkspaceTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }[] = [
    { id: 'overview', label: 'Overview', icon: <Home className="w-4 h-4 shrink-0" /> },
    { id: 'monitor', label: 'Live Monitor', icon: <Activity className="w-4 h-4 shrink-0" /> },
    {
      id: 'detections',
      label: 'Detections',
      icon: <AlertTriangle className="w-4 h-4 shrink-0" />,
      badge: highRiskBadge,
    },
    {
      id: 'policies',
      label: 'Policies',
      icon: <SlidersHorizontal className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'applications',
      label: 'Applications',
      icon: <AppWindow className="w-4 h-4 shrink-0" />,
    },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4 shrink-0" /> },
  ];

  const canTriggerPanic =
    user.role === 'Administrator' || (user.permissions?.triggerPanic ?? true);
  const canExportLogs = user.role === 'Administrator' || (user.permissions?.exportLogs ?? true);
  const canManagePolicies =
    user.role === 'Administrator' || (user.permissions?.managePolicies ?? false);
  const canManageSources =
    user.role === 'Administrator' || (user.permissions?.manageSources ?? true);

  return (
    <div className="min-h-screen bg-[#070E1A] text-slate-100 flex flex-col lg:flex-row">
      {/* Left Sidebar matching video */}
      <aside className="hidden lg:flex lg:w-[248px] lg:shrink-0 bg-[#091221] border-r border-slate-800/80 flex-col justify-between">
        <div>
          <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-800/70">
            <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
              BlurGuard
            </span>
          </div>

          <div className="px-4 pt-5 pb-2">
            <p className="text-[10px] font-semibold tracking-wider uppercase text-slate-500 px-2">
              Workspace
            </p>
          </div>

          <nav className="px-3 space-y-1" aria-label="Workspace Navigation">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#12203A] text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:bg-[#0E1729] hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </span>
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-rose-500 text-white rounded-full tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Local Protection + Workspace User Cards */}
        <div className="p-3 space-y-2.5">
          <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Local protection</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              {config?.cloudAnalysisDisabled !== false
                ? 'Screen analysis stays on this device with cloud analysis disabled.'
                : 'Screen analysis stays on this device by default.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="w-full bg-[#0E1729] hover:bg-[#131F36] border border-slate-800/90 rounded-xl p-3 flex items-center justify-between gap-2.5 text-left transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover border border-slate-700 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center text-xs font-semibold shrink-0">
                  {user.name
                    .split(' ')
                    .map((p) => p[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{user.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{user.role}</p>
              </div>
            </div>
            <MoreHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar matching video */}
        <header className="h-16 bg-[#070E1A] border-b border-slate-800/80 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex lg:hidden items-center gap-2 shrink-0">
              <div className="w-7 h-7 rounded-md bg-sky-500/15 border border-sky-400/30 text-sky-400 flex items-center justify-center">
                <Shield className="w-4 h-4" />
              </div>
              <span className="text-sm font-bold text-white">BlurGuard</span>
            </div>
            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400 min-w-0">
              <span className="text-slate-400 whitespace-nowrap">BlurGuard</span>
              <span aria-hidden="true">›</span>
              <span className="font-medium text-white truncate">{TAB_TITLES[activeTab]}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {canTriggerPanic && (config?.systemTrayEnabled ?? true) && (
              <button
                type="button"
                onClick={() => togglePanic((v) => !v)}
                title="System tray quick shield (Alt + P)"
                className={`h-8 px-3 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  panicProtect
                    ? 'bg-rose-600 border-rose-500 text-white hover:bg-rose-500'
                    : 'bg-[#0E1729] border-emerald-500/30 text-emerald-400 hover:bg-[#132038]'
                }`}
              >
                {panicProtect ? (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Protected output engaged
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Protected
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="lg:hidden px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#0E1729] rounded-lg whitespace-nowrap shrink-0"
            >
              {user.name}
            </button>
          </div>
        </header>

        {/* Mobile Navigation Strip */}
        <div className="flex lg:hidden items-center gap-1 px-4 py-2 bg-[#091221] border-b border-slate-800/80 overflow-x-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
                activeTab === item.id
                  ? 'bg-[#12203A] text-sky-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'overview' && (
            <OverviewView
              logs={logs}
              sources={sources}
              activePolicy={activePolicy}
              panicProtect={panicProtect}
              onOpenMonitor={() => setActiveTab('monitor')}
              onOpenDetections={() => setActiveTab('detections')}
              onOpenApplications={() => setActiveTab('applications')}
              onLaunchSource={(srcId) => {
                setSelectedSourceId(srcId);
                setActiveTab('monitor');
              }}
            />
          )}

          {activeTab === 'monitor' && config && (
            <ProtectionStudio
              user={user}
              policies={policies}
              sources={sources}
              config={config}
              selectedSourceId={selectedSourceId}
              onSelectSourceId={setSelectedSourceId}
              panicProtect={panicProtect}
              onTogglePanicProtect={togglePanic}
              onSessionSynced={() => void loadWorkspaceData()}
            />
          )}

          {activeTab === 'detections' && (
            <LogsReportsView logs={logs} sessions={sessions} canExport={canExportLogs} />
          )}

          {activeTab === 'policies' && (
            <PoliciesView
              policies={policies}
              canEdit={canManagePolicies}
              onRefresh={loadWorkspaceData}
            />
          )}

          {activeTab === 'applications' && (
            <SourcesView
              sources={sources}
              policies={policies}
              canManage={canManageSources}
              onRefresh={loadWorkspaceData}
              onOpenInStudio={(srcId) => {
                setSelectedSourceId(srcId);
                setActiveTab('monitor');
              }}
            />
          )}

          {activeTab === 'settings' && config && (
            <AdminView
              currentUser={user}
              config={config}
              logsCount={logs.length}
              onConfigUpdated={(cfg) => setConfig(cfg)}
              onLogsPurged={() => void loadWorkspaceData()}
            />
          )}
        </main>
      </div>

      {profileOpen && (
        <ProfileModal
          user={user}
          onClose={() => setProfileOpen(false)}
          onUpdated={(updated) => setUser(updated)}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
