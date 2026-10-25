import { clean, matchesAny } from "../util.js";
import { ContractOpportunity, SearchResult } from "../types.js";

const EVENT_SEARCH_URL =
  "https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx";

export interface CalEProcureSearchParams {
  /** Case-insensitive keyword matched against event name / department. */
  keyword?: string;
  /** Max rows to return. Defaults to 50. */
  limit?: number;
  /** Per-request browser timeout in ms (the portal is slow). Default 60s. */
  timeoutMs?: number;
}

interface RawEvent {
  eventId: string;
  eventName: string;
  department: string;
  endDate: string;
  status: string;
}

function toOpportunity(e: RawEvent): ContractOpportunity {
  return {
    source: "caleprocure",
    id: e.eventId,
    title: clean(e.eventName) ?? "(untitled)",
    solicitationNumber: clean(e.eventId),
    agency: clean(e.department),
    status: clean(e.status),
    closeDate: clean(e.endDate),
    url: EVENT_SEARCH_URL,
    raw: e,
  };
}

/**
 * Search the California State Contracts Register (Cal eProcure) event list.
 *
 * The portal renders its event table client-side behind an InFlight/PeopleSoft
 * layer and blocks plain HTTP clients, so this uses a headless Chromium browser
 * (via Playwright) to render the page, then scrapes and filters the table.
 */
export async function searchCalEProcure(
  params: CalEProcureSearchParams,
): Promise<SearchResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
  const timeoutMs = params.timeoutMs ?? 60_000;

  // Import Playwright lazily so the rest of the server works without a browser.
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return {
      source: "caleprocure",
      ok: false,
      count: 0,
      opportunities: [],
      error:
        "Playwright is not installed. Run `npm install` then `npx playwright install chromium`.",
    };
  }

  let browser: import("playwright").Browser | undefined;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    });
    const page = await ctx.newPage();
    await page.goto(EVENT_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // The event table is injected client-side (InFlight/PeopleSoft) a few
    // seconds after load, so poll until a populated "Event ID" table appears.
    const deadline = Date.now() + timeoutMs;
    let rendered = false;
    while (Date.now() < deadline) {
      rendered = await page.evaluate(() =>
        Array.from(document.querySelectorAll("table")).some(
          (t) => /Event ID/i.test(t.innerText) && t.querySelectorAll("tr").length > 5,
        ),
      );
      if (rendered) break;
      await page.waitForTimeout(1500);
    }
    if (!rendered) {
      return {
        source: "caleprocure",
        ok: false,
        count: 0,
        opportunities: [],
        error: `Cal eProcure event table did not render within ${Math.round(timeoutMs / 1000)}s.`,
      };
    }

    const events: RawEvent[] = await page.evaluate(() => {
      const out: RawEvent[] = [];
      const seen = new Set<string>();
      // Scan every row in the document and keep genuine event rows. The portal
      // nests tables and pads rows with empty checkbox/spacer cells, so locate
      // the event-id cell rather than assuming fixed column positions.
      // A typical data row is:
      //   ["", "0000040552", "<name>", "<dept>", "", "10/26/202610:00AM PDT", "Posted"]
      const rows = Array.from(document.querySelectorAll("tr"));
      for (const row of rows) {
        const cells = Array.from(row.children)
          .filter((c) => c.tagName === "TD")
          .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim());
        if (cells.length < 4) continue;

        // Event ids look like "0000040552" or "08A4036" — alphanumeric, 5+ chars.
        const idIdx = cells.findIndex(
          (c) => /^[0-9A-Za-z]{5,}$/.test(c) && !/^event id$/i.test(c) && /[0-9]/.test(c),
        );
        if (idIdx === -1) continue;
        const eventId = cells[idIdx];
        const eventName = cells[idIdx + 1] ?? "";
        const department = cells[idIdx + 2] ?? "";
        if (!eventName || /^event name$/i.test(eventName)) continue;
        if (seen.has(eventId)) continue;

        // Date cell looks like "10/26/202610:00AM PDT"; split date from time.
        const dateCell = cells.slice(idIdx + 3).find((c) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(c)) ?? "";
        const endDate = dateCell.replace(/(\d{4})(\d)/, "$1 $2");
        const status = cells[cells.length - 1] ?? "";

        seen.add(eventId);
        out.push({ eventId, eventName, department, endDate, status });
      }
      return out;
    });

    const needles = params.keyword
      ? [params.keyword]
      : [];
    const filtered = needles.length
      ? events.filter((e) =>
          matchesAny(`${e.eventName} ${e.department} ${e.eventId}`, needles),
        )
      : events;

    const opportunities = filtered.slice(0, limit).map(toOpportunity);
    return {
      source: "caleprocure",
      ok: true,
      count: opportunities.length,
      opportunities,
      note:
        `Scraped ${events.length} currently-posted events` +
        (params.keyword ? ` and filtered for "${params.keyword}".` : "."),
    };
  } catch (err) {
    return {
      source: "caleprocure",
      ok: false,
      count: 0,
      opportunities: [],
      error: `Cal eProcure scrape failed: ${(err as Error).message}`,
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
