import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Save, Trash2 } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import type {
  CustomDetectionRule,
  DetectionCategory,
  MaskingStyle,
  ProtectionPolicy,
  RiskLevel,
} from '../types/blurguard.ts';

interface PoliciesViewProps {
  policies: ProtectionPolicy[];
  canEdit?: boolean;
  onRefresh: () => Promise<void>;
}

interface PolicyRowItem {
  key: DetectionCategory;
  title: string;
  subtitle: string;
}

const POLICY_ROWS: PolicyRowItem[] = [
  {
    key: 'password',
    title: 'Passwords & credentials',
    subtitle: 'Always mask authentication secrets',
  },
  {
    key: 'credit_card',
    title: 'Financial information',
    subtitle: 'Cards, bank details and payment data',
  },
  {
    key: 'api_key',
    title: 'Developer secrets',
    subtitle: '.env, tokens and cloud credentials',
  },
  {
    key: 'email',
    title: 'Personal information',
    subtitle: 'Email addresses, phone and contact data',
  },
  {
    key: 'ssn',
    title: 'Sensitive documents',
    subtitle: 'IDs, tax numbers and confidential records',
  },
  {
    key: 'qr_code',
    title: 'QR codes & 2FA tokens',
    subtitle: 'Detect and blur QR codes on shared screens and images',
  },
  {
    key: 'url',
    title: 'Links & browser URLs',
    subtitle: 'Blur address bar URLs, referer parameters, and sensitive links',
  },
  {
    key: 'custom',
    title: 'Custom pattern rules',
    subtitle: 'Mask internal codenames & organization IDs',
  },
];

export const PoliciesView: React.FC<PoliciesViewProps> = ({
  policies,
  canEdit = true,
  onRefresh,
}) => {
  const [selectedId, setSelectedId] = useState<string>(policies[0]?.id || '');
  const [draft, setDraft] = useState<ProtectionPolicy | null>(policies[0] || null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [showCustomRules, setShowCustomRules] = useState(false);

  const [ruleName, setRuleName] = useState('');
  const [rulePattern, setRulePattern] = useState('');
  const [ruleRisk, setRuleRisk] = useState<RiskLevel>('High');
  const [ruleMask, setRuleMask] = useState<MaskingStyle>('redact');

  useEffect(() => {
    const found = policies.find((p) => p.id === selectedId) || policies[0] || null;
    if (found) {
      setSelectedId(found.id);
      setDraft(JSON.parse(JSON.stringify(found)) as ProtectionPolicy);
    }
  }, [policies, selectedId]);

  if (!draft) return null;

  // Determine dominant masking style for the visual 3-card picker
  const activeMaskStyle: MaskingStyle = draft.categories.api_key.maskingStyle || 'blur';

  const setGlobalMaskStyle = (style: MaskingStyle) => {
    const updatedCats = { ...draft.categories };
    (Object.keys(updatedCats) as DetectionCategory[]).forEach((k) => {
      updatedCats[k] = { ...updatedCats[k], maskingStyle: style };
    });
    setDraft({ ...draft, categories: updatedCats });
  };

  const handleToggleCategory = (cat: DetectionCategory) => {
    const nextEnabled = !draft.categories[cat].enabled;
    const updatedCats = {
      ...draft.categories,
      [cat]: { ...draft.categories[cat], enabled: nextEnabled },
    };
    // Keep paired categories synced cleanly for simplicity (email + phone, ssn + confidential)
    if (cat === 'email') {
      updatedCats.phone = { ...updatedCats.phone, enabled: nextEnabled };
    }
    if (cat === 'ssn') {
      updatedCats.confidential = { ...updatedCats.confidential, enabled: nextEnabled };
    }
    setDraft({ ...draft, categories: updatedCats });
  };

  const handleSavePolicy = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      await apiRequest(`/api/policies/${draft.id}`, {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      await onRefresh();
      setStatusMsg('Privacy policy saved.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to save policy.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomRule = () => {
    if (!ruleName.trim() || !rulePattern.trim()) return;
    const newRule: CustomDetectionRule = {
      id: `rule-${Date.now().toString(36)}`,
      name: ruleName.trim(),
      pattern: rulePattern.trim(),
      flags: 'gi',
      riskLevel: ruleRisk,
      maskingStyle: ruleMask,
      enabled: true,
      description: 'Custom rule',
    };
    setDraft({
      ...draft,
      customRules: [...draft.customRules, newRule],
    });
    setRuleName('');
    setRulePattern('');
  };

  const handleCreatePolicy = async () => {
    const base = JSON.parse(JSON.stringify(draft)) as ProtectionPolicy;
    const created: ProtectionPolicy = {
      ...base,
      id: `pol-${Date.now().toString(36)}`,
      name: `${draft.name} (Copy)`,
      isDefault: false,
    };
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ policy: ProtectionPolicy }>('/api/policies', {
        method: 'POST',
        body: JSON.stringify(created),
      });
      await onRefresh();
      setSelectedId(res.policy.id);
      setStatusMsg('New policy created.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to create policy.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePolicy = async () => {
    if (draft.isDefault || policies.length <= 1) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      await apiRequest(`/api/policies/${draft.id}`, { method: 'DELETE' });
      await onRefresh();
      setStatusMsg('Policy deleted.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to delete policy.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Header matching video 00:25 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Privacy Policies</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Control what BlurGuard should detect and how aggressively it should protect it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Select policy preset"
            value={draft.id}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setStatusMsg(null);
            }}
            className="h-9 px-3 text-xs bg-[#0E1729] border border-slate-700 text-white rounded-lg"
          >
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {canEdit && (
            <>
              <button
                type="button"
                onClick={handleCreatePolicy}
                disabled={saving}
                title="Duplicate as new policy"
                className="h-9 px-3 bg-[#0E1729] hover:bg-[#142038] border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>

              {!draft.isDefault && policies.length > 1 && (
                <button
                  type="button"
                  onClick={handleDeletePolicy}
                  disabled={saving}
                  title="Delete policy"
                  className="h-9 px-2.5 bg-[#0E1729] hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-300 hover:text-rose-300 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={handleSavePolicy}
                disabled={saving}
                className="h-9 px-4 bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-slate-950 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save policy'}
              </button>
            </>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="text-xs text-emerald-300 bg-emerald-950/50 border border-emerald-800/70 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Detection Policies Card */}
      <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-white">Detection policies</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Choose which sensitive information categories BlurGuard automatically masks.
          </p>
        </div>

        <div className="space-y-2.5">
          {POLICY_ROWS.map((row) => {
            const enabled = draft.categories[row.key]?.enabled ?? true;
            return (
              <div
                key={row.key}
                className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3.5 flex items-center justify-between gap-4"
              >
                <div>
                  <p className="text-xs font-semibold text-white">{row.title}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{row.subtitle}</p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => handleToggleCategory(row.key)}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                    enabled ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                      enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Masking Style + Safety Behavior matching video 00:28 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Masking Style */}
        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white">Masking style</h3>
          <p className="text-xs text-slate-400 mt-0.5 mb-4">Choose the visual treatment.</p>

          <div className="grid grid-cols-3 gap-3">
            {(
              [
                { id: 'blur', label: 'Blur', preview: 'blur-xs bg-slate-500/40' },
                { id: 'redact', label: 'Redact', preview: 'bg-slate-950 border border-slate-700' },
                { id: 'pixelate', label: 'Pixelate', preview: 'bg-sky-500/20' },
              ] as const
            ).map((opt) => {
              const selected = activeMaskStyle === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setGlobalMaskStyle(opt.id)}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    selected
                      ? 'bg-[#12203A] border-sky-400'
                      : 'bg-[#091120] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="h-14 rounded-lg bg-[#070E1A] border border-slate-800 flex items-center justify-center px-3 mb-2.5 overflow-hidden">
                    {opt.id === 'blur' && (
                      <div className="w-full h-3 rounded bg-slate-400/50 blur-[3px]" />
                    )}
                    {opt.id === 'redact' && (
                      <div className="w-full h-3 rounded bg-slate-950 border border-slate-700" />
                    )}
                    {opt.id === 'pixelate' && (
                      <div className="grid grid-cols-6 gap-0.5 w-full">
                        {Array.from({ length: 6 }).map((_, idx) => (
                          <div
                            key={idx}
                            className={`h-3 ${idx % 2 === 0 ? 'bg-slate-600' : 'bg-slate-700'}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-medium text-white">{opt.label}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Safety Behavior */}
        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Safety behavior</h3>
            <p className="text-xs text-slate-400 mt-0.5 mb-4">How BlurGuard should react.</p>

            <div className="space-y-3">
              <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-200">
                  Show warning for uncertain detections
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.requireManualReviewForUncertain}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      requireManualReviewForUncertain: !draft.requireManualReviewForUncertain,
                    })
                  }
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                    draft.requireManualReviewForUncertain ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                      draft.requireManualReviewForUncertain ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-200">Minimum risk threshold</span>
                <select
                  aria-label="Minimum risk threshold"
                  value={draft.minRiskThreshold}
                  onChange={(e) =>
                    setDraft({ ...draft, minRiskThreshold: e.target.value as RiskLevel })
                  }
                  className="h-8 px-2.5 text-xs bg-[#0E1729] border border-slate-700 text-slate-200 rounded-md"
                >
                  <option value="Low">Low (All items)</option>
                  <option value="Medium">Medium+</option>
                  <option value="High">High+</option>
                  <option value="Critical">Critical only</option>
                </select>
              </div>

              <div className="bg-[#091120] border border-slate-800/80 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-200">Use as default workspace policy</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.isDefault}
                  onClick={() => setDraft({ ...draft, isDefault: !draft.isDefault })}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                    draft.isDefault ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                      draft.isDefault ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowCustomRules((v) => !v)}
            className="mt-4 flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300"
          >
            {showCustomRules ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Custom pattern rules ({draft.customRules.length})
          </button>
        </div>
      </div>

      {/* Collapsible Custom Rules */}
      {showCustomRules && (
        <div className="bg-[#0E1729] border border-slate-800/90 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Custom Pattern Rules</h3>

          {draft.customRules.length > 0 && (
            <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg">
              {draft.customRules.map((rule) => (
                <div
                  key={rule.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-white">{rule.name}</span>
                    <span className="text-slate-500 mx-2" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-slate-400">{rule.pattern}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        customRules: draft.customRules.filter((r) => r.id !== rule.id),
                      })
                    }
                    className="p-1 text-slate-400 hover:text-rose-400"
                    aria-label="Delete rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
            <div className="sm:col-span-4">
              <label className="block text-[11px] text-slate-400 mb-1">Rule Name</label>
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="Internal Project ID"
                className="w-full h-9 px-3 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-[11px] text-slate-400 mb-1">Pattern (Regex)</label>
              <input
                type="text"
                value={rulePattern}
                onChange={(e) => setRulePattern(e.target.value)}
                placeholder="ACME-\d{4}"
                className="w-full h-9 px-3 text-xs font-mono bg-[#080F1E] border border-slate-700 text-white rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">Risk</label>
              <select
                value={ruleRisk}
                onChange={(e) => setRuleRisk(e.target.value as RiskLevel)}
                className="w-full h-9 px-2 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
              >
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
              </select>
            </div>
            <div className="sm:col-span-1">
              <label className="block text-[11px] text-slate-400 mb-1">Mask</label>
              <select
                value={ruleMask}
                onChange={(e) => setRuleMask(e.target.value as MaskingStyle)}
                className="w-full h-9 px-2 text-xs bg-[#080F1E] border border-slate-700 text-white rounded-lg"
              >
                <option value="redact">Redact</option>
                <option value="blur">Blur</option>
                <option value="pixelate">Pixelate</option>
              </select>
            </div>
            <div className="sm:col-span-1">
              <button
                type="button"
                onClick={handleAddCustomRule}
                disabled={!ruleName.trim() || !rulePattern.trim()}
                className="w-full h-9 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 rounded-lg flex items-center justify-center"
                title="Add rule"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
