import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { httpFetch, clean } from "../util.js";
import { ContractOpportunity, SearchResult } from "../types.js";

const LACOUNTY_BASE = "https://camisvr.co.la.ca.us/LACoBids/BidLookUp";
const LIST_URL = `${LACOUNTY_BASE}/OpenBidList`;
const DETAIL_URL = `${LACOUNTY_BASE}/BidDetail`;

export interface LaCountySearchParams {
  /** Free-text search over title / description / commodity / number. */
  keyword?: string;
  /** Max rows to return. Defaults to 50. */
  limit?: number;
  /** Which results page to read (the portal paginates server-side). */
  page?: number;
}

/** Pull the internal bid reference id out of a `selectBid('...')` call. */
function bidRefFromRow($: cheerio.CheerioAPI, tr: Element): string | undefined {
  // The portal wires row clicks via selectBid('<id>') which may live on the
  // row, a cell, or a link — so scan the whole row's markup for it.
  const rowHtml = $.html(tr);
  return rowHtml.match(/selectBid\('(\d+)'\)/)?.[1];
}

/** The second cell concatenates title + commodity; split them apart. */
function splitTitleAndCommodity(raw: string): { title: string; commodity?: string } {
  // Cell text looks like: "<title> More <title> Commodity: <c> More Commodity: <c>"
  const cleaned = clean(raw) ?? "";
  const commodityMatch = cleaned.match(/Commodity:\s*(.+?)(?:\s+More\s+Commodity:.*)?$/i);
  const commodity = commodityMatch ? clean(commodityMatch[1]) : undefined;
  let title = cleaned.split(/\s*Commodity:/i)[0] ?? cleaned;
  // De-duplicate the "X More X" doubling the portal renders for tooltips.
  title = clean(title) ?? title;
  const half = title.slice(0, Math.floor(title.length / 2)).trim();
  if (half && title.toLowerCase() === (half + " " + half).toLowerCase()) {
    title = half;
  } else {
    const m = title.match(/^(.*?)\s+More\s+\1$/i);
    if (m) title = m[1];
  }
  return { title: clean(title) ?? "(untitled)", commodity };
}

export async function searchLaCounty(params: LaCountySearchParams): Promise<SearchResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const page = Math.max(params.page ?? 1, 1);
  const q = new URLSearchParams({
    DirectionSort: "Asc",
    FieldSort: "BidTitle",
    TextSearch: params.keyword ?? "",
    page: String(page),
  });

  try {
    const resp = await httpFetch(`${LIST_URL}?${q.toString()}`, { timeoutMs: 30_000 });
    if (!resp.ok) {
      return {
        source: "lacounty",
        ok: false,
        count: 0,
        opportunities: [],
        error: `LA County returned HTTP ${resp.status}.`,
      };
    }
    const html = await resp.text();
    const $ = cheerio.load(html);
    const opportunities: ContractOpportunity[] = [];

    $("table tr").each((_i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 5) return;
      const cells = tds.map((_j, td) => clean($(td).text()) ?? "").get();
      const solicitationNumber = cells[0];
      if (!solicitationNumber) return; // skip spacer / description rows
      const { title, commodity } = splitTitleAndCommodity($(tds[1]).text());
      const bidRef = bidRefFromRow($, tr);
      opportunities.push({
        source: "lacounty",
        id: bidRef ?? solicitationNumber,
        title,
        solicitationNumber,
        type: clean(cells[2]),
        agency: clean(cells[3]),
        closeDate: clean(cells[4]),
        commodity,
        status: "Open",
        url: bidRef
          ? `${DETAIL_URL}?bidrefnbr=${bidRef}`
          : `https://camisvr.co.la.ca.us/lacobids`,
        raw: { cells, bidRef },
      });
    });

    const limited = opportunities.slice(0, limit);
    return {
      source: "lacounty",
      ok: true,
      count: limited.length,
      opportunities: limited,
      note: `Open solicitations${params.keyword ? ` matching "${params.keyword}"` : ""} (page ${page}).`,
    };
  } catch (err) {
    return {
      source: "lacounty",
      ok: false,
      count: 0,
      opportunities: [],
      error: `LA County request failed: ${(err as Error).message}`,
    };
  }
}

export interface LaCountyDetailParams {
  /** Internal bid reference number (the `id` returned by the search tool). */
  bidRefNbr: string;
}

/** Fetch the full solicitation detail page for one LA County bid. */
export async function getLaCountyDetail(
  params: LaCountyDetailParams,
): Promise<ContractOpportunity & { ok: boolean; error?: string }> {
  const body = new URLSearchParams({
    bidrefnbr: params.bidRefNbr,
    pageNumberTemp: "1",
    txtSearchTemp: "",
    sortfieldTemp: "BidTitle",
    sortdirectionTemp: "Asc",
  });
  try {
    const resp = await httpFetch(DETAIL_URL, {
      method: "POST",
      timeoutMs: 30_000,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!resp.ok) {
      return {
        source: "lacounty",
        id: params.bidRefNbr,
        title: "(error)",
        ok: false,
        error: `LA County detail returned HTTP ${resp.status}.`,
      };
    }
    const html = await resp.text();
    const $ = cheerio.load(html);

    // The detail page is a set of label/value pairs. Collect them generically.
    const fields: Record<string, string> = {};
    $("tr").each((_i, tr) => {
      const tds = $(tr).find("td, th");
      for (let c = 0; c + 1 < tds.length; c += 2) {
        const label = clean($(tds[c]).text())?.replace(/:$/, "");
        const value = clean($(tds[c + 1]).text());
        if (label && value && /[A-Za-z]/.test(label)) fields[label] = value;
      }
    });

    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const hit = Object.keys(fields).find((f) => f.toLowerCase() === k.toLowerCase());
        if (hit) return fields[hit];
      }
      return undefined;
    };

    return {
      source: "lacounty",
      id: params.bidRefNbr,
      title: pick("Title") ?? "(untitled)",
      solicitationNumber: pick("Solicitation Number", "Bid Number"),
      description: pick("Description"),
      agency: pick("Department"),
      type: pick("Bid Type"),
      commodity: pick("Commodity"),
      postedDate: pick("Open Day", "Open Date"),
      closeDate: pick("Close Date"),
      status: "Open",
      url: `${DETAIL_URL}?bidrefnbr=${params.bidRefNbr}`,
      raw: fields,
      ok: true,
    };
  } catch (err) {
    return {
      source: "lacounty",
      id: params.bidRefNbr,
      title: "(error)",
      ok: false,
      error: `LA County detail request failed: ${(err as Error).message}`,
    };
  }
}
