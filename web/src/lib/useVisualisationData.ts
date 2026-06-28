import { useEffect, useState } from "react";
import { API_URL } from "./api";
import type { Row } from "@/types/visualisation";

export type PageParams = { limit: number; offset: number };

export function useVisualisationData(id: string, page?: PageParams) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);

    const query = page ? `?limit=${page.limit}&offset=${page.offset}` : "";

    fetch(`${API_URL}/api/visualisations/${encodeURIComponent(id)}/data${query}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Request failed with ${res.status}`);
        return json as { rows: Row[]; total?: number };
      })
      .then(({ rows, total }) => {
        if (!cancelled) {
          setRows(rows);
          setTotal(total ?? null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [id, page?.limit, page?.offset]);

  return { rows, total, error };
}
