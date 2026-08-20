export const STATUSES = [
  { id: "applied", label: "Applied" },
  { id: "screening", label: "Screening" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Rejected" },
  { id: "ghosted", label: "Ghosted" },
];

export const SOURCES = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "company", label: "Company site" },
  { id: "referral", label: "Referral" },
  { id: "recruiter", label: "Recruiter" },
  { id: "other", label: "Other" },
];

export const DEFAULT_PROFILE = {
  defaultSalary: "",
  currency: "USD",
  resumeVersion: "",
  noticePeriod: "",
  workAuth: "",
  preferredLocations: "",
  followUpDays: 7,
};

export const STORAGE_KEYS = {
  applications: "applications",
  profile: "profile",
};
