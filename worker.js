// LechPlay Worker - dual login + episode/player extraction + proxy fallback

const SERIES_BASE = "https://tv.sosac.tv";
const SERIES_HOME = "https://tv.sosac.tv/cs/";
const MOVIES_BASE = "https://movies.sosac.tv";
const MOVIES_HOME = "https://movies.sosac.tv/cs/";

const SERIES_USERNAME = "Stenli78";
const SERIES_PASSWORD = "Tinusha29";
const MOVIES_USERNAME = "Stenli78";
const MOVIES_PASSWORD = "Tinusha29";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") return cors(json({ ok: true }));

      if (url.pathname === "/") {
        return cors(json({
          ok: true,
          name: "LechPlay API",
          endpoints: [
            "/api/list?type=movies",
            "/api/list?type=series",
            "/api/search?section=movies&q=test",
            "/api/search?section=series&q=test",
            "/api/play?url=...",
            "/api/episodes?url=..."
          ]
        }));
      }

      if (url.pathname === "/api/list") {
        return cors(json(await list(url.searchParams.get("type") || "movies")));
      }

      if (url.pathname === "/api/search") {
        return cors(json(await search(
          url.searchParams.get("q") || "",
          url.searchParams.get("section") || "movies"
        )));
      }

      if (url.pathname === "/api/detail") {
        return cors(json(await detail(required(url, "url"))));
      }

      if (url.pathname === "/api/episodes") {
        return cors(json(await episodes(required(url, "url"))));
      }

      if (url.pathname === "/api/play") {
        return cors(json(await play(required(url, "url"))));
      }

      if (url.pathname === "/proxy") {
        return await proxy(required(url, "url"), request);
      }

      return cors(json({ error: true, message: "Not found" }, 404));

    } catch (e) {
      return cors(json({
        error: true,
        message: e?.message || String(e),
        stack: e?.stack ? String(e.stack).slice(0, 900) : ""
      }, 500));
    }
  }
};

function required(url, key) {
  const v = url.searchParams.get(key);
  if (!v) throw new Error("Missing " + key);
  return v;
}

function getSource(type) {
  if (type === "series") {
    return { type:"series", base:SERIES_BASE, home:SERIES_HOME, username:SERIES_USERNAME, password:SERIES_PASSWORD };
  }
  return { type:"movies", base:MOVIES_BASE, home:MOVIES_HOME, username:MOVIES_USERNAME, password:MOVIES_PASSWORD };
}

function sourceFromUrl(u) {
  return String(u).includes("movies.sosac.tv") ? getSource("movies") : getSource("series");
}

async function login(source) {
  let cookie = "";

  const homeRes = await fetch(source.home, {
    headers: headers("", source.home),
    redirect: "manual"
  });
  cookie = mergeCookies(cookie, homeRes.headers.get("set-cookie") || "");

  const body = new URLSearchParams();
  body.set("username", source.username);
  body.set("password", source.password);
  body.set("remember", "0");

  const loginRes = await fetch(source.base + "/cs/ajax/user-login", {
    method: "POST",
    headers: {
      ...headers(cookie, source.home),
      "accept": "*/*",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "origin": source.base,
      "referer": source.home,
      "x-requested-with": "XMLHttpRequest"
    },
    body: body.toString(),
    redirect: "manual"
  });
  cookie = mergeCookies(cookie, loginRes.headers.get("set-cookie") || "");

  try {
    const panel = await fetch(source.base + "/cs/ajax/get-logged-in-panel-only", {
      headers: {
        ...headers(cookie, source.home),
        "accept": "*/*",
        "x-requested-with": "XMLHttpRequest"
      },
      redirect: "manual"
    });
    cookie = mergeCookies(cookie, panel.headers.get("set-cookie") || "");
  } catch {}

  return cookie;
}

async function list(type) {
  const source = getSource(type);
  const cookie = await login(source);
  const html = await fetchText(source.home, cookie, source.home);

  return {
    type: source.type,
    source: source.home,
    items: parseItems(html, source.home, source.type)
  };
}

async function search(q, section) {
  if (!String(q).trim()) return list(section);

  const source = getSource(section);
  const cookie = await login(source);
  const page = source.base + "/cs/search?q=" + encodeURIComponent(q);
  const html = await fetchText(page, cookie, source.home);

  return {
    q,
    section: source.type,
    source: page,
    items: parseItems(html, page, source.type)
  };
}

async function detail(pageUrl) {
  const safe = normalizeUrl(pageUrl);
  const source = sourceFromUrl(safe);
  const cookie = await login(source);
  const html = await fetchText(safe, cookie, source.home);

  return {
    ...detailFromHtml(html, safe),
    episodes: parseEpisodes(html, safe)
  };
}

async function episodes(pageUrl) {
  const safe = normalizeUrl(pageUrl);
  const source = sourceFromUrl(safe);
  const cookie = await login(source);
  const html = await fetchText(safe, cookie, source.home);

  return {
    url: safe,
    episodes: parseEpisodes(html, safe)
  };
}

async function play(pageUrl) {
  const safe = normalizeUrl(pageUrl);
  const source = sourceFromUrl(safe);
  const cookie = await login(source);
  const html = await fetchText(safe, cookie, source.home);
  const info = detailFromHtml(html, safe);

  const direct = extractPlayer(html, safe);
  if (direct.videoUrl || direct.embedUrl) return { ...info, ...direct };

  const candidates = [
    ...parseEpisodes(html, safe).map(x => x.url),
    ...parseWatchLinks(html, safe)
  ].filter(Boolean);

  for (const candidate of unique(candidates).slice(0, 12)) {
    try {
      const h = await fetchText(candidate, cookie, safe);
      const p = extractPlayer(h, candidate);
      if (p.videoUrl || p.embedUrl) return { ...info, ...p, sourceUrl: candidate };
    } catch {}
  }

  return {
    ...info,
    proxyUrl: "/proxy?url=" + encodeURIComponent(safe)
  };
}

async function proxy(target, request) {
  const safe = normalizeUrl(target);
  const source = sourceFromUrl(safe);
  const cookie = await login(source);

  const method = request.method;
  const h = headers(cookie, safe);

  let body;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.text();
    h["content-type"] = request.headers.get("content-type") || "application/x-www-form-urlencoded; charset=UTF-8";
    h["x-requested-with"] = "XMLHttpRequest";
  }

  const upstream = await fetch(safe, {
    method,
    headers: h,
    body,
    redirect: "follow"
  });

  const ct = upstream.headers.get("content-type") || "";

  if (!ct.includes("text/html")) {
    const respHeaders = new Headers(upstream.headers);
    respHeaders.set("access-control-allow-origin", "*");
    respHeaders.delete("content-security-policy");
    respHeaders.delete("x-frame-options");
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  }

  let html = await upstream.text();
  html = rewriteHtml(html, safe);

  return new Response(html, {
    status: upstream.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

async function fetchText(url, cookie, referer) {
  const res = await fetch(url, {
    headers: headers(cookie, referer || url),
    redirect: "follow"
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error("Fetch failed " + res.status + " for " + url + " " + txt.slice(0, 120));
  }

  return await res.text();
}

function headers(cookie, referer) {
  const h = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "sk-SK,sk;q=0.9,cs;q=0.8,en-US;q=0.7,en;q=0.6",
    "cache-control": "no-cache",
    "pragma": "no-cache"
  };
  if (referer) h["referer"] = referer;
  if (cookie) h["cookie"] = cookie;
  return h;
}

function parseItems(html, baseUrl, section) {
  const items = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html || ""))) {
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

    if (!title || title === "Titulky" || title === "close") continue;

    items.push({ title, url, image, section });
  }

  return uniqueByUrl(items).slice(0, 160);
}

function parseEpisodes(html, baseUrl) {
  const episodes = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html || ""))) {
    const url = absolute(m[1], baseUrl);
    const raw = m[2] || "";
    const title = clean(raw);

    const looksEpisode =
      /episode|epizod|epizóda|s\d+\s*\/\s*e\d+|s\d+e\d+|e\d+/i.test(title + " " + url) ||
      /\/cs\/detail\/.+\/.+/.test(url);

    if (url && isAllowedHost(url) && url.includes("/cs/detail/") && looksEpisode && title) {
      episodes.push({ title, url });
    }
  }

  return uniqueByUrl(episodes).slice(0, 200);
}

function parseWatchLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html || ""))) {
    const url = absolute(m[1], baseUrl);
    const text = clean(m[2] || "");
    if (
      url &&
      isAllowedHost(url) &&
      /sledovat|sledovať|shlédnout|prehrat|prehrát|play|watch|online|episode|epizod/i.test(text + " " + url)
    ) {
      out.push(url);
    }
  }

  return unique(out);
}

function detailFromHtml(html, url) {
  return {
    title: first(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || first(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description:
      first(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) ||
      first(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i),
    url
  };
}

function extractPlayer(html, baseUrl) {
  const video =
    firstUrl(html, baseUrl, /<video[^>]+src=["']([^"']+)["']/i) ||
    firstUrl(html, baseUrl, /<source[^>]+src=["']([^"']+)["']/i) ||
    firstUrl(html, baseUrl, /file\s*:\s*["']([^"']+)["']/i) ||
    firstUrl(html, baseUrl, /["']file["']\s*:\s*["']([^"']+)["']/i) ||
    firstUrl(html, baseUrl, /src\s*:\s*["']([^"']+\.(?:mp4|m3u8)(?:\?[^"']*)?)["']/i) ||
    firstUrl(html, baseUrl, /["']([^"']+\.(?:mp4|m3u8)(?:\?[^"']*)?)["']/i);

  if (video) return { videoUrl: video };

  const iframe =
    firstUrl(html, baseUrl, /<iframe[^>]+src=["']([^"']+)["']/i) ||
    firstUrl(html, baseUrl, /data-src=["']([^"']+)["'][^>]*iframe/i);

  if (iframe) return { embedUrl: iframe };

  return {};
}

function rewriteHtml(html, pageUrl) {
  const prox = (u) => {
    try {
      const abs = new URL(u, pageUrl).href;
      return "/proxy?url=" + encodeURIComponent(abs);
    } catch {
      return u;
    }
  };

  let body = html.replace(/(href|src)=["']([^"']+)["']/gi, (m, attr, u) => {
    if (u.startsWith("data:") || u.startsWith("javascript:") || u.startsWith("#")) return m;
    return attr + '="' + prox(u) + '"';
  });

  const shim = `
<script>
(function(){
  function p(u){ try { return '/proxy?url=' + encodeURIComponent(new URL(u, location.href).href); } catch(e){ return u; } }
  var of = window.fetch;
  if (of) window.fetch = function(u,o){ return of(p(u), o); };
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m,u){ return oo.call(this,m,p(u)); };
})();
</script>`;

  body = body.replace(/<head([^>]*)>/i, '<head$1>' + shim);
  return body;
}

function normalizeUrl(u) {
  const base = String(u).includes("movies.sosac.tv") ? MOVIES_HOME : SERIES_HOME;
  const url = absolute(u, base);
  if (!url || !isAllowedHost(url)) throw new Error("Nepovolená URL: " + u);
  return url;
}

function first(s, re) {
  const m = re.exec(s || "");
  return m ? clean(m[1]) : "";
}

function attr(s, re) {
  const m = re.exec(s || "");
  return m ? clean(m[1]) : "";
}

function firstUrl(s, base, re) {
  const m = re.exec(s || "");
  return m ? absolute(clean(m[1]), base) : "";
}

function clean(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absolute(u, base) {
  try { return new URL(u, base).href; } catch { return ""; }
}

function isAllowedHost(u) {
  try {
    const h = new URL(u).hostname;
    return h === "tv.sosac.tv" || h === "movies.sosac.tv" || h.endsWith(".sosac.tv");
  } catch {
    return false;
  }
}

function mergeCookies(oldCookie, setCookie) {
  const map = new Map();

  String(oldCookie || "")
    .split(";")
    .map(x => x.trim())
    .filter(Boolean)
    .forEach(p => {
      const i = p.indexOf("=");
      if (i > 0) map.set(p.slice(0, i), p.slice(i + 1));
    });

  String(setCookie || "")
    .split(/,(?=[^;,]+=)/)
    .forEach(c => {
      const firstCookie = c.split(";")[0].trim();
      const i = firstCookie.indexOf("=");
      if (i > 0) map.set(firstCookie.slice(0, i), firstCookie.slice(i + 1));
    });

  return Array.from(map.entries()).map(([k, v]) => k + "=" + v).join("; ");
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

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
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
