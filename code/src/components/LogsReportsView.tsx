import React, { useMemo, useState } from 'react';
import {
  Code2,
  CreditCard,
  Download,
  FileText,
  Filter,
  KeyRound,
  Link2,
  QrCode,
  Search,
  User,
} from 'lucide-react';
import type {
  DetectionCategory,
  DetectionLogEntry,
  MonitoringSession,
  RiskLevel,
} from '../types/blurguard.ts';

interface LogsReportsViewProps {
  logs: DetectionLogEntry[];
  sessions: MonitoringSession[];
  canExport?: boolean;
}

const CATEGORY_META: Record<DetectionCategory, { label: string; icon: React.ReactNode }> = {
  api_key: { label: 'API Key', icon: <KeyRound className="w-4 h-4 text-sky-400" /> },
  password: { label: 'Password', icon: <KeyRound className="w-4 h-4 text-rose-400" /> },
  credit_card: { label: 'Credit Card', icon: <CreditCard className="w-4 h-4 text-amber-400" /> },
  ssn: { label: 'Sensitive ID', icon: <FileText className="w-4 h-4 text-orange-400" /> },
  email: { label: 'Email', icon: <User className="w-4 h-4 text-sky-400" /> },
  phone: { label: 'Phone Number', icon: <User className="w-4 h-4 text-emerald-400" /> },
  confidential: { label: 'Confidential', icon: <FileText className="w-4 h-4 text-amber-400" /> },
  qr_code: { label: 'QR Code', icon: <QrCode className="w-4 h-4 text-sky-400" /> },
  url: { label: 'Link / URL', icon: <Link2 className="w-4 h-4 text-sky-400" /> },
  custom: { label: 'Custom Pattern', icon: <Code2 className="w-4 h-4 text-sky-400" /> },
};

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const hrs = Math.round(diffMin / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export const LogsReportsView: React.FC<LogsReportsViewProps> = ({
  logs,
  sessions,
  canExport = true,
}) => {
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'all'>('all');

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (riskFilter !== 'all' && entry.riskLevel !== riskFilter) return false;
      if (!q) return true;
      return (
        entry.ruleName.toLowerCase().includes(q) ||
        entry.sourceName.toLowerCase().includes(q) ||
        entry.userName.toLowerCase().includes(q) ||
        entry.maskedSnippet.toLowerCase().includes(q)
      );
    });
  }, [logs, search, riskFilter]);

  const handleExportCsv = () => {
    const header = ['Detection', 'Application', 'Confidence', 'Risk', 'Time', 'Action'];
    const rows = filteredLogs.map((l) => [
      CATEGORY_META[l.category]?.label || l.category,
      l.sourceName,
      `${Math.round(l.confidence * 100)}%`,
      l.riskLevel,
      l.timestamp,
      l.actionTaken === 'approved_visible' ? 'Allowed' : `Masked (${l.maskingStyle})`,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blurguard-detections-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Header matching video 00:21 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Detections</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Review what BlurGuard has protected without storing the sensitive value.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`h-9 px-3.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-2 whitespace-nowrap ${
              showFilters
                ? 'bg-[#142038] border-slate-600 text-white'
                : 'bg-[#0E1729] border-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
          </button>

          {canExport && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="h-9 px-3.5 bg-[#0E1729] hover:bg-[#142038] border border-slate-800 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="bg-[#0E1729] border border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by application, presenter, or type..."
              className="w-full h-9 pl-8 pr-3 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg focus:outline-none focus:border-sky-400"
            />
          </div>

          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value as RiskLevel | 'all')}
            className="h-9 px-3 text-xs bg-[#080F1E] border border-slate-700 text-slate-200 rounded-lg"
          >
            <option value="all">All Risk Levels</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      )}

      {/* Detections Table */}
      <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                <th className="py-3.5 px-5">Detection</th>
                <th className="py-3.5 px-4">Application</th>
                <th className="py-3.5 px-4">Confidence</th>
                <th className="py-3.5 px-4">Risk</th>
                <th className="py-3.5 px-4">Time</th>
                <th className="py-3.5 px-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No detections match the current filter.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((entry) => {
                  const meta = CATEGORY_META[entry.category] || CATEGORY_META.confidential;
                  const riskBadge =
                    entry.riskLevel === 'Critical'
                      ? 'text-rose-400 bg-rose-500/15 border-rose-500/30'
                      : entry.riskLevel === 'High'
                        ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                        : 'text-sky-300 bg-sky-500/15 border-sky-500/30';

                  return (
                    <tr key={entry.id} className="hover:bg-[#111D33] transition-colors">
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-[#091120] border border-slate-800 flex items-center justify-center shrink-0">
                            {meta.icon}
                          </div>
                          <div>
                            <p className="font-semibold text-white">{meta.label}</p>
                            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                              {entry.maskedSnippet}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">{entry.sourceName}</td>
                      <td className="py-3.5 px-4 font-medium text-white tabular-nums">
                        {Math.round(entry.confidence * 100)}%
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-1 text-[11px] font-medium rounded-md border ${riskBadge}`}
                        >
                          {entry.riskLevel}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 tabular-nums whitespace-nowrap">
                        {formatRelativeTime(entry.timestamp)}
                      </td>
                      <td className="py-3.5 px-5 text-right text-slate-300 whitespace-nowrap">
                        {entry.actionTaken === 'approved_visible'
                          ? 'Allowed'
                          : `Masked (${entry.maskingStyle})`}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compact Session Summary Footer */}
      {sessions.length > 0 && (
        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <span>
            Recent sessions: <strong className="text-white tabular-nums">{sessions.length}</strong>
          </span>
          <span>
            Latest session:{' '}
            <strong className="text-slate-200">{sessions[0].sourceName}</strong> ·{' '}
            {formatRelativeTime(sessions[0].startedAt)}
          </span>
        </div>
      )}
    </div>
  );
};
