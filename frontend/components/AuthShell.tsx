import "../app/auth.css";
import { AuthStage } from "@/components/auth/AuthStage";
import { display } from "@/components/home/cinema/font";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`auth-page ${display.variable}`}>
      <AuthStage />
      <main id="main" className="auth-form">
        {children}
      </main>
    </div>
  );
}
