import { cloneElement, type ReactElement } from "react";

export function LoadingState({ label = "Caricamento in corso" }: { readonly label?: string }) {
  return <p className="ui-state" role="status" aria-live="polite"><span className="state-mark" aria-hidden="true">…</span>{label}</p>;
}

export function EmptyState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return <div className="ui-state ui-empty"><strong>{title}</strong><span>{detail}</span></div>;
}

export function ErrorState({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }) {
  return <div className="ui-state ui-error" role="alert"><strong>Operazione non riuscita</strong><span>{message}</span>{onRetry ? <button className="button secondary" type="button" onClick={onRetry}>Riprova</button> : null}</div>;
}

type FieldControlProps = { readonly "aria-describedby"?: string; readonly "aria-invalid"?: boolean };

export function FormField({ id, label, hint, error, children }: { readonly id: string; readonly label: string; readonly hint?: string; readonly error?: string; readonly children: ReactElement<FieldControlProps> }) {
  const describedBy = error ? `${id}-error` : undefined;
  const control = cloneElement(children, {
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
  });
  return <div className="form-field"><label htmlFor={id}>{label}</label>{control}{hint ? <small>{hint}</small> : null}{error ? <span id={`${id}-error`} className="field-error" role="alert">{error}</span> : null}</div>;
}
