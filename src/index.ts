#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchSam } from "./sources/sam.js";
import { searchRamp } from "./sources/ramp.js";
import { searchLaCounty, getLaCountyDetail } from "./sources/lacounty.js";
import { searchCalEProcure } from "./sources/caleprocure.js";
import {
  ContractOpportunity,
  SearchResult,
  DEFAULT_SOFTWARE_KEYWORD,
} from "./types.js";

function renderOpportunity(o: ContractOpportunity, idx: number): string {
  const lines = [
    `${idx + 1}. [${o.source}] ${o.title}`,
    o.solicitationNumber ? `   No.: ${o.solicitationNumber}` : undefined,
    o.agency ? `   Agency: ${o.agency}` : undefined,
    o.status ? `   Status: ${o.status}` : undefined,
    o.type ? `   Type: ${o.type}` : undefined,
    o.commodity ? `   Commodity: ${o.commodity}` : undefined,
    o.naics ? `   NAICS: ${o.naics}` : undefined,
    o.postedDate ? `   Posted: ${o.postedDate}` : undefined,
    o.closeDate ? `   Closes: ${o.closeDate}` : undefined,
    o.description ? `   ${truncate(o.description, 280)}` : undefined,
    o.url ? `   ${o.url}` : undefined,
  ].filter(Boolean);
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function renderResult(r: SearchResult): string {
  const header = `=== ${r.source} — ${r.ok ? `${r.count} result(s)` : "error"} ===`;
  if (!r.ok) return `${header}\n${r.error ?? "unknown error"}`;
  const note = r.note ? `\n(${r.note})` : "";
  if (r.count === 0) return `${header}${note}\nNo matching opportunities.`;
  return `${header}${note}\n\n${r.opportunities.map(renderOpportunity).join("\n\n")}`;
}

function toolResult(payload: unknown, text: string) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: payload as Record<string, unknown>,
  };
}

const server = new McpServer({
  name: "gov-contracts-mcp",
  version: "0.1.0",
});

server.registerTool(
  "sam_search_opportunities",
  {
    title: "Search SAM.gov federal opportunities",
    description:
      "Search federal government contract opportunities on SAM.gov (the official " +
      "U.S. System for Award Management) via the Get Opportunities v2 API. Defaults " +
      "to software/IT NAICS codes. Requires a free SAM_API_KEY. Good for finding " +
      "federal software solicitations, combined synopsis/solicitations and award notices.",
    inputSchema: {
      keyword: z.string().optional().describe('Title keyword, e.g. "software" or "SaaS".'),
      naics: z
        .array(z.string())
        .optional()
        .describe("NAICS code(s). Defaults to software/IT NAICS when omitted."),
      ptype: z
        .string()
        .optional()
        .describe("Procurement type: o=Solicitation, k=Combined, p=Presol, a=Award, r=Sources Sought."),
      state: z.string().optional().describe('Place-of-performance state, e.g. "CA".'),
      postedFrom: z.string().optional().describe("Posted-from date MM/dd/yyyy (defaults to 1 year ago)."),
      postedTo: z.string().optional().describe("Posted-to date MM/dd/yyyy (defaults to today)."),
      limit: z.number().int().min(1).max(1000).optional().describe("Max rows (default 25)."),
    },
  },
  async (args) => {
    const r = await searchSam(args);
    return toolResult(r, renderResult(r));
  },
);

server.registerTool(
  "caleprocure_search_events",
  {
    title: "Search Cal eProcure (California State Contracts Register)",
    description:
      "Search currently-posted bid events on Cal eProcure, the California statewide " +
      "procurement portal. Renders the portal with a headless browser and filters by " +
      "keyword (defaults to no filter = all open events). Use keyword 'software' for " +
      "software/IT opportunities. Requires Playwright chromium to be installed.",
    inputSchema: {
      keyword: z
        .string()
        .optional()
        .describe('Case-insensitive match on event name/department, e.g. "software".'),
      limit: z.number().int().min(1).max(500).optional().describe("Max rows (default 50)."),
    },
  },
  async (args) => {
    const r = await searchCalEProcure(args);
    return toolResult(r, renderResult(r));
  },
);

server.registerTool(
  "ramp_search_opportunities",
  {
    title: "Search LA RAMP (City of Los Angeles) opportunities",
    description:
      "Search City of Los Angeles contracting opportunities on RAMP (rampla.org, the " +
      "Regional Alliance Marketplace for Procurement). Uses the public guest API — no " +
      "login required. Use keyword 'software' for software/IT opportunities.",
    inputSchema: {
      keyword: z.string().optional().describe('Free-text search, e.g. "software".'),
      status: z
        .array(z.string())
        .optional()
        .describe('Status filter. Defaults to ["Open","Amended"].'),
      category: z
        .array(z.string())
        .optional()
        .describe('Category filter, e.g. ["Commodity","Personal Services"].'),
      naics: z.array(z.string()).optional().describe("NAICS code filter."),
      limit: z.number().int().min(1).max(250).optional().describe("Max rows (default 50)."),
    },
  },
  async (args) => {
    const r = await searchRamp(args);
    return toolResult(r, renderResult(r));
  },
);

server.registerTool(
  "lacounty_search_solicitations",
  {
    title: "Search LA County (Doing Business With) solicitations",
    description:
      "Search open solicitations from the County of Los Angeles (camisvr.co.la.ca.us / " +
      "doingbusiness.lacounty.gov). Use keyword 'software' for software/IT opportunities. " +
      "Returns an internal bid reference id usable with lacounty_get_solicitation.",
    inputSchema: {
      keyword: z.string().optional().describe('Free-text search, e.g. "software".'),
      limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
      page: z.number().int().min(1).optional().describe("Results page (default 1)."),
    },
  },
  async (args) => {
    const r = await searchLaCounty(args);
    return toolResult(r, renderResult(r));
  },
);

server.registerTool(
  "lacounty_get_solicitation",
  {
    title: "Get LA County solicitation detail",
    description:
      "Fetch the full detail page for one LA County solicitation using the internal bid " +
      "reference id (the `id` field returned by lacounty_search_solicitations).",
    inputSchema: {
      bidRefNbr: z.string().describe("Internal bid reference number from the search results."),
    },
  },
  async (args) => {
    const r = await getLaCountyDetail(args);
    const text = r.ok
      ? renderOpportunity(r, 0)
      : `=== lacounty — error ===\n${r.error ?? "unknown error"}`;
    return toolResult(r, text);
  },
);

server.registerTool(
  "search_all_software_contracts",
  {
    title: "Search software contracts across all four portals",
    description:
      "Run one keyword across SAM.gov, Cal eProcure, LA RAMP and LA County and return a " +
      "combined, normalized list of software/IT opportunities. Defaults keyword to " +
      "'software'. Set includeCalEProcure=false to skip the (slower) headless-browser source.",
    inputSchema: {
      keyword: z.string().optional().describe("Keyword for every source (default 'software')."),
      limitPerSource: z.number().int().min(1).max(200).optional().describe("Max rows per source (default 25)."),
      includeCalEProcure: z
        .boolean()
        .optional()
        .describe("Include Cal eProcure (needs a headless browser). Default true."),
    },
  },
  async (args) => {
    const keyword = args.keyword ?? DEFAULT_SOFTWARE_KEYWORD;
    const limit = args.limitPerSource ?? 25;
    const includeCal = args.includeCalEProcure ?? true;

    const tasks: Promise<SearchResult>[] = [
      searchSam({ keyword, limit }),
      searchRamp({ keyword, limit }),
      searchLaCounty({ keyword, limit }),
    ];
    if (includeCal) tasks.push(searchCalEProcure({ keyword, limit }));

    const results = await Promise.all(tasks);
    const all = results.flatMap((r) => r.opportunities);
    const text =
      `# Software contracts matching "${keyword}" across 4 portals\n` +
      `Total: ${all.length} opportunit${all.length === 1 ? "y" : "ies"}\n\n` +
      results.map(renderResult).join("\n\n");
    return toolResult(
      {
        keyword,
        total: all.length,
        bySource: Object.fromEntries(results.map((r) => [r.source, r])),
      },
      text,
    );
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Never write to stdout (reserved for the JSON-RPC stream).
  console.error("gov-contracts-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting gov-contracts-mcp:", err);
  process.exit(1);
});
