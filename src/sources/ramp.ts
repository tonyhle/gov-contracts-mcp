import { httpFetch, clean } from "../util.js";
import { ContractOpportunity, SearchResult } from "../types.js";

const RAMP_BASE = "https://www.rampla.org";
const RAMP_PAGE = `${RAMP_BASE}/s/opportunities`;
const RAMP_AURA = `${RAMP_BASE}/s/sfsites/aura`;

export interface RampSearchParams {
  /** Free-text search over opportunity name/description. */
  keyword?: string;
  /** Status filter. Defaults to currently-biddable ["Open", "Amended"]. */
  status?: string[];
  /** Opportunity category, e.g. "Commodity", "Construction". */
  category?: string[];
  /** NAICS codes to filter on. */
  naics?: string[];
  /** Max rows (RAMP caps its own list). Defaults to 50. */
  limit?: number;
}

interface RampAccount {
  Name?: string;
  Full_Company_Name__c?: string;
  Id?: string;
}

interface RampOpportunity {
  Id?: string;
  Name?: string;
  Description?: string;
  BAVN_ID__c?: string;
  CreatedDate?: string;
  CloseDate?: string;
  StageName?: string;
  Bid_Post__c?: string;
  Bid_Due__c?: string;
  Enable_Online_BIP__c?: boolean;
  Account?: RampAccount;
  Type?: string;
  NAICS__c?: string;
}

interface AuraResponse {
  actions?: Array<{
    id: string;
    state: string;
    returnValue?: RampOpportunity[] | null;
    error?: Array<{ message?: string }>;
  }>;
}

/** Fetch a fresh framework UID + guest session cookies from the live page. */
async function bootstrap(): Promise<{ fwuid: string; cookies: string }> {
  const resp = await httpFetch(RAMP_PAGE, { timeoutMs: 30_000 });
  const setCookie =
    typeof (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (resp.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  const cookies = setCookie.map((c) => c.split(";")[0]).join("; ");
  const html = await resp.text();
  const fwuid = html.match(/"fwuid":"([^"]+)"/)?.[1];
  if (!fwuid) {
    throw new Error("Could not read Salesforce fwuid from rampla.org (site layout may have changed).");
  }
  return { fwuid, cookies };
}

function toOpportunity(o: RampOpportunity): ContractOpportunity {
  const agency = clean(o.Account?.Full_Company_Name__c ?? o.Account?.Name);
  const url = o.BAVN_ID__c
    ? `${RAMP_BASE}/s/opportunity-details?bavnId=${encodeURIComponent(o.BAVN_ID__c)}`
    : `${RAMP_BASE}/s/opportunities`;
  return {
    source: "ramp",
    id: o.Id ?? o.BAVN_ID__c ?? "(unknown)",
    title: clean(o.Name) ?? "(untitled)",
    solicitationNumber: clean(o.BAVN_ID__c),
    description: clean(o.Description),
    agency,
    status: clean(o.StageName),
    type: clean(o.Type),
    postedDate: clean(o.Bid_Post__c ?? o.CreatedDate),
    closeDate: clean(o.Bid_Due__c ?? o.CloseDate),
    naics: clean(o.NAICS__c),
    url,
    raw: o,
  };
}

/**
 * Search City of Los Angeles contracting opportunities on RAMP (rampla.org).
 * Uses the public Salesforce "guest user" Aura endpoint — no login required.
 */
export async function searchRamp(params: RampSearchParams): Promise<SearchResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 250);
  const status = params.status && params.status.length ? params.status : ["Amended", "Open"];

  let fwuid: string;
  let cookies: string;
  try {
    ({ fwuid, cookies } = await bootstrap());
  } catch (err) {
    return {
      source: "ramp",
      ok: false,
      count: 0,
      opportunities: [],
      error: `Failed to initialize RAMP session: ${(err as Error).message}`,
    };
  }

  const message = {
    actions: [
      {
        id: "1;a",
        descriptor: "apex://MainSearchController/ACTION$searchForIds",
        callingDescriptor: "markup://c:MainSearch",
        params: {
          searchText: params.keyword ?? "",
          category: params.category ?? [],
          status,
          type: [],
          onlineBIP: [],
          naics: params.naics ?? [],
          industry: [],
          postedFrom: null,
          postedTo: null,
          dueFrom: null,
          dueTo: null,
          summaryDueFrom: null,
          summaryDueTo: null,
          outreachDueFrom: null,
          outreachDueTo: null,
          listLimit: limit,
          order: "",
        },
      },
    ],
  };

  const context = {
    mode: "PROD",
    fwuid,
    app: "siteforce:communityApp",
    loaded: {},
    dn: [],
    globals: {},
    uad: false,
  };

  const body = new URLSearchParams({
    message: JSON.stringify(message),
    "aura.context": JSON.stringify(context),
    "aura.pageURI": "/s/opportunities",
    "aura.token": "null",
  });

  try {
    const resp = await httpFetch(`${RAMP_AURA}?r=1&other.MainSearch.searchForIds=1`, {
      method: "POST",
      timeoutMs: 30_000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
        Referer: RAMP_PAGE,
        Origin: RAMP_BASE,
      },
      body: body.toString(),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        source: "ramp",
        ok: false,
        count: 0,
        opportunities: [],
        error: `RAMP Aura endpoint returned HTTP ${resp.status}: ${text.slice(0, 300)}`,
      };
    }
    const data = (await resp.json()) as AuraResponse;
    const action = data.actions?.[0];
    if (!action || action.state !== "SUCCESS") {
      const msg = action?.error?.map((e) => e.message).filter(Boolean).join("; ");
      return {
        source: "ramp",
        ok: false,
        count: 0,
        opportunities: [],
        error: `RAMP search action failed: ${msg || action?.state || "unknown error"}`,
      };
    }
    const rows = (action.returnValue ?? []).map(toOpportunity);
    return {
      source: "ramp",
      ok: true,
      count: rows.length,
      opportunities: rows,
      note: `Statuses [${status.join(", ")}]${params.keyword ? ` matching "${params.keyword}"` : ""}.`,
    };
  } catch (err) {
    return {
      source: "ramp",
      ok: false,
      count: 0,
      opportunities: [],
      error: `RAMP request failed: ${(err as Error).message}`,
    };
  }
}
