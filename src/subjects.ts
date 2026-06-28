import type { Subject } from "./types.js";

const SUBJECT_COUNT = 50_000;

// Deterministic, not random — every seed script imports this and must agree
// on the same set of subject ids across separate process runs.
export const subjects: Subject[] = Array.from({ length: SUBJECT_COUNT }, (_, i) => ({
  id: `subject-${String(i + 1).padStart(6, "0")}`,
}));
