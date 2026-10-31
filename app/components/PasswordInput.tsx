'use client';

import { useState, type InputHTMLAttributes } from 'react';

/** Password field with a button that shows or hides what was typed (Tony, 27/10: "la password si deve poter vedere"). */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return <span className="password-input"><input {...props} type={visible ? 'text' : 'password'} /><button type="button" className="password-toggle" onClick={() => setVisible((value) => !value)} aria-label={visible ? 'Nascondi password' : 'Mostra password'} aria-pressed={visible} disabled={props.disabled}>{visible ? 'Nascondi' : 'Mostra'}</button></span>;
}
