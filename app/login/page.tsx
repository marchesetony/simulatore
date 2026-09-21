'use client';

import { FormEvent, useState } from 'react';

type LoginState = 'idle' | 'loading' | 'invalid' | 'temporary' | 'tenant-selection';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<LoginState>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('loading');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body: unknown = await response.json();
      if (response.ok && typeof body === 'object' && body !== null && 'authenticated' in body && body.authenticated === true) {
        window.location.assign('/');
        return;
      }
      if (typeof body === 'object' && body !== null && 'state' in body && body.state === 'TENANT_SELECTION_REQUIRED') setState('tenant-selection');
      else if (response.status >= 500) setState('temporary');
      else setState('invalid');
    } catch {
      setState('temporary');
    }
  }

  const message = state === 'invalid' ? 'Email o password non valide.' : state === 'temporary' ? 'Accesso temporaneamente non disponibile. Riprova.' : state === 'tenant-selection' ? 'Il tuo account richiede la selezione di un tenant.' : null;

  return <main className="login-shell"><section className="login-card" aria-labelledby="login-title"><div className="login-brand"><span className="login-mark">EO</span><div><span className="eyebrow">ENERGIA OPERATIVA</span><strong>Console operativa</strong></div></div><div className="login-heading"><span className="eyebrow">ACCESSO PRODUCTION</span><h1 id="login-title">Accedi</h1><p>Usa le credenziali aziendali per entrare nella console.</p></div><form className="login-form" onSubmit={submit}><label htmlFor="login-email">Email<input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={state === 'loading'} /></label><label htmlFor="login-password">Password<input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={state === 'loading'} /></label>{message && <p className="login-message" role="alert">{message}</p>}<button className="button primary login-submit" type="submit" disabled={state === 'loading'}>{state === 'loading' ? 'Verifica in corso…' : 'Accedi'}</button></form></section></main>;
}
