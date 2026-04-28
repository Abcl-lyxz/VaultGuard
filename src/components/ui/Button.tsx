import React from "react";

type Variant = "primary" | "ghost" | "danger" | "icon";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  size?: "sm" | "md";
}

export function Button({
  variant = "ghost",
  loading = false,
  leadingIcon,
  trailingIcon,
  children,
  disabled,
  size = "md",
  className = "",
  ...rest
}: ButtonProps) {
  const cls = [
    variant === "icon" ? "btn-icon" : `btn-${variant}`,
    size === "sm" ? "btn-sm" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button {...rest} className={cls} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {!loading && leadingIcon && <span className="btn-icon-slot" aria-hidden="true">{leadingIcon}</span>}
      {children && <span>{children}</span>}
      {!loading && trailingIcon && <span className="btn-icon-slot" aria-hidden="true">{trailingIcon}</span>}
    </button>
  );
}
