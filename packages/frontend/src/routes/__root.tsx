import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TopBar } from "@/components/TopBar";

export const Route = createRootRoute({
  component: () => (
    <>
      <TopBar />
      <Outlet />
    </>
  ),
});
