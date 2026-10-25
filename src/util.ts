export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

export interface FetchOptions extends RequestInit {
  /** Abort the request after this many milliseconds (default 30s). */
  timeoutMs?: number;
}

/** `fetch` with a timeout and a browser-like User-Agent by default. */
export async function httpFetch(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 30_000, headers, ...rest } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "*/*",
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Collapse whitespace and trim a string, returning undefined when empty. */
export function clean(text: string | null | undefined): string | undefined {
  if (text == null) return undefined;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length ? t : undefined;
}

/** Case-insensitive "does haystack contain any of the needles" helper. */
export function matchesAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

/** Format a Date as MM/dd/yyyy (used by the SAM.gov API). */
export function formatUsDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}
