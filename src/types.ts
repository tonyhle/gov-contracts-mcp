/**
 * Normalized shape shared across every procurement source so results from
 * SAM.gov, Cal eProcure, LA RAMP and LA County can be compared side by side.
 */
export type SourceId = "sam.gov" | "caleprocure" | "ramp" | "lacounty";

export interface ContractOpportunity {
  /** Which portal this record came from. */
  source: SourceId;
  /** Stable identifier within the source (notice id, event id, bid ref, etc.). */
  id: string;
  /** Human readable title of the solicitation/opportunity. */
  title: string;
  /** Agency-facing solicitation / bid / RFP number, when distinct from `id`. */
  solicitationNumber?: string;
  /** Free-text description or summary, when the source exposes one. */
  description?: string;
  /** Issuing department / agency / organization. */
  agency?: string;
  /** Current status as reported by the source (Open, Posted, Active, ...). */
  status?: string;
  /** Opportunity type (Solicitation, IFB, RFP, Award Notice, ...). */
  type?: string;
  /** ISO-ish date the opportunity was posted/published, when known. */
  postedDate?: string;
  /** ISO-ish date responses are due / the opportunity closes, when known. */
  closeDate?: string;
  /** NAICS code(s) associated with the opportunity, when known. */
  naics?: string;
  /** Commodity / classification description, when the source exposes one. */
  commodity?: string;
  /** Best public URL a human can open to view the opportunity. */
  url?: string;
  /** The untouched source payload for callers that want every field. */
  raw?: unknown;
}

export interface SearchResult {
  source: SourceId;
  /** True when the lookup succeeded (even if it returned zero rows). */
  ok: boolean;
  /** Number of opportunities returned. */
  count: number;
  opportunities: ContractOpportunity[];
  /** Populated when `ok` is false, or when there is a non-fatal note. */
  error?: string;
  /** Short note surfaced to the caller (e.g. how results were filtered). */
  note?: string;
}

/** Default keyword set when a caller asks for "software" contracts. */
export const DEFAULT_SOFTWARE_KEYWORD = "software";

/** NAICS codes that map to software / IT-services procurement. */
export const SOFTWARE_NAICS = [
  "511210", // Software Publishers
  "513210", // Software Publishers (2022 NAICS)
  "541511", // Custom Computer Programming Services
  "541512", // Computer Systems Design Services
  "541519", // Other Computer Related Services
  "518210", // Computing Infrastructure / Data Processing / Hosting
];
