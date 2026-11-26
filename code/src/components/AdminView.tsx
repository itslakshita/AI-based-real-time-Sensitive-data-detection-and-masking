import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  Lock,
  Plus,
  Save,
  Shield,
  Sliders,
  Trash2,
  UserCog,
} from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import type {
  AuditLogEntry,
  DetectionFeedbackEntry,
  MaskingStyle,
  SystemConfig,
  UserPermissions,
  UserProfile,
  UserRole,
} from '../types/blurguard.ts';

interface AdminViewProps {
  currentUser: UserProfile;
  config: SystemConfig;
  logsCount: number;
  onConfigUpdated: (cfg: SystemConfig) => void;
  onLogsPurged: () => void;
}

type AdminSectionTab = 'users' | 'models' | 'audit';

const PERMISSION_LABELS: { key: keyof UserPermissions; label: string }[] = [
  { key: 'managePolicies', label: 'Policies' },
  { key: 'manageSources', label: 'Apps' },
  { key: 'overrideMasks', label: 'Manual Review' },
  { key: 'exportLogs', label: 'Export Logs' },
  { key: 'triggerPanic', label: 'Panic Shield' },
];

export const AdminView: React.FC<AdminViewProps> = ({
  currentUser,
  config,
  logsCount,
  onConfigUpdated,
  onLogsPurged,
}) => {
  const isAdmin = currentUser.role === 'Administrator';
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [feedbackList, setFeedbackList] = useState<DetectionFeedbackEntry[]>([]);
  const [cfgDraft, setCfgDraft] = useState<SystemConfig>(config);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showTeamAdmin, setShowTeamAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminSectionTab>('users');

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('BlurGuard@2026');
  const [newRole, setNewRole] = useState<UserRole>('Presenter');

  useEffect(() => {
    setCfgDraft(config);
  }, [config]);

  useEffect(() => {
    if (!isAdmin) return;
    void Promise.all([
      apiRequest<{ users: UserProfile[] }>('/api/admin/users'),
      apiRequest<{ auditLogs: AuditLogEntry[] }>('/api/admin/audit-logs'),
      apiRequest<{ feedback: DetectionFeedbackEntry[] }>('/api/feedback'),
    ]).then(([uRes, aRes, fRes]) => {
      setUsers(uRes.users);
      setAuditLogs(aRes.auditLogs);
      setFeedbackList(fRes.feedback);
    });
  }, [isAdmin]);

  const feedbackStats = useMemo(() => {
    const total = feedbackList.length;
    const correct = feedbackList.filter((f) => f.verdict === 'correct').length;
    const falsePos = total - correct;
    const precision = total > 0 ? Math.round((correct / total) * 100) : 100;
    return { total, correct, falsePos, precision };
  }, [feedbackList]);

  const handleSaveConfig = async (nextDraft?: SystemConfig) => {
    const payload = nextDraft || cfgDraft;
    if (!isAdmin) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ config: SystemConfig }>('/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      onConfigUpdated(res.config);
      setStatusMsg('Settings saved.');
      const aRes = await apiRequest<{ auditLogs: AuditLogEntry[] }>('/api/admin/audit-logs');
      setAuditLogs(aRes.auditLogs);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ user: UserProfile }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newName,
          email: newEmail,
          password: newPassword,
          role: newRole,
          department: 'General',
        }),
      });
      setUsers((prev) => [...prev, res.user]);
      setNewName('');
      setNewEmail('');
      setStatusMsg(`Added ${res.user.name}.`);
      const aRes = await apiRequest<{ auditLogs: AuditLogEntry[] }>('/api/admin/audit-logs');
      setAuditLogs(aRes.auditLogs);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add user');
    }
  };

  const handleUpdateUser = async (
    id: string,
    patch: Partial<Pick<UserProfile, 'role' | 'active' | 'permissions'>>,
  ) => {
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ user: UserProfile }>(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setUsers((prev) => prev.map((u) => (u.id === id ? res.user : u)));
      const aRes = await apiRequest<{ auditLogs: AuditLogEntry[] }>('/api/admin/audit-logs');
      setAuditLogs(aRes.auditLogs);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  const handleToggleUserPermission = (u: UserProfile, key: keyof UserPermissions) => {
    const currentPerms: UserPermissions = u.permissions || {
      managePolicies: u.role === 'Administrator',
      manageSources: true,
      overrideMasks: true,
      exportLogs: true,
      triggerPanic: true,
    };
    const nextPerms: UserPermissions = {
      ...currentPerms,
      [key]: !currentPerms[key],
    };
    void handleUpdateUser(u.id, { permissions: nextPerms });
  };

  const handleDeleteUser = async (id: string) => {
    setErrorMsg(null);
    try {
      await apiRequest(`/api/admin/users/${id}`, { method: 'DELETE' });
      setUsers((prev) => prev.filter((u) => u.id !== id));
      const aRes = await apiRequest<{ auditLogs: AuditLogEntry[] }>('/api/admin/audit-logs');
      setAuditLogs(aRes.auditLogs);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const handlePurgeLogs = async () => {
    const res = await apiRequest<{ purged: number }>('/api/admin/logs/purge', {
      method: 'POST',
    });
    onLogsPurged();
    setStatusMsg(`Cleared ${res.purged} activity records.`);
    const aRes = await apiRequest<{ auditLogs: AuditLogEntry[] }>('/api/admin/audit-logs');
    setAuditLogs(aRes.auditLogs);
  };

  const SwitchToggle: React.FC<{
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
    label: string;
  }> = ({ checked, disabled, onChange, label }) => (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 disabled:opacity-60 ${
        checked ? 'bg-emerald-500' : 'bg-slate-700'
      }`}
    >
      <span
        className={`block w-5 h-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );

  return (
    <div className="space-y-5">
      {/* Header matching video */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Settings</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            System behavior, privacy guarantees, and workspace administration.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => void handleSaveConfig()}
            className="h-9 px-4 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            Save settings
          </button>
        )}
      </div>

      {statusMsg && (
        <div className="text-xs text-emerald-300 bg-emerald-950/50 border border-emerald-800/70 rounded-xl px-4 py-2.5">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="text-xs text-rose-300 bg-rose-950/50 border border-rose-800/70 rounded-xl px-4 py-2.5">
          {errorMsg}
        </div>
      )}

      {/* Module 12 Part A: System Settings */}
      <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">System Settings</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Startup, notifications, performance, and local storage controls.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
          <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-white">Launch at startup</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Prepare BlurGuard guard service when workspace opens.
              </p>
            </div>
            <SwitchToggle
              label="Launch at startup"
              checked={cfgDraft.launchAtStartup}
              disabled={!isAdmin}
              onChange={() =>
                setCfgDraft({ ...cfgDraft, launchAtStartup: !cfgDraft.launchAtStartup })
              }
            />
          </div>

          <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-white">Start monitoring automatically</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Arm screen guard immediately on entering Live Monitor.
              </p>
            </div>
            <SwitchToggle
              label="Start monitoring automatically"
              checked={cfgDraft.autoStartMonitoring}
              disabled={!isAdmin}
              onChange={() =>
                setCfgDraft({
                  ...cfgDraft,
                  autoStartMonitoring: !cfgDraft.autoStartMonitoring,
                })
              }
            />
          </div>

          <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-white">System tray</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Keep quick-shield status and Panic toggle accessible.
              </p>
            </div>
            <SwitchToggle
              label="System tray"
              checked={cfgDraft.systemTrayEnabled}
              disabled={!isAdmin}
              onChange={() =>
                setCfgDraft({ ...cfgDraft, systemTrayEnabled: !cfgDraft.systemTrayEnabled })
              }
            />
          </div>

          <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-white">Notifications</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Alert presenter when critical exposures are masked.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!isAdmin}
                  checked={cfgDraft.enableSoundAlerts}
                  onChange={(e) =>
                    setCfgDraft({ ...cfgDraft, enableSoundAlerts: e.target.checked })
                  }
                  className="rounded border-slate-700 bg-[#080F1E] text-sky-500"
                />
                Sound
              </label>
              <SwitchToggle
                label="Notifications"
                checked={cfgDraft.enableDesktopAlerts}
                disabled={!isAdmin}
                onChange={() =>
                  setCfgDraft({
                    ...cfgDraft,
                    enableDesktopAlerts: !cfgDraft.enableDesktopAlerts,
                  })
                }
              />
            </div>
          </div>

          <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-white">Performance</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Balance real-time OCR resolution and CPU usage.
              </p>
            </div>
            <select
              aria-label="Performance mode"
              disabled={!isAdmin}
              value={cfgDraft.performanceMode}
              onChange={(e) =>
                setCfgDraft({
                  ...cfgDraft,
                  performanceMode: e.target.value as SystemConfig['performanceMode'],
                })
              }
              className="h-8 px-2.5 text-xs bg-[#0E1729] border border-slate-700 text-white rounded-md disabled:opacity-60"
            >
              <option value="high_accuracy">High Accuracy</option>
              <option value="balanced">Balanced</option>
              <option value="low_cpu">Low CPU</option>
            </select>
          </div>

          <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-white">Storage & retention</p>
              <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                {logsCount} events stored · Auto-expire after {cfgDraft.retentionDays} days
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                aria-label="Retention days"
                disabled={!isAdmin}
                value={cfgDraft.retentionDays}
                onChange={(e) =>
                  setCfgDraft({ ...cfgDraft, retentionDays: Number(e.target.value) })
                }
                className="h-8 px-2 text-xs bg-[#0E1729] border border-slate-700 text-white rounded-md disabled:opacity-60"
              >
                <option value={7}>7 Days</option>
                <option value={30}>30 Days</option>
                <option value={90}>90 Days</option>
              </select>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handlePurgeLogs}
                  className="h-8 px-2.5 text-[11px] font-medium text-rose-300 bg-rose-950/50 hover:bg-rose-950 border border-rose-800/70 rounded-md whitespace-nowrap"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Module 12 Part B: Privacy Controls */}
      <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Privacy</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Local processing, zero raw secret retention, and offline-first guarantees.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-[#091120] border border-slate-800/80 rounded-lg p-4 flex flex-col justify-between gap-3">
            <div className="flex items-start justify-between gap-2">
              <Cpu className="w-4 h-4 text-sky-400" />
              <SwitchToggle
                label="Local processing"
                checked={cfgDraft.localProcessingOnly}
                disabled={!isAdmin}
                onChange={() =>
                  setCfgDraft({
                    ...cfgDraft,
                    localProcessingOnly: !cfgDraft.localProcessingOnly,
                  })
                }
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">Local processing</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {cfgDraft.localProcessingOnly
                  ? 'All OCR & blurring runs locally in browser'
                  : 'Standard mode'}
              </p>
            </div>
          </div>

          <div className="bg-[#091120] border border-slate-800/80 rounded-lg p-4 flex flex-col justify-between gap-3">
            <div className="flex items-start justify-between gap-2">
              <Database className="w-4 h-4 text-sky-400" />
              <SwitchToggle
                label="No raw secrets stored"
                checked={cfgDraft.storeRedactedSnippetsOnly}
                disabled={!isAdmin}
                onChange={() =>
                  setCfgDraft({
                    ...cfgDraft,
                    storeRedactedSnippetsOnly: !cfgDraft.storeRedactedSnippetsOnly,
                  })
                }
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">No raw secrets stored</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {cfgDraft.storeRedactedSnippetsOnly
                  ? 'Only masked previews saved to logs'
                  : 'Full snippet capture enabled'}
              </p>
            </div>
          </div>

          <div className="bg-[#091120] border border-slate-800/80 rounded-lg p-4 flex flex-col justify-between gap-3">
            <div className="flex items-start justify-between gap-2">
              <Shield className="w-4 h-4 text-sky-400" />
              <SwitchToggle
                label="Cloud analysis disabled"
                checked={cfgDraft.cloudAnalysisDisabled}
                disabled={!isAdmin}
                onChange={() =>
                  setCfgDraft({
                    ...cfgDraft,
                    cloudAnalysisDisabled: !cfgDraft.cloudAnalysisDisabled,
                  })
                }
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">Cloud analysis disabled</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {cfgDraft.cloudAnalysisDisabled
                  ? 'Zero external frames leave this device'
                  : 'External scanning allowed'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-white">Log settings & audit trail</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Record detection activity and administrator configuration events ({cfgDraft.retentionDays}d retention).
            </p>
          </div>
          <SwitchToggle
            label="Log settings"
            checked={cfgDraft.auditLoggingEnabled}
            disabled={!isAdmin}
            onChange={() =>
              setCfgDraft({
                ...cfgDraft,
                auditLoggingEnabled: !cfgDraft.auditLoggingEnabled,
              })
            }
          />
        </div>
      </div>

      {/* Module 11: Admin, Users & Permissions, Models, Audit Logs */}
      {isAdmin ? (
        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowTeamAdmin((v) => !v)}
            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-[#111D33] transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <UserCog className="w-4 h-4 text-sky-400" />
              <div>
                <p className="text-sm font-semibold text-white">
                  Admin, Users & Model Management
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Manage users, roles, granular permissions, detection models, and audit logs.
                </p>
              </div>
            </div>
            {showTeamAdmin ? (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showTeamAdmin && (
            <div className="p-5 border-t border-slate-800/80 space-y-5">
              {/* Sub-tabs */}
              <div className="inline-flex items-center gap-1 p-1 bg-[#091120] border border-slate-800 rounded-lg">
                {(
                  [
                    { id: 'users', label: `Users & Permissions (${users.length})` },
                    { id: 'models', label: 'Manage Models' },
                    { id: 'audit', label: `Audit Logs (${auditLogs.length})` },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAdminTab(t.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      adminTab === t.id
                        ? 'bg-[#142038] text-sky-300'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {adminTab === 'users' && (
                <div className="space-y-5">
                  <div className="border border-slate-800 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#091120] border-b border-slate-800 text-[11px] font-semibold text-slate-400">
                          <th className="py-2.5 px-4">Member</th>
                          <th className="py-2.5 px-4">Role</th>
                          <th className="py-2.5 px-4">Permissions</th>
                          <th className="py-2.5 px-4">Status</th>
                          <th className="py-2.5 px-4 text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-xs">
                        {users.map((u) => {
                          const perms = u.permissions || {
                            managePolicies: u.role === 'Administrator',
                            manageSources: true,
                            overrideMasks: true,
                            exportLogs: true,
                            triggerPanic: true,
                          };
                          return (
                            <tr key={u.id}>
                              <td className="py-3 px-4">
                                <p className="font-semibold text-white">{u.name}</p>
                                <p className="text-[11px] text-slate-400">{u.email}</p>
                              </td>
                              <td className="py-3 px-4">
                                <select
                                  aria-label={`Role for ${u.name}`}
                                  value={u.role}
                                  onChange={(e) =>
                                    handleUpdateUser(u.id, { role: e.target.value as UserRole })
                                  }
                                  className="h-8 px-2 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-md"
                                >
                                  <option value="Presenter">Presenter</option>
                                  <option value="Administrator">Administrator</option>
                                </select>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {PERMISSION_LABELS.map((perm) => {
                                    const active =
                                      u.role === 'Administrator' ? true : perms[perm.key];
                                    return (
                                      <button
                                        key={perm.key}
                                        type="button"
                                        disabled={u.role === 'Administrator'}
                                        onClick={() => handleToggleUserPermission(u, perm.key)}
                                        className={`px-2 py-1 text-[11px] rounded border transition-colors whitespace-nowrap ${
                                          active
                                            ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                                            : 'bg-[#080F1E] border-slate-800 text-slate-500 hover:text-slate-300'
                                        }`}
                                      >
                                        {perm.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateUser(u.id, { active: !u.active })}
                                  className={u.active ? 'text-emerald-400' : 'text-slate-500'}
                                >
                                  {u.active ? 'Active' : 'Suspended'}
                                </button>
                              </td>
                              <td className="py-3 px-4 text-right">
                                {u.id !== currentUser.id ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteUser(u.id)}
                                    className="p-1 text-slate-400 hover:text-rose-400"
                                    aria-label={`Delete ${u.name}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-slate-500">You</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <form
                    onSubmit={handleCreateUser}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end"
                  >
                    <div className="md:col-span-3">
                      <label className="block text-[11px] text-slate-400 mb-1">Name</label>
                      <input
                        type="text"
                        required
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Alex Rivera"
                        className="w-full h-9 px-2.5 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-[11px] text-slate-400 mb-1">Email</label>
                      <input
                        type="email"
                        required
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="alex@company.com"
                        className="w-full h-9 px-2.5 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[11px] text-slate-400 mb-1">Password</label>
                      <input
                        type="text"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full h-9 px-2.5 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[11px] text-slate-400 mb-1">Role</label>
                      <select
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value as UserRole)}
                        className="w-full h-9 px-2 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
                      >
                        <option value="Presenter">Presenter</option>
                        <option value="Administrator">Administrator</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <button
                        type="submit"
                        className="w-full h-9 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg flex items-center justify-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add User
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {adminTab === 'models' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs text-slate-300 mb-1.5">OCR Engine</label>
                      <select
                        value={cfgDraft.ocrEngine}
                        onChange={(e) =>
                          setCfgDraft({
                            ...cfgDraft,
                            ocrEngine: e.target.value as SystemConfig['ocrEngine'],
                          })
                        }
                        className="w-full h-9 px-2.5 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
                      >
                        <option value="tesseract_wasm">Tesseract WASM (Local)</option>
                        <option value="hybrid_fast">Hybrid Fast Scan</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-300 mb-1.5">
                        Confidence Threshold ({Math.round(cfgDraft.confidenceThreshold * 100)}%)
                      </label>
                      <select
                        value={cfgDraft.confidenceThreshold}
                        onChange={(e) =>
                          setCfgDraft({
                            ...cfgDraft,
                            confidenceThreshold: Number(e.target.value),
                          })
                        }
                        className="w-full h-9 px-2.5 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
                      >
                        <option value={0.65}>65% (Maximum Recall)</option>
                        <option value={0.75}>75% (Balanced)</option>
                        <option value={0.85}>85% (High Precision)</option>
                        <option value={0.92}>92% (Strict Match)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-300 mb-1.5">Scan Interval</label>
                      <select
                        value={cfgDraft.scanIntervalMs}
                        onChange={(e) =>
                          setCfgDraft({ ...cfgDraft, scanIntervalMs: Number(e.target.value) })
                        }
                        className="w-full h-9 px-2.5 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
                      >
                        <option value={500}>500 ms (Fastest)</option>
                        <option value={800}>800 ms (Balanced)</option>
                        <option value={1200}>1200 ms (Low CPU)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-300 mb-1.5">
                        Default Mask Style
                      </label>
                      <select
                        value={cfgDraft.defaultMaskingStyle}
                        onChange={(e) =>
                          setCfgDraft({
                            ...cfgDraft,
                            defaultMaskingStyle: e.target.value as MaskingStyle,
                          })
                        }
                        className="w-full h-9 px-2.5 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
                      >
                        <option value="blur">Blur</option>
                        <option value="redact">Redact</option>
                        <option value="pixelate">Pixelate</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-5 text-xs text-slate-300">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cfgDraft.preprocessGrayscale}
                        onChange={(e) =>
                          setCfgDraft({ ...cfgDraft, preprocessGrayscale: e.target.checked })
                        }
                        className="rounded border-slate-700 bg-[#080F1E] text-sky-500"
                      />
                      OCR grayscale normalization
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cfgDraft.preprocessContrastBoost}
                        onChange={(e) =>
                          setCfgDraft({ ...cfgDraft, preprocessContrastBoost: e.target.checked })
                        }
                        className="rounded border-slate-700 bg-[#080F1E] text-sky-500"
                      />
                      OCR contrast boost
                    </label>
                  </div>

                  {/* Detection Accuracy Feedback Metrics (Module 9 Part B -> Model Tuning) */}
                  <div className="bg-[#091120] border border-slate-800 rounded-lg p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Sliders className="w-4 h-4 text-sky-400" />
                        <p className="text-xs font-semibold text-white">
                          Rule & Model Feedback Accuracy
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-emerald-400 tabular-nums">
                        {feedbackStats.precision}% precision · {feedbackStats.correct} correct ·{' '}
                        {feedbackStats.falsePos} false positives
                      </span>
                    </div>

                    {feedbackList.length > 0 && (
                      <div className="divide-y divide-slate-800/70 max-h-48 overflow-y-auto text-xs">
                        {feedbackList.slice(0, 8).map((fb) => (
                          <div
                            key={fb.id}
                            className="py-2 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <span className="font-medium text-white">{fb.ruleName}</span>
                              <span className="text-slate-500 mx-1.5">·</span>
                              <span className="font-mono text-slate-400">{fb.maskedSnippet}</span>
                            </div>
                            <span
                              className={
                                fb.verdict === 'correct' ? 'text-emerald-400' : 'text-rose-400'
                              }
                            >
                              {fb.verdict === 'correct' ? 'Correct' : 'False Positive'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {adminTab === 'audit' && (
                <div className="border border-slate-800 rounded-lg overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#091120] border-b border-slate-800 text-[11px] font-semibold text-slate-400">
                        <th className="py-2.5 px-4">Actor</th>
                        <th className="py-2.5 px-4">Action</th>
                        <th className="py-2.5 px-4">Target</th>
                        <th className="py-2.5 px-4">Details</th>
                        <th className="py-2.5 px-4 text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-xs">
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400">
                            No administrator audit events recorded yet.
                          </td>
                        </tr>
                      ) : (
                        auditLogs.slice(0, 30).map((entry) => (
                          <tr key={entry.id}>
                            <td className="py-2.5 px-4 font-medium text-white">
                              {entry.actorName}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-[11px] text-sky-300">
                              {entry.action}
                            </td>
                            <td className="py-2.5 px-4 text-slate-200">{entry.target}</td>
                            <td className="py-2.5 px-4 text-slate-400">{entry.details}</td>
                            <td className="py-2.5 px-4 text-right text-slate-400 tabular-nums whitespace-nowrap">
                              {new Date(entry.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl px-5 py-4 flex items-center gap-3 text-xs text-slate-400">
          <Lock className="w-4 h-4 text-slate-500 shrink-0" />
          <span>
            User permissions, model thresholds, and audit logs are managed by workspace Administrators.
          </span>
        </div>
      )}
    </div>
  );
};
