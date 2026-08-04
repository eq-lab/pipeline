import { Outlet } from "@tanstack/react-router";
import { TrusteeSidebar } from "@/components/TrusteeSidebar";
import { SignInOverlay } from "@/components/SignInOverlay";
import { useTrusteeSession } from "@/auth/TrusteeSessionProvider";

/**
 * TrusteeShell — root layout for the Trustee admin panel.
 *
 * Reworked from the #777 scaffold's topbar into the persistent left-sidebar
 * app shell from Figma node `4116:8855` ("Aside") — issue #786. The shell
 * wrapper here is a plain `<div>`, not a `<main>` — the per-flow route
 * components already own their own `<main>` landmark.
 *
 * Auth **correctness** is render-level (#1008): while the session is not
 * authenticated, the shell renders `SignInOverlay` — regardless of URL — and
 * protected route content (`<Outlet/>`) is not mounted at all, so no
 * authenticated API calls fire while signed out. This layer cannot race (the
 * #921/#988/#1009 stranded-URL class). The URL *convention* (`/sign-in` is the
 * canonical logged-out URL; authenticated users never see it) is enforced
 * separately by the root route's redirects (`__root.tsx`) — if those ever
 * misfire, only the address bar is briefly wrong, never the content.
 */
export function TrusteeShell() {
  const { status } = useTrusteeSession();
  const isAuthenticated = status === "authenticated";

  if (!isAuthenticated) {
    return <SignInOverlay />;
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
