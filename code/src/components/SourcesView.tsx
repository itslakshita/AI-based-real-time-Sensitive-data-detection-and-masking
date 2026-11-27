import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Plus, Search, Trash2, X } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import type { ProtectionPolicy, SourceProfile } from '../types/blurguard.ts';

interface SourcesViewProps {
  sources: SourceProfile[];
  policies: ProtectionPolicy[];
  canManage?: boolean;
  onRefresh: () => Promise<void>;
  onOpenInStudio: (sourceId: string) => void;
}

function getAppBadge(name: string): { code: string; bg: string } {
  const lower = name.toLowerCase();
  if (lower.includes('code') || lower.includes('ide')) {
    return { code: 'VS', bg: 'bg-sky-500/15 text-sky-400 border-sky-500/30' };
  }
  if (lower.includes('chrome') || lower.includes('billing') || lower.includes('stripe')) {
    return { code: 'CH', bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
  }
  if (lower.includes('cloud')) {
    return { code: 'CL', bg: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' };
  }
  if (lower.includes('workday') || lower.includes('payroll') || lower.includes('hr')) {
    return { code: 'HR', bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  }
  const letters = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return {
    code: letters || 'AP',
    bg: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  };
}

export const SourcesView: React.FC<SourcesViewProps> = ({
  sources,
  policies,
  canManage = true,
  onRefresh,
  onOpenInStudio,
}) => {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const [name, setName] = useState('');
  const [applicationName, setApplicationName] = useState('');
  const [policyId, setPolicyId] = useState<string>(policies[0]?.id || 'pol-strict');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.applicationName.toLowerCase().includes(q),
    );
  }, [sources, search]);

  const handleToggleEnabled = async (src: SourceProfile) => {
    await apiRequest(`/api/sources/${src.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...src, enabled: !src.enabled }),
    });
    await onRefresh();
  };

  const handleChangePolicy = async (src: SourceProfile, nextPolicyId: string) => {
    await apiRequest(`/api/sources/${src.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...src, policyId: nextPolicyId }),
    });
    await onRefresh();
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !applicationName.trim()) return;
    setCreating(true);
    try {
      await apiRequest('/api/sources', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          applicationName: applicationName.trim(),
          kind: 'screen',
          description: `Protected window for ${applicationName.trim()}`,
          policyId,
          enabled: true,
          autoStartProtection: true,
          lastUsedAt: new Date().toISOString(),
        }),
      });
      setName('');
      setApplicationName('');
      setShowAddForm(false);
      await onRefresh();
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSource = async (id: string) => {
    await apiRequest(`/api/sources/${id}`, { method: 'DELETE' });
    await onRefresh();
  };

  return (
    <div className="space-y-5">
      {/* Header matching video 00:31 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Applications</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Set protection levels per application.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="h-9 px-4 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showAddForm ? 'Close' : 'Add application'}
          </button>
        )}
      </div>

      {/* Add Application Form (collapsible) */}
      {showAddForm && (
        <form
          onSubmit={handleAddSource}
          className="bg-[#0E1729] border border-slate-800 rounded-xl p-5 grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end"
        >
          <div className="md:col-span-4">
            <label className="block text-xs text-slate-300 mb-1.5">Window / Source Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Slack — Engineering"
              className="w-full h-9 px-3 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs text-slate-300 mb-1.5">Application</label>
            <input
              type="text"
              required
              value={applicationName}
              onChange={(e) => setApplicationName(e.target.value)}
              placeholder="Slack"
              className="w-full h-9 px-3 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs text-slate-300 mb-1.5">Policy</label>
            <select
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              className="w-full h-9 px-2.5 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
            >
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="w-full h-9 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg"
            >
              {creating ? 'Adding...' : 'Save application'}
            </button>
          </div>
        </form>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search applications..."
          className="w-full h-10 pl-10 pr-4 text-xs bg-[#0E1729] border border-slate-800 text-white rounded-xl focus:outline-none focus:border-sky-400"
        />
      </div>

      {/* 2-Column Card Grid matching video 00:31 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((src) => {
          const badge = getAppBadge(src.applicationName);
          return (
            <div
              key={src.id}
              className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-lg border flex items-center justify-center text-xs font-bold shrink-0 ${badge.bg}`}
                  >
                    {badge.code}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {src.applicationName}
                    </p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{src.name}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenInStudio(src.id)}
                    className="h-8 px-2.5 text-xs font-medium bg-[#142038] hover:bg-[#192845] border border-slate-700 text-sky-300 rounded-md flex items-center gap-1 whitespace-nowrap"
                  >
                    Monitor
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                  {canManage && !src.id.startsWith('app-') && (
                    <button
                      type="button"
                      onClick={() => handleDeleteSource(src.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-400"
                      aria-label="Delete application"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
                <button
                  type="button"
                  disabled={!canManage}
                  onClick={() => handleToggleEnabled(src)}
                  className={`text-xs font-medium disabled:opacity-60 ${
                    src.enabled ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {src.enabled ? 'Protected' : 'Disabled'}
                </button>

                <select
                  aria-label="Policy level"
                  disabled={!canManage}
                  value={src.policyId}
                  onChange={(e) => handleChangePolicy(src, e.target.value)}
                  className="h-8 px-2.5 text-xs bg-[#091120] border border-slate-800 text-slate-200 rounded-md disabled:opacity-60"
                >
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
