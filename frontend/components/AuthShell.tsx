import { ConnectLogo } from "@/components/ConnectLogo";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-split">
      <aside className="auth-brand">
        <div>
          <ConnectLogo size="hero" alt="Connect" />
          <p className="auth-title">Three desks. One account.</p>
          <p>Value a company, paper-trade the tape, or track mutual funds. Switch whenever the other tool is the right one.</p>
        </div>
        <p className="note auth-legal">Not investment advice. Simulated fills. Account data stays private.</p>
      </aside>
      <main id="main" className="auth-form">
        {children}
      </main>
    </div>
  );
}
