import { createFileRoute } from "@tanstack/react-router";

/**
 * `/sign-in` — the canonical logged-out URL. Renders nothing: the gate UI is
 * the shell's render-level overlay, and root redirects keep the URL convention.
 * spec: docs/frontend/trustee-flows.md#two-layer-gating-1008.
 */
function SignIn() {
  // Reachable only between authenticating on /sign-in and the redirect to "/".
  return null;
}

export const Route = createFileRoute("/sign-in")({
  component: SignIn,
});
