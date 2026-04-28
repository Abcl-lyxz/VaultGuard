import { useMemo } from "react";

export type StrengthLevel = "very-weak" | "weak" | "fair" | "strong" | "very-strong";

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  level: StrengthLevel;
  label: string;
  color: string;
}

const LEVELS: { level: StrengthLevel; label: string; color: string }[] = [
  { level: "very-weak",   label: "Very weak",   color: "var(--danger)" },
  { level: "weak",        label: "Weak",         color: "var(--warning)" },
  { level: "fair",        label: "Fair",         color: "var(--yellow, #ffd666)" },
  { level: "strong",      label: "Strong",       color: "var(--success)" },
  { level: "very-strong", label: "Very strong",  color: "var(--cyan)" },
];

function calcScore(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  // entropy rough estimate
  const charPool =
    (/[a-z]/.test(pw) ? 26 : 0) +
    (/[A-Z]/.test(pw) ? 26 : 0) +
    (/\d/.test(pw)    ? 10 : 0) +
    (/[^A-Za-z0-9]/.test(pw) ? 32 : 0);
  const entropy = pw.length * Math.log2(Math.max(charPool, 1));
  if (entropy >= 80) s = Math.max(s, 4) as 0|1|2|3|4;
  return Math.min(s, 4) as 0 | 1 | 2 | 3 | 4;
}

export function usePasswordStrength(password: string): PasswordStrength {
  return useMemo(() => {
    const score = calcScore(password);
    return { score, ...LEVELS[score] };
  }, [password]);
}
