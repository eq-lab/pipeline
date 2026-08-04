import { SignInCard } from "@/components/SignInCard";

/**
 * Sign-in gate overlay (Figma `4174-31660`) — rendered by TrusteeShell on any
 * URL while the session is not authenticated. The overlay tint
 * (`rgba(246,248,248,0.8)`) has no design token; documented one-off.
 *
 * spec: docs/frontend/trustee-flows.md#session--auth.
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
