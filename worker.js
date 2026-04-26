const SERIES_BASE = "https://tv.sosac.tv";
const SERIES_HOME = "https://tv.sosac.tv/cs/";
const MOVIES_BASE = "https://movies.sosac.tv";
const MOVIES_HOME = "https://movies.sosac.tv/cs/";

export default {
  async fetch(request) {
    try {
      const userEmail = request.headers.get("x-sosac-email") || "";
      const userPassword = request.headers.get("x-sosac-password") || "";
      const url = new URL(request.url);

      if (request.method === "OPTIONS") return cors(json({ ok: true }));

      if (url.pathname === "/") {
        return cors(json({
          ok: true,
          name: "LechPlay API",
          sections: {
            movies: MOVIES_HOME,
            series: SERIES_HOME
          }
        }));
      }

      if (url.pathname === "/api/list") {
        const type = url.searchParams.get("type") || "movies";
        return cors(json(await list(type, userEmail, userPassword)));
      }

      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") || "";
        const section = url.searchParams.get("section") || "all";
        return cors(json(await search(q, section, userEmail, userPassword)));
      }

      if (url.pathname === "/api/detail") {
        const pageUrl = url.searchParams.get("url");
        if (!pageUrl) return cors(json({ error: "Missing url" }, 400));
        return cors(json(await detail(pageUrl, userEmail, userPassword)));
      }

      return cors(json({ error: "Not found" }, 404));
    } catch (e) {
      return cors(json({ error: true, message: e.message }, 500));
    }
  }
};

function getSource(type) {
  if (type === "series") return { base: SERIES_BASE, home: SERIES_HOME, name: "series" };
  return { base: MOVIES_BASE, home: MOVIES_HOME, name: "movies" };
}

async function list(type, userEmail = '', userPassword = '') {
  const source = getSource(type);
  const html = await fetchHtml(source.home, userEmail, userPassword);
  return { type: source.name, source: source.home, items: parseItems(html, source.home) };
}

async function search(q, section = "all", userEmail = '', userPassword = '') {
  if (!q.trim()) return { q, items: [] };

  const sources = section === "movies"
    ? [getSource("movies")]
    : section === "series"
      ? [getSource("series")]
      : [getSource("movies"), getSource("series")];

  let all = [];
  for (const source of sources) {
    const page = source.base + "/cs/search?q=" + encodeURIComponent(q);
    const html = await fetchHtml(page, userEmail, userPassword);
    all = all.concat(parseItems(html, page).map(x => ({ ...x, section: source.name })));
  }

  return {
    q,
    section,
    items: uniqueByUrl(all)
  };
}

async function detail(pageUrl, userEmail = '', userPassword = '') {
  const safeUrl = safeAbsolute(pageUrl);
  if (!safeUrl || !isAllowedHost(safeUrl)) throw new Error("URL nie je povolená.");

  const html = await fetchHtml(safeUrl, userEmail, userPassword);
  const title = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const description =
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) ||
    firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i);

  const playUrl =
    firstHref(html, safeUrl, /href=["']([^"']+)["'][^>]*>\s*(?:Přehrát|Prehrať|Play|Spustiť|Sledovat|Sledovať)/i) ||
    "";

  return {
    title,
    description,
    playUrl,
    url: safeUrl
  };
}

async function fetchHtml(url, userEmail = "", userPassword = "") {
  const headers = {
    "user-agent": "Mozilla/5.0 LechPlay",
    "accept": "text/html,application/xhtml+xml"
  };

  if (userEmail && userPassword && !userEmail.includes("SEM_DAJ")) {
    headers["authorization"] = "Basic " + btoa(userEmail + ":" + userPassword);
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("Fetch failed: " + res.status);
  return await res.text();
}

function parseItems(html, baseUrl) {
  const items = [];
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = linkRe.exec(html))) {
    const url = absolute(m[1], baseUrl);
    if (!url || !isAllowedHost(url) || !url.includes("/cs/detail/")) continue;

    const raw = m[2] || "";
    const title =
      attr(raw, /alt=["']([^"']+)["']/i) ||
      attr(raw, /title=["']([^"']+)["']/i) ||
      clean(raw);

    const image =
      firstUrl(raw, baseUrl, /<img[^>]+src=["']([^"']+)["']/i) ||
      firstUrl(raw, baseUrl, /data-src=["']([^"']+)["']/i);

    const item = {
      title: title || "Bez názvu",
      url,
      image
    };

    if (item.title && !["Titulky", "close", ""].includes(item.title)) items.push(item);
  }

  return uniqueByUrl(items).slice(0, 120);
}

function firstMatch(s, re) {
  const m = re.exec(s || "");
  return m ? clean(decodeHtml(m[1])) : "";
}

function firstHref(html, base, re) {
  const m = re.exec(html || "");
  return m ? absolute(m[1], base) : "";
}

function firstUrl(html, base, re) {
  const m = re.exec(html || "");
  return m ? absolute(m[1], base) : "";
}

function attr(s, re) {
  const m = re.exec(s || "");
  return m ? clean(decodeHtml(m[1])) : "";
}

function clean(s) {
  return decodeHtml(String(s || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absolute(u, base) {
  try { return new URL(u, base).href; } catch { return ""; }
}

function safeAbsolute(u) {
  try { return new URL(u).href; } catch { return ""; }
}

function isAllowedHost(u) {
  try {
    const h = new URL(u).hostname;
    return h === "tv.sosac.tv" || h === "movies.sosac.tv";
  } catch {
    return false;
  }
}

function uniqueByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function cors(resp) {
  const h = new Headers(resp.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "GET,POST,OPTIONS");
  h.set("access-control-allow-headers", "content-type,accept");
  return new Response(resp.body, { status: resp.status, headers: h });
}
