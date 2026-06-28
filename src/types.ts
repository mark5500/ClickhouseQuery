// other system has records like this, and we want to store them in our system
export type ExternalBmiRecord = {
  dataExtractId: string;
  subjectId: string;
  submittedAt: string;
  dataPoint: {
    height: number;
    weight: number;
    bmi: number;
  };
};

export type ExternalDemographicsRecord = {
  dataExtractId: string;
  subjectId: string;
  submittedAt: string;
  dataPoint: {
    givenNames: string;
    familyName: string;
    sex: "male" | "female";
    dateOfBirth: string;
  };
};

export type ExternalBloodPressureRecord = {
  dataExtractId: string;
  subjectId: string;
  submittedAt: string;
  dataPoint: {
    systolic: number;
    diastolic: number;
    pulse: number;
  };
};

export type FieldType = "string" | "number" | "boolean" | "date";

export type DataExtract = {
  id: string;
  name: string;
  fields: { name: string; type: FieldType }[];
};

export const bmiDataExtract: DataExtract = {
  id: "bmi",
  name: "BMI Data Extract",
  fields: [
    { name: "height", type: "number" },
    { name: "weight", type: "number" },
    { name: "bmi", type: "number" },
  ],
};

export const demographicsDataExtract: DataExtract = {
  id: "demographics",
  name: "Demographics Data Extract",
  fields: [
    { name: "givenNames", type: "string" },
    { name: "familyName", type: "string" },
    { name: "sex", type: "string" },
    { name: "dateOfBirth", type: "date" },
  ],
};

export const bloodPressureDataExtract: DataExtract = {
  id: "blood-pressure",
  name: "Blood Pressure Data Extract",
  fields: [
    { name: "systolic", type: "number" },
    { name: "diastolic", type: "number" },
    { name: "pulse", type: "number" },
  ],
};

export type DataPoint = {
  id: string;
  dataExtractId: string;
  subjectId: string;
  submittedAt: string;
  payload: Record<string, unknown>;
};

export type Subject = {
  id: string;
};

// Visualisation types and their JSON schema live in ./visualisation-schema.ts,
// defined with Zod and inferred from there.
