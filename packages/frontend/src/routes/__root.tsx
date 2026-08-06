import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TopBar } from "@/components/TopBar";
import { Footer } from "@/components/Footer";

// spec: docs/frontend/dashboard-components.md#root-layout
export const Route = createRootRoute({
  component: () => (
    <>
      <TopBar />
      <Outlet />
      <Footer />
    </>
  ),
});
