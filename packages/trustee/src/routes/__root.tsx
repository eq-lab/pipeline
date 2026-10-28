// spec: docs/frontend/trustee-flows.md#render-level-auth-gate-1008-1749
import { Navigate, createRootRoute } from "@tanstack/react-router";
import { RiskBanner } from "@pipeline/ui";
import { ToastProvider } from "@/components/ToastProvider";
import { TrusteeShell } from "@/components/TrusteeShell";
import { TrusteeSessionProvider } from "@/auth/TrusteeSessionProvider";

function RootComponent() {
  return (
    <>
      <RiskBanner />
      <TrusteeSessionProvider>
        <ToastProvider>
          <TrusteeShell />
        </ToastProvider>
      </TrusteeSessionProvider>
    </>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <Navigate to="/" replace />,
});
