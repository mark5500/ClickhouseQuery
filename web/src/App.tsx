import { VisualisationCard } from "@/components/charts/VisualisationCard";
import { useDashboard } from "@/lib/useDashboard";

function App() {
  const { entries, error } = useDashboard();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-6">
        <h1 className="text-2xl font-semibold">QueryBuilder Visualisations</h1>
        <p className="text-muted-foreground text-sm">
          Live queries against ClickHouse via the SQL builder API.
        </p>
      </header>
      <main className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        {error && <p className="text-destructive text-sm">Failed to load dashboard: {error}</p>}
        {entries?.map((entry) => (
          <VisualisationCard key={entry.id} entry={entry} />
        ))}
      </main>
    </div>
  );
}

export default App;
