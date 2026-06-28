import { useEffect, useState } from "react";
import { API_URL } from "./api";
import type { DashboardEntry } from "@/types/visualisation";

export function useDashboard() {
  const [entries, setEntries] = useState<DashboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/api/dashboard`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Request failed with ${res.status}`);
        return json.visualisations as DashboardEntry[];
      })
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { entries, error };
}
