import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TopBar } from "@/components/TopBar";
import { Footer } from "@/components/Footer";

/**
 * Root layout — wraps every route with the global TopBar and Footer.
 *
 * Footer sits below/outside each route's `<Outlet>` content so it renders
 * on the page background (`--color-pipeline-paper`) on all routes, matching
 * Figma `3283-13463` (Issue #746, epic #712).
 */
export const Route = createRootRoute({
  component: () => (
    <>
      <TopBar />
      <Outlet />
      {/* Global footer — Figma 3283-13463, Issue #746 */}
      <Footer />
    </>
  ),
});
