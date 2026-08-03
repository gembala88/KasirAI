import { useState } from 'react';
import { STORE_NAME } from '../branding';
import { login } from '../lib/api';
import type { AuthUser } from '../lib/auth';

export default function Login({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user } = await login(email, password);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={(e) => void handleSubmit(e)}>
        <h1 className="page-title">{STORE_NAME}</h1>
        <p className="hint">Masuk dengan akun ERPNext Anda.</p>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <p className="error-box">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Masuk…' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}
