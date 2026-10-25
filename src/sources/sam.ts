import { httpFetch, clean, formatUsDate } from "../util.js";
import {
  ContractOpportunity,
  SearchResult,
  SOFTWARE_NAICS,
} from "../types.js";

const SAM_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";

export interface SamSearchParams {
  /** Free-text keyword (matched against the opportunity title by SAM). */
  keyword?: string;
  /** NAICS code filter. Defaults to software NAICS codes when omitted. */
  naics?: string[];
  /** Procurement type, e.g. o=Solicitation, k=Combined Synopsis, p=Presol. */
  ptype?: string;
  /** Place-of-performance state (2-letter), e.g. "CA". */
  state?: string;
  /** Posted-from date (MM/dd/yyyy). Defaults to 1 year ago. */
  postedFrom?: string;
  /** Posted-to date (MM/dd/yyyy). Defaults to today. */
  postedTo?: string;
  /** Max rows (SAM caps at 1000). Defaults to 25. */
  limit?: number;
  /** Override the API key (otherwise read from SAM_API_KEY env). */
  apiKey?: string;
}

interface SamNotice {
  noticeId?: string;
  title?: string;
  solicitationNumber?: string;
  fullParentPathName?: string;
  department?: string;
  type?: string;
  postedDate?: string;
  naicsCode?: string;
  classificationCode?: string;
  active?: string;
  description?: string;
  uiLink?: string;
  responseDeadLine?: string;
  organizationType?: string;
}

function toOpportunity(n: SamNotice): ContractOpportunity {
  return {
    source: "sam.gov",
    id: n.noticeId ?? n.solicitationNumber ?? "(unknown)",
    title: clean(n.title) ?? "(untitled)",
    solicitationNumber: clean(n.solicitationNumber),
    description: clean(n.description),
    agency: clean(n.fullParentPathName ?? n.department),
    status: n.active === "Yes" ? "Active" : n.active === "No" ? "Inactive" : undefined,
    type: clean(n.type),
    postedDate: clean(n.postedDate),
    closeDate: clean(n.responseDeadLine),
    naics: clean(n.naicsCode),
    commodity: clean(n.classificationCode),
    url: clean(n.uiLink),
    raw: n,
  };
}

/**
 * Search federal contract opportunities on SAM.gov via the official
 * Get Opportunities v2 public API. Requires a free API key (SAM_API_KEY).
 */
export async function searchSam(params: SamSearchParams): Promise<SearchResult> {
  const apiKey = params.apiKey ?? process.env.SAM_API_KEY;
  if (!apiKey) {
    return {
      source: "sam.gov",
      ok: false,
      count: 0,
      opportunities: [],
      error:
        "Missing SAM.gov API key. Set the SAM_API_KEY environment variable " +
        "with a free key from https://sam.gov (Account Details > API Key), or " +
        "pass apiKey to this tool.",
    };
  }

  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);
  oneYearAgo.setDate(oneYearAgo.getDate() + 1); // SAM range must be < 1 year

  const limit = Math.min(Math.max(params.limit ?? 25, 1), 1000);
  const naicsList = params.naics && params.naics.length ? params.naics : SOFTWARE_NAICS;

  const query = new URLSearchParams();
  query.set("api_key", apiKey);
  query.set("postedFrom", params.postedFrom ?? formatUsDate(oneYearAgo));
  query.set("postedTo", params.postedTo ?? formatUsDate(now));
  query.set("limit", String(limit));
  query.set("offset", "0");
  if (params.keyword) query.set("title", params.keyword);
  if (params.ptype) query.set("ptype", params.ptype);
  if (params.state) query.set("state", params.state);

  // SAM accepts a single ncode per request. Query each NAICS and merge.
  const seen = new Map<string, ContractOpportunity>();
  let anyOk = false;
  let lastError: string | undefined;
  const notes: string[] = [];

  for (const ncode of naicsList) {
    const q = new URLSearchParams(query);
    q.set("ncode", ncode);
    try {
      const resp = await httpFetch(`${SAM_SEARCH_URL}?${q.toString()}`, {
        headers: { Accept: "application/json" },
        timeoutMs: 30_000,
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        lastError = `SAM.gov returned HTTP ${resp.status} for NAICS ${ncode}: ${body.slice(0, 300)}`;
        // 401/403 are fatal (bad key / rate-limited) — stop early.
        if (resp.status === 401 || resp.status === 403 || resp.status === 429) {
          return {
            source: "sam.gov",
            ok: false,
            count: 0,
            opportunities: [],
            error: lastError,
          };
        }
        continue;
      }
      anyOk = true;
      const data = (await resp.json()) as { opportunitiesData?: SamNotice[]; totalRecords?: number };
      for (const n of data.opportunitiesData ?? []) {
        const opp = toOpportunity(n);
        if (!seen.has(opp.id)) seen.set(opp.id, opp);
      }
    } catch (err) {
      lastError = `SAM.gov request failed for NAICS ${ncode}: ${(err as Error).message}`;
    }
    if (seen.size >= limit) break;
  }

  const opportunities = Array.from(seen.values()).slice(0, limit);
  if (!anyOk && opportunities.length === 0) {
    return {
      source: "sam.gov",
      ok: false,
      count: 0,
      opportunities: [],
      error: lastError ?? "SAM.gov returned no successful responses.",
    };
  }

  notes.push(
    `Searched NAICS [${naicsList.join(", ")}]${
      params.keyword ? ` with title keyword "${params.keyword}"` : ""
    } over the last year.`,
  );

  return {
    source: "sam.gov",
    ok: true,
    count: opportunities.length,
    opportunities,
    note: notes.join(" "),
    error: lastError && opportunities.length === 0 ? lastError : undefined,
  };
}
