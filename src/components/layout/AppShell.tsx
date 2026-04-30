import "../../styles/components/layout.css";

type Props = { children: React.ReactNode };

export function AppShell({ children }: Props) {
  return <div className="app-shell">{children}</div>;
}
