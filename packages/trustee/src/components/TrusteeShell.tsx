import { Outlet } from "@tanstack/react-router";
import { TrusteeSidebar } from "@/components/TrusteeSidebar";
import { useTrusteeSession } from "@/auth/TrusteeSessionProvider";

/**
 * TrusteeShell — root layout for the Trustee admin panel.
 *
 * Reworked from the #777 scaffold's topbar into the persistent left-sidebar
 * app shell from Figma node `4116:8855` ("Aside") — issue #786. Authenticated
 * routes render `TrusteeSidebar` alongside a `flex-1` main region hosting the
 * `<Outlet/>`; `/sign-in` stays standalone with no sidebar while
 * unauthenticated (preserves the #791 behavior). The shell wrapper here is a
 * plain `<div>`, not a `<main>` — the per-flow route components already own
 * their own `<main>` landmark, so nesting `<main>` inside `<main>` is avoided.
 *
 * This component only chooses the layout (sidebar or not) from the session
 * status. The auth *redirects* (unauthenticated → `/sign-in`, authenticated on
 * `/sign-in` → `/`) live in the root route's `beforeLoad` (`__root.tsx`), NOT a
 * render-phase `<Navigate>` — see that file for the #921 race rationale.
 */
export function TrusteeShell() {
  const { status } = useTrusteeSession();
  const isAuthenticated = status === "authenticated";

  if (!isAuthenticated) {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      <TrusteeSidebar />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
