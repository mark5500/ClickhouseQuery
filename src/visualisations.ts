import type { Visualisation } from "./visualisation-schema.js";

const latest = { strategy: "pick", by: { field: "submitted_at", direction: "desc" } } as const;
const all = (field: string) => ({ strategy: "all", orderBy: { field, direction: "asc" } } as const);

const bmiLatest = { id: "bmi", extract: "bmi", resolve: latest } as const;
const demoLatest = { id: "demo", extract: "demographics", resolve: latest } as const;
const bpLatest = { id: "bp", extract: "blood-pressure", resolve: latest } as const;

// Named WHO BMI categories rather than an arbitrary histogram — one row per
// category, not one row per subject.
export const bmiDistribution: Visualisation = {
  id: "bmi-distribution",
  type: "distribution",
  title: "BMI Distribution",
  extracts: [bmiLatest],
  value: { extract: "bmi", field: "bmi" },
  binning: {
    strategy: "custom",
    buckets: [
      { label: "Underweight", max: 18.5 },
      { label: "Normal", max: 25 },
      { label: "Overweight", max: 30 },
      { label: "Obese" },
    ],
  },
  filters: [],
  pagination: null,
};

export const averageBmiBySex: Visualisation = {
  id: "average-bmi-by-sex",
  type: "bar",
  title: "Average BMI by Sex",
  extracts: [bmiLatest, demoLatest],
  category: { extract: "demo", field: "sex" },
  value: { extract: "bmi", field: "bmi", aggregate: "avg" },
  filters: [],
  pagination: null,
};

// Average BMI per month, split by sex — an aggregate trend across all
// subjects (2 lines), not a raw line per subject.
export const bmiTrend: Visualisation = {
  id: "bmi-trend",
  type: "line",
  title: "Average BMI Trend by Sex",
  extracts: [{ id: "bmi", extract: "bmi", resolve: all("submitted_at") }, demoLatest],
  x: { extract: "bmi", field: "submitted_at", bucket: "month" },
  y: { extract: "bmi", field: "bmi", aggregate: "avg" },
  series: { extract: "demo", field: "sex" },
  filters: [],
  pagination: null,
};

// 20,000 subjects is too many points to render — take a random sample.
const SCATTER_SAMPLE_SIZE = 50;

export const bmiVsAge: Visualisation = {
  id: "bmi-vs-age",
  type: "scatter",
  title: "BMI vs Date of Birth",
  extracts: [bmiLatest, demoLatest],
  x: { extract: "demo", field: "dateOfBirth" },
  y: { extract: "bmi", field: "bmi" },
  series: { extract: "demo", field: "sex" },
  sampleSize: SCATTER_SAMPLE_SIZE,
  filters: [],
  pagination: null,
};

export const systolicVsDiastolic: Visualisation = {
  id: "systolic-vs-diastolic",
  type: "scatter",
  title: "Systolic vs Diastolic",
  extracts: [bpLatest, demoLatest],
  x: { extract: "bp", field: "diastolic" },
  y: { extract: "bp", field: "systolic" },
  series: { extract: "demo", field: "sex" },
  sampleSize: SCATTER_SAMPLE_SIZE,
  filters: [],
  pagination: null,
};

export const averageSystolicBySex: Visualisation = {
  id: "average-systolic-by-sex",
  type: "bar",
  title: "Average Systolic by Sex",
  extracts: [bpLatest, demoLatest],
  category: { extract: "demo", field: "sex" },
  value: { extract: "bp", field: "systolic", aggregate: "avg" },
  filters: [],
  pagination: null,
};

export const sexBreakdown: Visualisation = {
  id: "sex-breakdown",
  type: "pie",
  title: "Subjects by Sex",
  extracts: [demoLatest],
  category: { extract: "demo", field: "sex" },
  value: { extract: "demo", field: "subject_id", aggregate: "count" },
  filters: [],
  pagination: null,
};

export const subjectSummaryTable: Visualisation = {
  id: "subject-summary",
  type: "table",
  title: "Subject Summary",
  extracts: [demoLatest, bmiLatest, bpLatest],
  columns: [
    { extract: "demo", field: "givenNames", label: "givenNames" },
    { extract: "demo", field: "familyName", label: "familyName" },
    { extract: "demo", field: "sex", label: "sex" },
    { extract: "demo", field: "dateOfBirth", label: "dateOfBirth" },
    { extract: "bmi", field: "bmi", label: "bmi" },
    { extract: "bp", field: "systolic", label: "systolic" },
    { extract: "bp", field: "diastolic", label: "diastolic" },
  ],
  sort: { extract: "demo", field: "familyName", direction: "asc" },
  filters: [],
  pagination: { limit: 10, offset: 0 },
};

export const visualisations: Visualisation[] = [
  bmiDistribution,
  averageBmiBySex,
  bmiTrend,
  bmiVsAge,
  systolicVsDiastolic,
  averageSystolicBySex,
  sexBreakdown,
  subjectSummaryTable,
];
