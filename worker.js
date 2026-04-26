const SERIES_BASE = "https://tv.sosac.tv";
const SERIES_HOME = "https://tv.sosac.tv/cs/";

const MOVIES_BASE = "https://movies.sosac.tv";
const MOVIES_HOME = "https://movies.sosac.tv/cs/";

// ===== PRIHLASOVACIE ÚDAJE SÚ IBA VO WORKERI =====
const SOSAC_USERNAME = "Stenli78";
const SOSAC_PASSWORD = "Tinusha29";

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") return cors(json({ ok: true }));

      if (url.pathname === "/") {
        return cors(json({
          ok: true,
          name: "LechPlay API",
          login: "/cs/ajax/user-login",
          sources: { movies: MOVIES_HOME, series: SERIES_HOME }
        }));
      }

      if (url.pathname === "/api/login-test") {
        const section = url.searchParams.get("section") || "series";
        return cors(json(await loginTest(section)));
      }

      if (url.pathname === "/api/list") {
        const type = url.searchParams.get("type") || "movies";
        return cors(json(await list(type)));
      }

      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") || "";
        const section = url.searchParams.get("section") || "movies";
        return cors(json(await search(q, section)));
      }

      if (url.pathname === "/api/play") {
        const pageUrl = url.searchParams.get("url");
        if (!pageUrl) return cors(json({ error: "Missing url" }, 400));
        return cors(json(await play(pageUrl)));
      }

      if (url.pathname === "/api/detail") {
        const pageUrl = url.searchParams.get("url");
        if (!pageUrl) return cors(json({ error: "Missing url" }, 400));
        return cors(json(await detail(pageUrl)));
      }

      if (url.pathname === "/proxy") {
        const target = url.searchParams.get("url");
        if (!target) return new Response("Missing url", { status: 400 });
        return await proxyPage(target);
      }

      return cors(json({ error: "Not found" }, 404));
    } catch (e) {
      return cors(json({ error: true, message: e.message, stack: e.stack }, 500));
    }
  }
};

function getSource(type) {
  if (type === "series") return { type: "series", base: SERIES_BASE, home: SERIES_HOME };
  return { type: "movies", base: MOVIES_BASE, home: MOVIES_HOME };
}

async function loginTest(section = "series") {
  const source = getSource(section);
  const cookie = await login(source);
  const html = await fetchHtml(source.home, cookie);
  const loggedIn = /Odhlásit|Odhlásiť|Profil|Vítejte|Vitajte|Stenli78/i.test(html);
  return { ok: true, section: source.type, hasCookie: !!cookie, loggedIn };
}

async function list(type) {
  const source = getSource(type);
  const cookie = await login(source);
  const html = await fetchHtml(source.home, cookie);
  return { type: source.type, source: source.home, items: parseItems(html, source.home, source.type) };
}

async function search(q, section) {
  if (!q.trim()) return { q, section, items: [] };
  const source = getSource(section);
  const cookie = await login(source);
  const page = source.base + "/cs/search?q=" + encodeURIComponent(q);
  const html = await fetchHtml(page, cookie);
  return { q, section: source.type, source: page, items: parseItems(html, page, source.type) };
}

async function detail(pageUrl) {
  const safeUrl = absolute(pageUrl, pageUrl.includes("movies.sosac.tv") ? MOVIES_HOME : SERIES_HOME);
  if (!safeUrl || !isAllowedHost(safeUrl)) throw new Error("Nepovolená URL.");
  const source = safeUrl.includes("movies.sosac.tv") ? getSource("movies") : getSource("series");
  const cookie = await login(source);
  const html = await fetchHtml(safeUrl, cookie);
  return detailFromHtml(html, safeUrl);
}

async function play(pageUrl) {
  const safeUrl = absolute(pageUrl, pageUrl.includes("movies.sosac.tv") ? MOVIES_HOME : SERIES_HOME);
  if (!safeUrl || !isAllowedHost(safeUrl)) throw new Error("Nepovolená URL.");

  const source = safeUrl.includes("movies.sosac.tv") ? getSource("movies") : getSource("series");
  const cookie = await login(source);
  const html = await fetchHtml(safeUrl, cookie);

  const detail = detailFromHtml(html, safeUrl);
  const iframe = findIframe(html, safeUrl);
  const video = findVideo(html, safeUrl);
  const playLink = findPlayLink(html, safeUrl);

  if (video) return { ...detail, videoUrl: video };
  if (iframe) return { ...detail, embedUrl: iframe };

  if (playLink) {
    const playHtml = await fetchHtml(playLink, cookie);
    const iframe2 = findIframe(playHtml, playLink);
    const video2 = findVideo(playHtml, playLink);
    if (video2) return { ...detail, videoUrl: video2 };
    if (iframe2) return { ...detail, embedUrl: iframe2 };
    return { ...detail, proxyUrl: "/proxy?url=" + encodeURIComponent(playLink) };
  }

  return { ...detail, proxyUrl: "/proxy?url=" + encodeURIComponent(safeUrl) };
}

async function login(source) {
  let cookie = "";

  // najprv otvor domov, aby server dal základné cookies
  const home = await fetch(source.home, { headers: baseHeaders(), redirect: "manual" });
  cookie = mergeCookies(cookie, home.headers.get("set-cookie") || "");

  // presný login podľa tvojho Network Payloadu:
  // POST /cs/ajax/user-login
  // username=Stenli78
  // password=Tinusha29
  // remember=0
  const body = new URLSearchParams();
  body.set("username", SOSAC_USERNAME);
  body.set("password", SOSAC_PASSWORD);
  body.set("remember", "0");

  const loginUrl = source.base + "/cs/ajax/user-login";
  const res = await fetch(loginUrl, {
    method: "POST",
    headers: {
      ...baseHeaders(cookie),
      "accept": "*/*",
      "content-type": "application/x-www-form-urlencoded",
      "origin": source.base,
      "referer": source.home,
      "x-requested-with": "XMLHttpRequest"
    },
    body,
    redirect: "manual"
  });

  cookie = mergeCookies(cookie, res.headers.get("set-cookie") || "");

  // ak server pošle ďalšie cookies cez follow
  const location = res.headers.get("location");
  if (location) {
    const follow = await fetch(absolute(location, loginUrl), { headers: baseHeaders(cookie), redirect: "manual" });
    cookie = mergeCookies(cookie, follow.headers.get("set-cookie") || "");
  }

  return cookie;
}

async function proxyPage(target) {
  const safeUrl = absolute(target, target.includes("movies.sosac.tv") ? MOVIES_HOME : SERIES_HOME);
  if (!safeUrl || !isAllowedHost(safeUrl)) return new Response("Nepovolená URL", { status: 403 });

  const source = safeUrl.includes("movies.sosac.tv") ? getSource("movies") : getSource("series");
  const cookie = await login(source);
  const html = await fetchHtml(safeUrl, cookie);
  const base = new URL(safeUrl).origin;

  let body = html
    .replace(/<head([^>]*)>/i, `<head$1><base href="${base}/">`)
    .replace(/href=["']\/([^"']*)["']/gi, `href="${base}/$1"`)
    .replace(/src=["']\/([^"']*)["']/gi, `src="${base}/$1"`);

  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

async function fetchHtml(url, cookie = "") {
  const res = await fetch(url, { headers: baseHeaders(cookie) });
  if (!res.ok) throw new Error("Fetch failed: " + res.status);
  return await res.text();
}

function baseHeaders(cookie = "") {
  const h = {
    "user-agent": "Mozilla/5.0 LechPlay",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "sk-SK,sk;q=0.9,cs;q=0.8,en-US;q=0.7,en;q=0.6",
    "cache-control": "no-cache"
  };
  if (cookie) h["cookie"] = cookie;
  return h;
}

function parseItems(html, baseUrl, section) {
  const items = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = regex.exec(html))) {
    const url = absolute(m[1], baseUrl);
    if (!url || !isAllowedHost(url) || !url.includes("/cs/detail/")) continue;

    const raw = m[2] || "";
    const title =
      firstAttr(raw, /alt=["']([^"']+)["']/i) ||
      firstAttr(raw, /title=["']([^"']+)["']/i) ||
      clean(raw);

    const image =
      firstUrl(raw, baseUrl, /<img[^>]+src=["']([^"']+)["']/i) ||
      firstUrl(raw, baseUrl, /data-src=["']([^"']+)["']/i);

    if (!title || title === "Titulky" || title === "close") continue;
    items.push({ title, url, image, section });
  }

  return uniqueByUrl(items).slice(0, 150);
}

function detailFromHtml(html, baseUrl) {
  return {
    title: firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    description:
      firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) ||
      firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i),
    url: baseUrl
  };
}

function findIframe(html, baseUrl) {
  return firstUrl(html, baseUrl, /<iframe[^>]+src=["']([^"']+)["']/i);
}

function findVideo(html, baseUrl) {
  return (
    firstUrl(html, baseUrl, /<video[^>]+src=["']([^"']+)["']/i) ||
    firstUrl(html, baseUrl, /<source[^>]+src=["']([^"']+)["']/i) ||
    firstUrl(html, baseUrl, /file\s*:\s*["']([^"']+)["']/i) ||
    firstUrl(html, baseUrl, /src\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i)
  );
}

function findPlayLink(html, baseUrl) {
  return (
    firstUrl(html, baseUrl, /href=["']([^"']+)["'][^>]*>\s*(?:Přehrát|Prehrať|Play|Spustiť|Sledovat|Sledovať|Shlédnout)/i) ||
    firstUrl(html, baseUrl, /href=["']([^"']*(?:play|watch|prehrat|prehrát|sledovat|sledovať|shlednout)[^"']*)["']/i)
  );
}

function firstMatch(s, re) { const m = re.exec(s || ""); return m ? clean(m[1]) : ""; }
function firstAttr(s, re) { const m = re.exec(s || ""); return m ? clean(m[1]) : ""; }
function firstUrl(s, base, re) { const m = re.exec(s || ""); return m ? absolute(m[1], base) : ""; }

function clean(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absolute(u, base) { try { return new URL(u, base).href; } catch { return ""; } }

function isAllowedHost(u) {
  try {
    const h = new URL(u).hostname;
    return h === "movies.sosac.tv" || h === "tv.sosac.tv" || h.endsWith(".sosac.tv");
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
      const first = c.split(";")[0].trim();
      const i = first.indexOf("=");
      if (i > 0) map.set(first.slice(0, i), first.slice(i + 1));
    });

  return Array.from(map.entries()).map(([k, v]) => k + "=" + v).join("; ");
}

function uniqueByUrl(items) {
  const seen = new Set(), out = [];
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
