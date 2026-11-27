import React, { useState } from 'react';
import { LogOut, Save, ShieldCheck, X } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import type { UserProfile } from '../types/blurguard.ts';

interface ProfileModalProps {
  user: UserProfile;
  onClose: () => void;
  onUpdated: (user: UserProfile) => void;
  onLogout: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  user,
  onClose,
  onUpdated,
  onLogout,
}) => {
  const [name, setName] = useState(user.name);
  const [department, setDepartment] = useState(user.department);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{ user: UserProfile }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          department,
          password: password.trim() ? password : undefined,
        }),
      });
      onUpdated(res.user);
      setPassword('');
      setMessage('Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#0E1729] border border-slate-800 rounded-xl w-full max-w-lg overflow-hidden text-slate-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-white">Account Profile</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {user.role} · {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            aria-label="Close profile dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div className="flex items-center gap-4 pb-4 border-b border-slate-800">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full object-cover border border-slate-700"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-sky-500/20 border border-sky-400/30 text-sky-300 flex items-center justify-center text-base font-semibold">
                {user.name
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user.name}</p>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>{user.role}</span>
                <span aria-hidden="true">·</span>
                <span>{user.department}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-[#080F1E] border border-slate-700 text-white rounded-lg focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Team</label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-[#080F1E] border border-slate-700 text-white rounded-lg focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              New Password (Optional)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current password"
              className="w-full h-10 px-3 text-sm bg-[#080F1E] border border-slate-700 text-white rounded-lg focus:outline-none focus:border-sky-400"
            />
          </div>

          {error && (
            <div className="text-xs text-rose-300 bg-rose-950/60 border border-rose-800/70 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {message && (
            <div className="text-xs text-emerald-300 bg-emerald-950/60 border border-emerald-800/70 rounded-lg px-3 py-2">
              {message}
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onLogout}
              className="px-3.5 py-2 text-xs font-medium text-rose-400 hover:bg-rose-950/50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-500 hover:bg-sky-400 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
