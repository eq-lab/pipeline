import { TrusteeSidebar } from "@/components/TrusteeSidebar";
import { useTrusteeSession } from "@/auth/TrusteeSessionProvider";
import { RouteGate } from "@/auth/RouteGate";

/**
 * TrusteeShell — root layout for the Trustee admin panel.
 *
 * Reworked from the #777 scaffold's topbar into the persistent left-sidebar
 * app shell from Figma node `4116:8855` ("Aside") — issue #786. Authenticated
 * routes render `TrusteeSidebar` alongside a `flex-1` main region hosting
 * `RouteGate`/`<Outlet/>`; `/sign-in` stays standalone with no sidebar while
 * unauthenticated (preserves the #791 behavior). The shell wrapper here is a
 * plain `<div>`, not a `<main>` — the per-flow route components already own
 * their own `<main>` landmark, so nesting `<main>` inside `<main>` is avoided.
 *
 * Route gating (redirect unauthenticated → `/sign-in`, authenticated on
 * `/sign-in` → `/`) is delegated to `RouteGate`, rendered in place of a bare
 * `<Outlet/>`.
 */
export function TrusteeShell() {
  const { status } = useTrusteeSession();
  const isAuthenticated = status === "authenticated";

  if (!isAuthenticated) {
    return <RouteGate />;
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      <TrusteeSidebar />
      <div className="min-w-0 flex-1">
        <RouteGate />
      </div>
    </div>
  );
}
