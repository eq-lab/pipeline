import { SignInCard } from "@/components/SignInCard";

/**
 * Trustee sign-in gate (Figma node `4174-31660`, "Unauthenticated Overlay").
 *
 * Renders the wallet-connect "Login Prompt" card centered over a full-bleed
 * translucent/blurred overlay, matching the Figma frame. The overlay's own
 * tint (`rgba(246,248,248,0.8)`) has no equivalent design token today, so it
 * is a documented one-off arbitrary value scoped to this component.
 *
 * Rendered by `TrusteeShell` whenever the session is not authenticated —
 * the gate is an **overlay on the current URL**, not a route (#1008): there
 * is no `/sign-in` path, so no auth redirect can ever strand the URL (the
 * #921 / #988 / #1009 bug class). `SignInCard` drives the real sign-in flow
 * (#791); on `status → authenticated` the shell simply re-renders into the
 * dashboard at the same URL.
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
