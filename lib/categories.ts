// Maps the industries users pick in the UI to OpenStreetMap tag filters.
export const INDUSTRIES: Record<string, { key: string; value: string }> = {
  HVAC: { key: "craft", value: "hvac" },
  Plumbing: { key: "craft", value: "plumber" },
  Electrician: { key: "craft", value: "electrician" },
  Roofing: { key: "craft", value: "roofer" },
  Landscaping: { key: "craft", value: "gardener" },
  Dental: { key: "amenity", value: "dentist" },
  Veterinary: { key: "amenity", value: "veterinary" },
  "Auto repair": { key: "shop", value: "car_repair" },
  Accounting: { key: "office", value: "accountant" },
  Legal: { key: "office", value: "lawyer" },
  "Real estate": { key: "office", value: "estate_agent" },
  Logistics: { key: "office", value: "logistics" },
};

export const INDUSTRY_NAMES = Object.keys(INDUSTRIES);
