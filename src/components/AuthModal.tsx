import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Lock, UserPlus, X } from 'lucide-react';
import {
  apiForgotPassword,
  apiLogin,
  apiRegister,
  apiResetPassword,
  type AuthResponse,
} from '../utils/api.ts';
import { RhinoLogo } from './RhinoLogo.tsx';

interface AuthModalProps {
  open: boolean;
  initialMode?: 'LOGIN' | 'REGISTER';
  onClose: () => void;
  onSuccess: (auth: AuthResponse) => void;
}

type ModalMode = 'LOGIN' | 'REGISTER' | 'RESET';

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  initialMode = 'LOGIN',
  onClose,
  onSuccess,
}) => {
  const [mode, setMode] = useState<ModalMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [startingBalance, setStartingBalance] = useState<number>(100_000);

  // Password reset state
  const [resetToken, setResetToken] = useState('');
  const [resetPreviewToken, setResetPreviewToken] = useState<string | null>(null);
  const [resetStep, setResetStep] = useState<'REQUEST' | 'CONFIRM'>('REQUEST');
  const [newPassword, setNewPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
    setSuccessMsg(null);
    setResetStep('REQUEST');
    setResetPreviewToken(null);
  }, [initialMode, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (mode === 'RESET') {
      if (resetStep === 'REQUEST') {
        const trimmedEmail = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          setError('Please enter a valid account email address.');
          return;
        }
        setLoading(true);
        try {
          const res = await apiForgotPassword(trimmedEmail);
          setResetStep('CONFIRM');
          if (res.previewToken) {
            setResetPreviewToken(res.previewToken);
            setResetToken(res.previewToken);
            setSuccessMsg(
              'Reset token issued (Local Dev Preview — SMTP is not configured). Enter a new password below.'
            );
          } else {
            setSuccessMsg('If an active account matches that email, a reset token has been sent.');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unable to request password reset.');
        } finally {
          setLoading(false);
        }
        return;
      }

      if (!resetToken.trim() || newPassword.length < 8) {
        setError('Valid reset token and a new password (min 8 characters) are required.');
        return;
      }
      setLoading(true);
      try {
        await apiResetPassword({ token: resetToken.trim(), newPassword });
        setNewPassword('');
        setResetToken('');
        setResetPreviewToken(null);
        setMode('LOGIN');
        setSuccessMsg('Password updated and all prior sessions revoked. Sign in with your new password.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Password reset failed.');
      } finally {
        setLoading(false);
      }
      return;
    }

    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (mode === 'REGISTER' && displayName.trim().length < 2) {
      setError('Display name must be at least 2 characters.');
      return;
    }

    setLoading(true);
    try {
      const result =
        mode === 'LOGIN'
          ? await apiLogin({ email: trimmedEmail, password })
          : await apiRegister({
              email: trimmedEmail,
              password,
              displayName: displayName.trim(),
              handle: handle.trim() || undefined,
              startingBalance,
            });
      setPassword('');
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md terminal-card p-5 sm:p-6 border-[#594b22] space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#1b2940] pb-3.5">
          <div className="flex items-center gap-3">
            <RhinoLogo size={34} />
            <div>
              <h2 id="auth-modal-title" className="text-base font-bold text-[#f3dc8d]">
                {mode === 'LOGIN'
                  ? 'Trader Sign In'
                  : mode === 'REGISTER'
                    ? 'Create Trader Account'
                    : 'Reset Account Password'}
              </h2>
              <p className="text-[11px] text-[#8190a8]">
                SQLite persistent paper portfolio · Strictly simulated trading
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close authentication modal"
            onClick={onClose}
            className="p-2 rounded-lg text-[#8190a8] hover:text-[#eef2f8] hover:bg-[#0e172a]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switch */}
        <div className="grid grid-cols-3 gap-1.5 bg-[#070c17] p-1 rounded-lg border border-[#1b2940]">
          <button
            type="button"
            onClick={() => {
              setMode('LOGIN');
              setError(null);
            }}
            className={`min-h-[36px] rounded-md text-xs font-bold transition-colors ${
              mode === 'LOGIN'
                ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                : 'text-[#8190a8] hover:text-[#eef2f8]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('REGISTER');
              setError(null);
            }}
            className={`min-h-[36px] rounded-md text-xs font-bold transition-colors ${
              mode === 'REGISTER'
                ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                : 'text-[#8190a8] hover:text-[#eef2f8]'
            }`}
          >
            Register
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('RESET');
              setError(null);
              setSuccessMsg(null);
            }}
            className={`min-h-[36px] rounded-md text-xs font-bold transition-colors ${
              mode === 'RESET'
                ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                : 'text-[#8190a8] hover:text-[#eef2f8]'
            }`}
          >
            Reset Pass
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {mode === 'REGISTER' && (
            <>
              <div>
                <label className="block text-[#8190a8] mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Alex Mercer"
                  className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-sm text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8190a8] mb-1">Handle (Optional)</label>
                  <input
                    type="text"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="trader_77"
                    className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-sm font-mono text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
                  />
                </div>
                <div>
                  <label className="block text-[#8190a8] mb-1">Virtual Capital</label>
                  <select
                    value={startingBalance}
                    onChange={(e) => setStartingBalance(Number(e.target.value))}
                    className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-sm font-mono text-[#f3dc8d] focus:outline-none focus:border-[#d4af37]"
                  >
                    <option value={10_000}>$10,000 Paper</option>
                    <option value={50_000}>$50,000 Paper</option>
                    <option value={100_000}>$100,000 Paper</option>
                    <option value={250_000}>$250,000 Paper</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {(mode !== 'RESET' || resetStep === 'REQUEST') && (
            <div>
              <label className="block text-[#8190a8] mb-1">Email Address</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="desk@77tradeit.local"
                className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-sm text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
              />
            </div>
          )}

          {mode !== 'RESET' && (
            <div>
              <label className="block text-[#8190a8] mb-1">Password (min 8 characters)</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'LOGIN' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-sm text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
              />
            </div>
          )}

          {mode === 'RESET' && resetStep === 'CONFIRM' && (
            <>
              {resetPreviewToken && (
                <div className="bg-[#211c0e] border border-[#594b22] rounded-lg p-2.5 text-[11px] text-[#f3dc8d] font-mono break-all">
                  Dev Preview Token: {resetPreviewToken}
                </div>
              )}
              <div>
                <label className="block text-[#8190a8] mb-1">Reset Token</label>
                <input
                  type="text"
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="Paste one-time reset token"
                  className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-xs font-mono text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <div>
                <label className="block text-[#8190a8] mb-1">New Password (min 8 characters)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-sm text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
                />
              </div>
            </>
          )}

          {successMsg && (
            <div className="flex items-start gap-2 text-xs text-[#37d69a] bg-[#102b27]/80 border border-[#1b5547] rounded-lg p-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs text-[#ff667a] bg-[#2c121a]/90 border border-[#5d2331] rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="text-[11px] text-[#8190a8] bg-[#070c17] border border-[#1b2940] rounded-lg p-2.5">
            Accounts persist your simulated paper balances, positions, and ledger transactions in
            SQLite. No real funds or exchange orders are connected.
          </div>

          <button
            type="submit"
            disabled={loading}
            className="gold-button w-full min-h-[44px] py-2.5 rounded-lg text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : mode === 'LOGIN' ? (
              <>
                <Lock className="w-3.5 h-3.5" />
                Sign In to Paper Terminal
              </>
            ) : mode === 'REGISTER' ? (
              <>
                <UserPlus className="w-3.5 h-3.5" />
                Create Paper Trading Account
              </>
            ) : resetStep === 'REQUEST' ? (
              <>
                <KeyRound className="w-3.5 h-3.5" />
                Request Password Reset Token
              </>
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5" />
                Confirm New Password
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
