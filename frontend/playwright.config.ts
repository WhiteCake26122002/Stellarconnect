import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "cmd /c venv\\Scripts\\python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000",
      cwd: "..",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
      env: {
        DATABASE_URL: "sqlite:///./backend/data/e2e.db",
        CORS_ORIGINS: "http://localhost:3000",
      },
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:3000/login",
      reuseExistingServer: true,
      env: { NEXT_PUBLIC_API_URL: "", API_PROXY_TARGET: "http://127.0.0.1:8000" },
    },
  ],
});
