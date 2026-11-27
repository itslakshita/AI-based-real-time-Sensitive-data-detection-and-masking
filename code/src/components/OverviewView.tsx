import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Code2,
  CreditCard,
  Eye,
  FileText,
  KeyRound,
  Link2,
  Monitor,
  QrCode,
  Shield,
  ShieldCheck,
  User,
} from 'lucide-react';
import type {
  DetectionCategory,
  DetectionLogEntry,
  ProtectionPolicy,
  SourceProfile,
} from '../types/blurguard.ts';

interface OverviewViewProps {
  logs: DetectionLogEntry[];
  sources: SourceProfile[];
  activePolicy: ProtectionPolicy | undefined;
  panicProtect: boolean;
  onOpenMonitor: () => void;
  onOpenDetections: () => void;
  onOpenApplications: () => void;
  onLaunchSource: (sourceId: string) => void;
}

const CATEGORY_META: Record<DetectionCategory, { label: string; icon: React.ReactNode }> = {
  api_key: { label: 'API Key', icon: <KeyRound className="w-4 h-4 text-sky-400" /> },
  password: { label: 'Password', icon: <KeyRound className="w-4 h-4 text-rose-400" /> },
  credit_card: { label: 'Credit Card', icon: <CreditCard className="w-4 h-4 text-amber-400" /> },
  ssn: { label: 'Sensitive ID', icon: <FileText className="w-4 h-4 text-orange-400" /> },
  email: { label: 'Email', icon: <User className="w-4 h-4 text-sky-400" /> },
  phone: { label: 'Phone Number', icon: <User className="w-4 h-4 text-emerald-400" /> },
  confidential: { label: 'Confidential Note', icon: <FileText className="w-4 h-4 text-amber-400" /> },
  qr_code: { label: 'QR Code', icon: <QrCode className="w-4 h-4 text-sky-400" /> },
  url: { label: 'Link / URL', icon: <Link2 className="w-4 h-4 text-sky-400" /> },
  custom: { label: 'Developer Secret', icon: <Code2 className="w-4 h-4 text-sky-400" /> },
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
  return { code: 'OS', bg: 'bg-slate-700/40 text-slate-300 border-slate-600/40' };
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  logs,
  sources,
  activePolicy,
  panicProtect,
  onOpenMonitor,
  onOpenDetections,
  onOpenApplications,
  onLaunchSource,
}) => {
  const maskedCount = logs.filter((l) => l.actionTaken !== 'approved_visible').length;
  const highRiskCount = logs.filter(
    (l) => l.riskLevel === 'Critical' || l.riskLevel === 'High',
  ).length;
  const criticalCount = logs.filter((l) => l.riskLevel === 'Critical').length;
  const protectionRate = logs.length > 0 ? Math.round((maskedCount / logs.length) * 100) : 100;

  const coverageCards = [
    {
      title: 'Authentication',
      subtitle: 'Passwords, API keys, JWTs',
      enabled: Boolean(activePolicy?.categories.password.enabled || activePolicy?.categories.api_key.enabled),
      icon: <KeyRound className="w-4 h-4 text-sky-400" />,
    },
    {
      title: 'Financial',
      subtitle: 'Cards, bank details, payment data',
      enabled: Boolean(activePolicy?.categories.credit_card.enabled),
      icon: <CreditCard className="w-4 h-4 text-sky-400" />,
    },
    {
      title: 'Personal',
      subtitle: 'Email, phone, addresses',
      enabled: Boolean(activePolicy?.categories.email.enabled || activePolicy?.categories.phone.enabled),
      icon: <User className="w-4 h-4 text-sky-400" />,
    },
    {
      title: 'Documents',
      subtitle: 'IDs, tax numbers, sensitive files',
      enabled: Boolean(activePolicy?.categories.ssn.enabled || activePolicy?.categories.confidential.enabled),
      icon: <FileText className="w-4 h-4 text-sky-400" />,
    },
    {
      title: 'Developer & custom',
      subtitle: '.env, cloud tokens, custom rules',
      enabled: Boolean(activePolicy?.categories.api_key.enabled || activePolicy?.categories.custom.enabled),
      icon: <Code2 className="w-4 h-4 text-sky-400" />,
    },
    {
      title: 'QR codes & links',
      subtitle: 'Auth QR codes, URLs & referer links',
      enabled: Boolean(
        (activePolicy?.categories.qr_code?.enabled ?? true) ||
          (activePolicy?.categories.url?.enabled ?? true),
      ),
      icon: <QrCode className="w-4 h-4 text-sky-400" />,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Hero Protection Card */}
      <section className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-6 sm:p-7">
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
          <ShieldCheck className="w-4 h-4" />
          <span>{panicProtect ? 'Panic shield active' : 'Protection active'}</span>
        </div>

        <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight text-white">
          {panicProtect ? 'Your shared screen is hidden.' : 'Your screen is guarded in real time.'}
        </h2>
        <p className="mt-2 text-sm text-slate-400 max-w-2xl">
          BlurGuard detects and blurs API keys, passwords, payment cards, and personal information
          locally in real time before they can be exposed on your screen.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenMonitor}
            className="h-10 px-4 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Monitor className="w-4 h-4" />
            Open live monitor
          </button>
          <button
            type="button"
            onClick={onOpenDetections}
            className="h-10 px-4 bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Shield className="w-4 h-4 text-slate-400" />
            Review detections
          </button>
        </div>
      </section>

      {/* 4-Column Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Protection rate</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="mt-3 text-2xl font-semibold text-white tabular-nums">{protectionRate}%</p>
          <p className="mt-1 text-[11px] text-slate-400">Active policy masking</p>
        </div>

        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Items protected</span>
            <Eye className="w-4 h-4 text-sky-400" />
          </div>
          <p className="mt-3 text-2xl font-semibold text-white tabular-nums">{maskedCount}</p>
          <p className="mt-1 text-[11px] text-slate-400">Logged locally</p>
        </div>

        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>High-risk events</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <p className="mt-3 text-2xl font-semibold text-white tabular-nums">{highRiskCount}</p>
          <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
            {criticalCount} critical · {Math.max(0, highRiskCount - criticalCount)} high
          </p>
        </div>

        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Monitored apps</span>
            <Monitor className="w-4 h-4 text-sky-400" />
          </div>
          <p className="mt-3 text-2xl font-semibold text-white tabular-nums">
            {sources.filter((s) => s.enabled).length}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Ready for live sharing</p>
        </div>
      </section>

      {/* Activity + Protected Applications */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Recent Events (8 cols) */}
        <div className="lg:col-span-8 bg-[#0E1729] border border-slate-800/90 rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Protection activity</h3>
              <p className="text-xs text-slate-400 mt-0.5">Recent sensitive-data events</p>
            </div>
            <button
              type="button"
              onClick={onOpenDetections}
              className="text-xs font-medium text-sky-400 hover:text-sky-300 flex items-center gap-1 whitespace-nowrap"
            >
              View all
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2.5 flex-1">
            {logs.slice(0, 4).map((entry) => {
              const meta = CATEGORY_META[entry.category] || CATEGORY_META.confidential;
              const riskClass =
                entry.riskLevel === 'Critical'
                  ? 'text-rose-400 bg-rose-500/15 border-rose-500/30'
                  : entry.riskLevel === 'High'
                    ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                    : 'text-sky-300 bg-sky-500/15 border-sky-500/30';

              return (
                <div
                  key={entry.id}
                  className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#101C33] border border-slate-800 flex items-center justify-center shrink-0">
                      {meta.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{meta.label}</p>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {entry.sourceName} · {formatRelativeTime(entry.timestamp)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs font-semibold text-white tabular-nums">
                        {Math.round(entry.confidence * 100)}%
                      </p>
                      <p className="text-[10px] text-slate-400">confidence</p>
                    </div>
                    <span
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md border ${riskClass}`}
                    >
                      {entry.riskLevel}
                    </span>
                  </div>
                </div>
              );
            })}

            {logs.length === 0 && (
              <div className="py-10 text-center text-xs text-slate-400">
                No sensitive events recorded yet. Open Live Monitor to begin.
              </div>
            )}
          </div>
        </div>

        {/* Protected Applications (4 cols) */}
        <div className="lg:col-span-4 bg-[#0E1729] border border-slate-800/90 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Protected applications</h3>
            <p className="text-xs text-slate-400 mt-0.5 mb-4">Active privacy policies</p>

            <div className="space-y-2.5">
              {sources.slice(0, 3).map((src) => {
                const badge = getAppBadge(src.applicationName);
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => onLaunchSource(src.id)}
                    className="w-full text-left bg-[#091120] hover:bg-[#0D182C] border border-slate-800/80 rounded-lg px-3.5 py-3 flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[11px] font-bold shrink-0 ${badge.bg}`}
                      >
                        {badge.code}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">
                          {src.applicationName}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">{src.name}</p>
                      </div>
                    </div>
                    <span
                      className={`text-[11px] font-medium shrink-0 ${
                        src.enabled ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {src.enabled ? 'Protected' : 'Paused'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenApplications}
            className="mt-4 w-full h-9 bg-[#142038] hover:bg-[#192845] border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            Manage applications
          </button>
        </div>
      </section>

      {/* Bottom Protection Coverage Grid */}
      <section className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-white">Protection coverage</h3>
          <p className="text-xs text-slate-400 mt-0.5">What BlurGuard is watching for</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {coverageCards.map((card) => (
            <div
              key={card.title}
              className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#101C33] border border-slate-800 flex items-center justify-center shrink-0">
                  {card.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{card.title}</p>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">{card.subtitle}</p>
                </div>
              </div>
              <span
                className={`text-[11px] font-medium shrink-0 ${
                  card.enabled ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {card.enabled ? 'Active' : 'Off'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
