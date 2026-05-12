import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/TopBar";
import { WelcomeHeader } from "@/components/WelcomeHeader";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="bg-pipeline-paper text-pipeline-ink min-h-screen">
      <TopBar />
      <main className="p-8">
        <WelcomeHeader className="mx-auto max-w-[1200px]" />
      </main>
    </div>
  ),
});
