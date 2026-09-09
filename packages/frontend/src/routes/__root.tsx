import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TopBar } from "@/components/TopBar";
import { RiskBanner } from "@/components/RiskBanner";
import { Footer } from "@/components/Footer";

// spec: docs/frontend/dashboard-components.md#root-layout
export const Route = createRootRoute({
  component: () => (
    <>
      <TopBar />
      <RiskBanner />
      <Outlet />
      <Footer />
    </>
  ),
});
