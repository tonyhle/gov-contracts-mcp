/**
 * Standalone smoke test that calls each source directly (bypassing the MCP
 * transport) so you can confirm live connectivity:  `npm run smoke`.
 */
import { searchSam } from "../src/sources/sam.js";
import { searchRamp } from "../src/sources/ramp.js";
import { searchLaCounty, getLaCountyDetail } from "../src/sources/lacounty.js";
import { searchCalEProcure } from "../src/sources/caleprocure.js";

const keyword = process.argv[2] ?? "software";

function summarize(label: string, r: { ok: boolean; count: number; error?: string; note?: string; opportunities: Array<{ title: string; agency?: string; closeDate?: string }> }) {
  console.log(`\n===== ${label} =====`);
  console.log(`ok=${r.ok} count=${r.count}${r.note ? ` | ${r.note}` : ""}`);
  if (r.error) console.log(`error: ${r.error}`);
  for (const o of r.opportunities.slice(0, 5)) {
    console.log(` - ${o.title}${o.agency ? ` [${o.agency}]` : ""}${o.closeDate ? ` (closes ${o.closeDate})` : ""}`);
  }
}

(async () => {
  const [ramp, lacounty, cal, sam] = await Promise.all([
    searchRamp({ keyword, limit: 10 }),
    searchLaCounty({ keyword, limit: 10 }),
    searchCalEProcure({ keyword, limit: 10 }),
    searchSam({ keyword, limit: 5 }),
  ]);
  summarize("RAMP (City of LA)", ramp);
  summarize("LA County", lacounty);
  summarize("Cal eProcure", cal);
  summarize("SAM.gov", sam);

  // Exercise LA County detail on the first result that has an internal id.
  const first = lacounty.opportunities.find((o) => /^\d+$/.test(o.id));
  if (first) {
    const detail = await getLaCountyDetail({ bidRefNbr: first.id });
    console.log(`\n===== LA County detail (${first.id}) =====`);
    console.log(`ok=${detail.ok} title="${detail.title}" closes=${detail.closeDate ?? "?"}`);
    if (detail.error) console.log(`error: ${detail.error}`);
  }
})();
