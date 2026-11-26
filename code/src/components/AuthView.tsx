import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Shield, UserCheck } from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api.ts';
import type { UserProfile } from '../types/blurguard.ts';

interface AuthViewProps {
  onAuthenticated: (user: UserProfile) => void;
}

const demoAdminEmail = import.meta.env.VITE_DEMO_ADMIN_EMAIL || 'admin@blurguard.io';
const demoAdminPassword = import.meta.env.VITE_DEMO_ADMIN_PASSWORD || '';
const demoPresenterEmail = import.meta.env.VITE_DEMO_PRESENTER_EMAIL || 'presenter@blurguard.io';
const demoPresenterPassword = import.meta.env.VITE_DEMO_PRESENTER_PASSWORD || '';

export const AuthView: React.FC<AuthViewProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(demoAdminEmail);
  const [password, setPassword] = useState(demoAdminPassword);
  const [department, setDepartment] = useState('Security Operations');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload =
        mode === 'login'
          ? { email, password }
          : { name, email, password, department };
      const res = await apiRequest<{ user: UserProfile; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (role: 'admin' | 'presenter') => {
    setMode('login');
    setError(null);
    if (role === 'admin') {
      setEmail(demoAdminEmail);
      setPassword(demoAdminPassword);
    } else {
      setEmail(demoPresenterEmail);
      setPassword(demoPresenterPassword);
    }
  };

  return (
    <div className="min-h-screen bg-[#070E1A] text-slate-100 flex flex-col lg:flex-row">
      {/* Left Intro */}
      <div className="lg:w-[45%] bg-[#091221] p-8 lg:p-14 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800/70">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400">
              <Shield className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">BlurGuard</span>
          </div>

          <h1
            className="mt-12 text-3xl lg:text-4xl font-semibold tracking-tight text-white leading-tight max-w-md"
            style={{ textWrap: 'balance' }}
          >
            Your screen, automatically protected.
          </h1>
          <p className="mt-4 text-sm lg:text-base text-slate-400 leading-relaxed max-w-md">
            BlurGuard monitors your screen locally and masks passwords, payment cards, API keys, and
            private messages before they become visible to others.
          </p>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
          <div>
            <p className="font-semibold text-white">Local Privacy Processing</p>
            <p className="text-slate-400 mt-1">
              Screen analysis stays on your device without exposing raw secrets.
            </p>
          </div>
          <div>
            <p className="font-semibold text-white">Instant Panic Shield</p>
            <p className="text-slate-400 mt-1">
              Hide your entire shared screen in one click or with Alt + P.
            </p>
          </div>
        </div>
      </div>

      {/* Right Sign In Card */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <div className="w-full max-w-md bg-[#0E1729] border border-slate-800 rounded-xl p-8">
          <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <h2 className="text-xl font-semibold text-white">
                {mode === 'login' ? 'Sign in' : 'Create account'}
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                {mode === 'login'
                  ? 'Access your BlurGuard privacy workspace.'
                  : 'Register a presenter account.'}
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-[#080F1E] border border-slate-800 rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'login'
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'register'
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Register
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jordan Hayes"
                    className="w-full h-10 px-3 text-sm bg-[#080F1E] border border-slate-700 text-white rounded-lg focus:outline-none focus:border-sky-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Team</label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="Engineering"
                    className="w-full h-10 px-3 text-sm bg-[#080F1E] border border-slate-700 text-white rounded-lg focus:outline-none focus:border-sky-400"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full h-10 px-3 text-sm bg-[#080F1E] border border-slate-700 text-white rounded-lg focus:outline-none focus:border-sky-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-10 pl-3 pr-10 text-sm bg-[#080F1E] border border-slate-700 text-white rounded-lg focus:outline-none focus:border-sky-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-300 bg-red-950/60 border border-red-800/70 rounded-lg px-3 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-slate-950 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Lock className="w-4 h-4" />
              {submitting ? 'Signing in...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-7 pt-5 border-t border-slate-800">
            <p className="text-xs font-medium text-slate-400 mb-3">Quick Demo Accounts</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => fillDemo('admin')}
                className="flex items-center gap-2.5 px-3 py-2.5 text-left bg-[#080F1E] border border-slate-800 hover:border-slate-700 rounded-lg transition-colors"
              >
                <UserCheck className="w-4 h-4 text-sky-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">Elena Vance</p>
                  <p className="text-[11px] text-slate-400 truncate">Administrator</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => fillDemo('presenter')}
                className="flex items-center gap-2.5 px-3 py-2.5 text-left bg-[#080F1E] border border-slate-800 hover:border-slate-700 rounded-lg transition-colors"
              >
                <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">Marcus Sterling</p>
                  <p className="text-[11px] text-slate-400 truncate">Presenter</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
