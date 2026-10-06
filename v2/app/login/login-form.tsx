"use client";

import { useState, type FormEvent } from "react";
import styles from "./login.module.css";

export default function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/v2/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ email: fields.get("email"), password: fields.get("password") }),
      });
      if (response.ok) {
        const session = await fetch("/api/v2/auth/session", { credentials: "same-origin", cache: "no-store" });
        setMessage(session.ok ? "Accesso effettuato." : "Impossibile verificare l’accesso. Riprova.");
      } else {
        setMessage(response.status === 401 ? "Accesso non consentito. Verifica le credenziali o contatta l’amministratore." :
          response.status === 403 ? "L’accesso richiede una verifica dell’amministratore." :
            "Accesso temporaneamente non disponibile. Riprova più tardi.");
      }
    } catch { setMessage("Connessione non disponibile. Riprova."); }
    finally {
      const password = form.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
      setLoading(false);
    }
  }

  return <main className={styles.page}>
    <form method="post" action="/api/v2/auth/login" className={styles.form} onSubmit={submit} aria-busy={loading}>
      <label htmlFor="v2-email">Email</label>
      <input id="v2-email" name="email" type="email" autoComplete="username" required maxLength={254} disabled={loading} />
      <label htmlFor="v2-password">Password</label>
      <input id="v2-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} disabled={loading} />
      <button type="submit" disabled={loading}>{loading ? "Accesso in corso…" : "Accedi"}</button>
      <p role="status" aria-live="polite">{message}</p>
    </form>
  </main>;
}
