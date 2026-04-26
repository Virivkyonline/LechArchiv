const SERIES_BASE = "https://tv.sosac.tv";
const SERIES_HOME = "https://tv.sosac.tv/cs/";

const MOVIES_BASE = "https://movies.sosac.tv";
const MOVIES_HOME = "https://movies.sosac.tv/cs/";

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const userEmail = request.headers.get("x-sosac-email") || "";
      const userPassword = request.headers.get("x-sosac-password") || "";

      if (request.method === "OPTIONS") return cors(json({ ok: true }));

      if (url.pathname === "/") {
        return cors(json({
          ok: true,
          name: "LechPlay API",
          sources: { movies: MOVIES_HOME, series: SERIES_HOME }
        }));
      }

      if (url.pathname === "/api/list") {
        const type = url.searchParams.get("type") || "movies";
        return cors(json(await list(type, userEmail, userPassword)));
      }

      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") || "";
        const section = url.searchParams.get("section") || "movies";
        return cors(json(await search(q, section, userEmail, userPassword)));
      }

      if (url.pathname === "/api/play") {
        const pageUrl = url.searchParams.get("url");
        if (!pageUrl) return cors(json({ error: "Missing url" }, 400));
        return cors(json(await play(pageUrl, userEmail, userPassword, url.origin)));
      }

      if (url.pathname === "/api/detail") {
        const pageUrl = url.searchParams.get("url");
        if (!pageUrl) return cors(json({ error: "Missing url" }, 400));
        return cors(json(await detail(pageUrl, userEmail, userPassword)));
      }

      if (url.pathname === "/proxy") {
        const target = url.searchParams.get("url");
        if (!target) return new Response("Missing url", { status: 400 });
        return await proxyPage(target, request);
      }

      return cors(json({ error: "Not found" }, 404));
    } catch (e) {
      return cors(json({ error: true, message: e.message }, 500));
    }
  }
};

function getSource(type) {
  if (type === "series") return { type: "series", base: SERIES_BASE, home: SERIES_HOME };
  return { type: "movies", base: MOVIES_BASE, home: MOVIES_HOME };
}

async function list(type, userEmail = "", userPassword = "") {
  const source = getSource(type);
  const jar = await loginJar(source, userEmail, userPassword);
  const html = await fetchHtml(source.home, jar);
  return { type: source.type, source: source.home, items: parseItems(html, source.home, source.type) };
}

async function search(q, section, userEmail = "", userPassword = "") {
  if (!q.trim()) return { q, section, items: [] };
  const source = getSource(section);
  const jar = await loginJar(source, userEmail, userPassword);
  const page = source.base + "/cs/search?q=" + encodeURIComponent(q);
  const html = await fetchHtml(page, jar);
  return { q, section: source.type, source: page, items: parseItems(html, page, source.type) };
}

async function detail(pageUrl, userEmail = "", userPassword = "") {
  const safeUrl = absolute(pageUrl, pageUrl.includes("movies.sosac.tv") ? MOVIES_HOME : SERIES_HOME);
  if (!safeUrl || !isAllowedHost(safeUrl)) throw new Error("Nepovolená URL.");
  const source = safeUrl.includes("movies.sosac.tv") ? getSource("movies") : getSource("series");
  const jar = await loginJar(source, userEmail, userPassword);
  const html = await fetchHtml(safeUrl, jar);
  return detailFromHtml(html, safeUrl);
}

async function play(pageUrl, userEmail = "", userPassword = "", origin = "") {
  const safeUrl = absolute(pageUrl, pageUrl.includes("movies.sosac.tv") ? MOVIES_HOME : SERIES_HOME);
  if (!safeUrl || !isAllowedHost(safeUrl)) throw new Error("Nepovolená URL.");

  const source = safeUrl.includes("movies.sosac.tv") ? getSource("movies") : getSource("series");
  const jar = await loginJar(source, userEmail, userPassword);
  const html = await fetchHtml(safeUrl, jar);

  const detail = detailFromHtml(html, safeUrl);
  const iframe = findIframe(html, safeUrl);
  const video = findVideo(html, safeUrl);
  const playLink = findPlayLink(html, safeUrl);

  if (video) return { ...detail, videoUrl: video };
  if (iframe) return { ...detail, embedUrl: iframe };
  if (playLink) {
    const playHtml = await fetchHtml(playLink, jar);
    const iframe2 = findIframe(playHtml, playLink);
    const video2 = findVideo(playHtml, playLink);
    if (video2) return { ...detail, videoUrl: video2 };
    if (iframe2) return { ...detail, embedUrl: iframe2 };
    return { ...detail, proxyUrl: "/proxy?url=" + encodeURIComponent(playLink) };
  }

  return { ...detail, proxyUrl: "/proxy?url=" + encodeURIComponent(safeUrl) };
}

async function proxyPage(target, request) {
  const safeUrl = absolute(target, target.includes("movies.sosac.tv") ? MOVIES_HOME : SERIES_HOME);
  if (!safeUrl || !isAllowedHost(safeUrl)) return new Response("Nepovolená URL", { status: 403 });

  const html = await fetchHtml(safeUrl, "");
  const base = new URL(safeUrl).origin;
  let body = html
    .replace(/<head([^>]*)>/i, `<head$1><base href="${base}/">`)
    .replace(/href=["']\/([^"']*)["']/gi, `href="${base}/$1"`)
    .replace(/src=["']\/([^"']*)["']/gi, `src="${base}/$1"`);

  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": "*",
      "x-frame-options": "ALLOWALL"
    }
  });
}

async function loginJar(source, userEmail = "", userPassword = "") {
  if (!userEmail || !userPassword || userEmail.includes("SEM_DAJ")) return "";

  let cookie = "";
  const loginUrls = [
    source.base + "/cs/login",
    source.base + "/cs/prihlaseni",
    source.base + "/login",
    source.base + "/user/login"
  ];

  for (const loginUrl of loginUrls) {
    try {
      const loginPage = await fetch(loginUrl, { headers: basicHeaders(cookie) });
      cookie = mergeCookies(cookie, loginPage.headers.get("set-cookie") || "");
      const html = await loginPage.text();

      const formAction = firstAttr(html, /<form[^>]+action=["']([^"']+)["']/i);
      const action = formAction ? absolute(formAction, loginUrl) : loginUrl;

      const csrfName =
        firstAttr(html, /<input[^>]+name=["']([^"']*(?:csrf|token|_token)[^"']*)["'][^>]*>/i) ||
        "_token";
      const csrfValue =
        firstAttr(html, new RegExp('<input[^>]+name=["\\\']' + escapeReg(csrfName) + '["\\\'][^>]+value=["\\\']([^"\\\']*)', "i")) ||
        "";

      const body = new URLSearchParams();
      body.set("email", userEmail);
      body.set("username", userEmail);
      body.set("login", userEmail);
      body.set("password", userPassword);
      body.set("passwd", userPassword);
      body.set("remember", "1");
      if (csrfValue) body.set(csrfName, csrfValue);

      const res = await fetch(action, {
        method: "POST",
        headers: {
          ...basicHeaders(cookie),
          "content-type": "application/x-www-form-urlencoded",
          "origin": source.base,
          "referer": loginUrl
        },
        body,
        redirect: "manual"
      });

      cookie = mergeCookies(cookie, res.headers.get("set-cookie") || "");
      if (cookie) return cookie;
    } catch (e) {}
  }

  return cookie;
}

async function fetchHtml(url, cookie = "") {
  const res = await fetch(url, { headers: basicHeaders(cookie) });
  if (!res.ok) throw new Error("Fetch failed: " + res.status);
  return await res.text();
}

function basicHeaders(cookie = "") {
  const h = {
    "user-agent": "Mozilla/5.0 LechPlay",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
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
    firstUrl(html, baseUrl, /href=["']([^"']+)["'][^>]*>\s*(?:Přehrát|Prehrať|Play|Spustiť|Sledovat|Sledovať)/i) ||
    firstUrl(html, baseUrl, /href=["']([^"']*(?:play|watch|prehrat|prehrát|sledovat|sledovať)[^"']*)["']/i)
  );
}

function firstMatch(s, re) { const m = re.exec(s || ""); return m ? clean(m[1]) : ""; }
function firstAttr(s, re) { const m = re.exec(s || ""); return m ? clean(m[1]) : ""; }
function firstUrl(s, base, re) { const m = re.exec(s || ""); return m ? absolute(m[1], base) : ""; }
function clean(s) { return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function absolute(u, base) { try { return new URL(u, base).href; } catch { return ""; } }
function isAllowedHost(u) { try { const h = new URL(u).hostname; return h === "movies.sosac.tv" || h === "tv.sosac.tv" || h.endsWith(".sosac.tv") || h.includes("sosac"); } catch { return false; } }
function mergeCookies(oldCookie, setCookie) {
  const map = new Map();
  String(oldCookie || "").split(";").map(x=>x.trim()).filter(Boolean).forEach(p=>{const i=p.indexOf("="); if(i>0) map.set(p.slice(0,i), p.slice(i+1));});
  String(setCookie || "").split(/,(?=[^;,]+=)/).forEach(c=>{const first=c.split(";")[0].trim(); const i=first.indexOf("="); if(i>0) map.set(first.slice(0,i), first.slice(i+1));});
  return Array.from(map.entries()).map(([k,v])=>k+"="+v).join("; ");
}
function uniqueByUrl(items) { const seen = new Set(), out = []; for (const item of items) { if (!item.url || seen.has(item.url)) continue; seen.add(item.url); out.push(item); } return out; }
function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function cors(resp) { const h = new Headers(resp.headers); h.set("access-control-allow-origin", "*"); h.set("access-control-allow-methods", "GET,POST,OPTIONS"); h.set("access-control-allow-headers", "content-type,accept,x-sosac-email,x-sosac-password"); return new Response(resp.body, { status: resp.status, headers: h }); }
