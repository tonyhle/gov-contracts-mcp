# gov-contracts-mcp

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that pulls
**government software/IT contract opportunities** — and their details — from four
procurement portals:

| Source | What it covers | How it's accessed | Key / browser |
| --- | --- | --- | --- |
| **SAM.gov** | U.S. federal contract opportunities | Official [Get Opportunities v2 API](https://open.gsa.gov/api/get-opportunities-public-api/) | Free `SAM_API_KEY` |
| **Cal eProcure** | California State Contracts Register | Headless-browser scrape of the event list | Chromium (Playwright) |
| **LA RAMP** | City of Los Angeles ([rampla.org](https://www.rampla.org/s/)) | Public Salesforce "guest" search API | none |
| **LA County** | County of Los Angeles ([Doing Business With](https://doingbusiness.lacounty.gov/)) | Public solicitation list + detail pages | none |

All four were verified to currently list **software/IT solicitations** (e.g. email-security
software, case-management SaaS, software maintenance renewals, document-governance platforms).

> This server only reads **public** opportunity data. It never logs in, submits bids, or
> accesses private vendor-account data.

## Tools

- **`search_all_software_contracts`** — one keyword (default `software`) across all four
  portals, returned as a combined, normalized list. Set `includeCalEProcure=false` to skip
  the slower headless-browser source.
- **`sam_search_opportunities`** — SAM.gov federal search. Defaults to software/IT NAICS
  codes (`511210`, `513210`, `541511`, `541512`, `541519`, `518210`). Filters: `keyword`,
  `naics`, `ptype`, `state`, `postedFrom`, `postedTo`, `limit`.
- **`caleprocure_search_events`** — Cal eProcure currently-posted events. Filters: `keyword`,
  `limit`.
- **`ramp_search_opportunities`** — City of LA (RAMP) opportunities. Filters: `keyword`,
  `status` (default `["Open","Amended"]`), `category`, `naics`, `limit`.
- **`lacounty_search_solicitations`** — LA County open solicitations. Filters: `keyword`,
  `limit`, `page`. Returns an internal bid reference id.
- **`lacounty_get_solicitation`** — full detail for one LA County solicitation, by the
  `bidRefNbr` (the `id` from the search tool).

Every tool returns both a human-readable text summary and `structuredContent` with a
normalized shape (`source`, `id`, `title`, `solicitationNumber`, `description`, `agency`,
`status`, `type`, `postedDate`, `closeDate`, `naics`, `commodity`, `url`, `raw`).

## Install & build

```bash
npm install            # also runs `playwright install chromium`
npm run build
```

### SAM.gov API key (optional but recommended)

SAM.gov requires a free API key. Without it, the three other sources still work and the
SAM tool returns a clear "missing key" message.

1. Sign in at <https://sam.gov> → **Account Details** → **API Key**.
2. Copy `.env.example` to `.env` and set `SAM_API_KEY=...`, or export it in your shell /
   MCP client config.

## Run

It speaks MCP over **stdio**:

```bash
node dist/index.js
# or, during development:
npm run dev
```

### Use it from an MCP client

Example client config (Cursor / Claude Desktop style `mcpServers` entry):

```json
{
  "mcpServers": {
    "gov-contracts": {
      "command": "node",
      "args": ["/absolute/path/to/gov-contracts-mcp/dist/index.js"],
      "env": { "SAM_API_KEY": "your-sam-key" }
    }
  }
}
```

Then ask your assistant things like:

- "Find open **software** contracts across SAM.gov, Cal eProcure, RAMP and LA County."
- "Show LA County software solicitations closing this month."
- "Get the full details for LA County bid `26102015237766`."

## Smoke test

Hit every live source directly (no MCP client needed):

```bash
npm run smoke            # keyword defaults to "software"
npm run smoke -- saas    # any keyword
```

## Notes & limitations

- **SAM.gov** enforces a date window ≤ 1 year and per-NAICS queries; the tool queries each
  software NAICS code and merges/dedupes results. Rate limits apply to the free key.
- **Cal eProcure** renders its event table client-side behind an InFlight/PeopleSoft layer
  and blocks plain HTTP clients, so it is scraped with headless Chromium. Keyword filtering
  is applied to the event name / department / id shown in the public list; some software
  buys are categorized by commodity that isn't shown in that list.
- **LA RAMP** uses the City's public Salesforce guest endpoint; the framework id is read
  fresh on each call, so it self-heals across Salesforce releases but could break if the
  portal changes its controller.
- **LA County** list/detail pages are parsed from server-rendered HTML; selectors may need
  updating if the portal is redesigned.
- These portals are public but unofficial for scraping; be courteous with request volume.

## Project layout

```
src/
  index.ts              # MCP server + tool registration
  types.ts              # normalized ContractOpportunity shape + software NAICS
  util.ts               # fetch/timeout/text helpers
  sources/
    sam.ts              # SAM.gov official API
    caleprocure.ts      # Cal eProcure (Playwright scrape)
    ramp.ts             # LA RAMP (Salesforce guest API)
    lacounty.ts         # LA County (list + detail HTML)
scripts/
  smoke.ts              # direct live connectivity check
```

## License

MIT
