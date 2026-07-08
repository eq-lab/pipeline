import { Link } from "@tanstack/react-router";
import { Logo } from "@pipeline/ui";
import { TRUSTEE_FLOW_TYPES } from "@/lib/flowTypes";
import { useTrusteeSession } from "@/auth/TrusteeSessionProvider";
import { RouteGate } from "@/auth/RouteGate";

/**
 * TrusteeShell — root layout for the Trustee admin panel.
 *
 * A minimal topbar (Pipeline wordmark + "Trustee Admin" label + a nav
 * listing the four Trustee flow types + an account/sign-out control) wrapping
 * the routed page content. The topbar nav and account control are hidden
 * while unauthenticated so `/sign-in` renders standalone (#791) — resolves
 * the note left in the #787 scaffold about the topbar wrapping the gate.
 *
 * Route gating (redirect unauthenticated → `/sign-in`, authenticated on
 * `/sign-in` → `/`) is delegated to `RouteGate`, rendered in place of a bare
 * `<Outlet/>`.
 */
export function TrusteeShell() {
  const { status, address, signOut } = useTrusteeSession();
  const isAuthenticated = status === "authenticated";

  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      <header className="border-b border-solid border-[color:var(--color-pipeline-line)]">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-8">
          <Link
            to="/"
            className="flex items-center gap-3 no-underline"
            aria-label="Pipeline Trustee — home"
          >
            <Logo aria-hidden="true" width={116} />
            <span className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] font-[var(--font-weight-medium)] text-[color:var(--color-pipeline-ink)]">
              Trustee Admin
            </span>
          </Link>

          {isAuthenticated ? (
            <nav
              aria-label="Trustee flow types"
              className="flex flex-wrap items-center gap-4"
            >
              {TRUSTEE_FLOW_TYPES.map((type) => (
                <Link
                  key={type.path}
                  to={type.path}
                  className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink-muted)] no-underline hover:text-[color:var(--color-pipeline-ink)]"
                  activeProps={{
                    className: "text-[color:var(--color-pipeline-ink)]",
                  }}
                >
                  {type.navLabel}
                </Link>
              ))}

              <span
                className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] text-[color:var(--color-pipeline-ink-muted)]"
                data-testid="trustee-account-address"
                title={address}
              >
                {address ? truncateAddress(address) : null}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="cursor-pointer bg-transparent font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] font-[var(--font-weight-emphasized)] text-[color:var(--color-pipeline-ink)]"
              >
                Sign out
              </button>
            </nav>
          ) : null}
        </div>
      </header>

      <RouteGate />
    </div>
  );
}

/** Truncates a wallet address for display: `0x1234…abcd` / `GABCD…WXYZ`. */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
