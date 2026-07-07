import { Link, Outlet } from "@tanstack/react-router";
import { Logo } from "@pipeline/ui";
import { TRUSTEE_FLOW_TYPES } from "@/lib/flowTypes";

/**
 * TrusteeShell — root layout for the Trustee admin panel.
 *
 * A minimal topbar (Pipeline wordmark + "Trustee Admin" label + a nav
 * listing the four Trustee flow types) wrapping the routed page content.
 * No wallet/account UI here — auth/session is explicitly out of scope for
 * the scaffold (#453) and the wallet layer is deferred to #778.
 */
export function TrusteeShell() {
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

          <nav aria-label="Trustee flow types" className="flex flex-wrap gap-4">
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
          </nav>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
