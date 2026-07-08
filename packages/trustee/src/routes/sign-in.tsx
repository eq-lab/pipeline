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
 * Out of scope here (see issue #787): the "Overview" heading + timestamp
 * header row visible behind the overlay in the Figma frame is the dashboard
 * shell's content, tracked by #786 — this route renders only the gate
 * itself on the standard paper background. The `TrusteeShell` topbar (logo +
 * flow-type nav) still wraps every route including this one; hiding it for
 * an authenticated-gate screen is left to the wallet/session wiring in #778,
 * which will decide when the gate actually needs to render standalone.
 */
function SignIn() {
  return (
    <main
      className={[
        "flex min-h-[calc(100vh-73px)] w-full items-center justify-center p-4",
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
