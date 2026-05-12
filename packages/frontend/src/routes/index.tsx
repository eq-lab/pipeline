import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/TopBar";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="bg-pipeline-paper text-pipeline-ink min-h-screen">
      <TopBar />
      <main className="p-8">
        <h1 className="font-display text-pipeline-title font-bold">Pipeline</h1>
        <p className="font-body text-pipeline-body text-pipeline-ink-muted mt-4">
          Token plumbing smoke test — color, typography, and radius tokens are
          wired from <code>@pipeline/ui</code>.
        </p>
        <div className="bg-pipeline-surface border-pipeline-line rounded-pipeline-card mt-6 inline-block border px-4 py-2">
          <span className="text-pipeline-caption tracking-pipeline-label uppercase">
            ready
          </span>
        </div>
      </main>
    </div>
  ),
});
