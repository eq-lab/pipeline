import { createFileRoute } from "@tanstack/react-router";
import { SignInCard } from "@/components/SignInCard";

/**
 * Trustee sign-in gate (Figma node `4174-31660`, "Unauthenticated Overlay").
 *
 * Renders the wallet-connect "Login Prompt" card centered over a full-bleed
 * translucent/blurred overlay, matching the Figma frame. The overlay's own
 * tint (`rgba(246,248,248,0.8)`) has no equivalent design token today, so it
 * is a documented one-off arbitrary value scoped to this route.
 *
 * Wired to the real sign-in flow (#791): `SignInCard` calls
 * `useTrusteeSession().signIn()`, which drives wallet-connect → backend
 * signature challenge → sign → verify → session. Route gating
 * (`TrusteeShell` → `RouteGate`) renders this route standalone — the sidebar
 * nav (#786) is hidden while unauthenticated — and redirects an
 * already-authenticated visitor away from `/sign-in` to `/`.
 *
 * Out of scope here: the "Overview" heading + timestamp header row visible
 * behind the overlay in the Figma frame is the dashboard shell's content,
 * tracked by #786 — this route renders only the gate itself on the standard
 * paper background.
 */
function SignIn() {
  return (
    <main
      className={[
        // No sidebar/topbar on this standalone route (#786), so the overlay
        // is a full viewport height rather than offset by chrome.
        "flex min-h-screen w-full items-center justify-center p-4",
        "bg-[rgba(246,248,248,0.8)] backdrop-blur-[6px]",
      ].join(" ")}
      data-testid="sign-in-overlay"
    >
      <SignInCard />
    </main>
  );
}

export const Route = createFileRoute("/sign-in")({
  component: SignIn,
});
