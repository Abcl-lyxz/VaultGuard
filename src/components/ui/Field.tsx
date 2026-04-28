import React, { useId } from "react";

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}

export function Field({ label, required, error, hint, children }: FieldProps) {
  const id = useId();
  return (
    <div className={`field${error ? " field-error" : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </label>
      {children(id)}
      {error  && <span className="field-hint field-hint-error" role="alert">{error}</span>}
      {hint && !error && <span className="field-hint">{hint}</span>}
    </div>
  );
}
