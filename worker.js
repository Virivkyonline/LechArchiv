
const SERIES_BASE = "https://tv.sosac.tv";
const SERIES_HOME = "https://tv.sosac.tv/cs/";

const MOVIES_BASE = "https://movies.sosac.tv";
const MOVIES_HOME = "https://movies.sosac.tv/cs/";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/list") {
      const type = url.searchParams.get("type") || "movies";
      return json(await list(type));
    }

    if (url.pathname === "/api/search") {
      const q = url.searchParams.get("q") || "";
      return json(await search(q));
    }

    if (url.pathname === "/api/detail") {
      const pageUrl = url.searchParams.get("url");
      return json(await detail(pageUrl));
    }

    return json({ ok: true });
  }
};

async function list(type) {
  let page = MOVIES_HOME;

  if (type === "series") page = SERIES_HOME;
  if (type === "movies") page = MOVIES_HOME;

  const html = await fetch(page).then(r => r.text());
  return { items: parseItems(html, page) };
}

async function search(q) {
  if (!q) return { items: [] };

  const urls = [
    SERIES_BASE + "/cs/search?q=" + encodeURIComponent(q),
    MOVIES_BASE + "/cs/search?q=" + encodeURIComponent(q)
  ];

  let all = [];

  for (const u of urls) {
    const html = await fetch(u).then(r => r.text());
    all = all.concat(parseItems(html, u));
  }

  return { items: all };
}

async function detail(url) {
  const html = await fetch(url).then(r => r.text());
  return {
    title: html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1] || "",
    description: html.match(/description[^>]+content=["']([^"']+)/i)?.[1] || "",
    url
  };
}

function parseItems(html, base) {
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  const out = [];
  let m;
  while ((m = regex.exec(html))) {
    const u = new URL(m[1], base).href;
    const t = m[2].replace(/<[^>]+>/g, "").trim();
    if (u.includes("/cs/detail/")) out.push({ title: t, url: u });
  }
  return out;
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
}
