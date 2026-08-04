import { SignInCard } from "@/components/SignInCard";

/**
 * Trustee sign-in gate (Figma node `4174-31660`, "Unauthenticated Overlay").
 *
 * Renders the wallet-connect "Login Prompt" card centered over a full-bleed
 * translucent/blurred overlay, matching the Figma frame. The overlay's own
 * tint (`rgba(246,248,248,0.8)`) has no equivalent design token today, so it
 * is a documented one-off arbitrary value scoped to this component.
 *
 * Rendered by `TrusteeShell` whenever the session is not authenticated — the
 * gate is **render-level**, not URL-level (#1008), so it shows on any URL and
 * cannot be stranded by a navigation race (the #921/#988/#1009 bug class).
 * `/sign-in` remains the canonical logged-out URL via the root redirects, but
 * nothing about the gate depends on it. `SignInCard` drives the real sign-in
 * flow (#791); on `status → authenticated` the shell re-renders into the app.
 */
export function SignInOverlay() {
  return (
    <main
      className={[
        // Full viewport — no sidebar/topbar chrome is mounted while
        // unauthenticated (see TrusteeShell).
        "flex min-h-screen w-full items-center justify-center p-4",
        "bg-[rgba(246,248,248,0.8)] backdrop-blur-[6px]",
      ].join(" ")}
      data-testid="sign-in-overlay"
    >
      <SignInCard />
    </main>
  );
}
