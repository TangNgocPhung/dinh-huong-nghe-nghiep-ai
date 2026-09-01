const SITE_ORIGINS = [
  "https://dinh-huong-nghe-nghiep-ai.onrender.com",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

function periodKeys(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Unable to determine reporting period");
  return { year, month, yearKey: `year:${year}`, monthKey: `month:${year}-${month}` };
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  if (origin && SITE_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

function statsFromRows(rows, keys) {
  const values = Object.fromEntries(rows.map((row) => [String(row.period), Number(row.count) || 0]));
  return {
    month: values[keys.monthKey] || 0,
    year: values[keys.yearKey] || 0,
    total: values.total || 0,
    monthKey: keys.monthKey.slice(6),
    yearKey: keys.year,
  };
}

async function readStats(db, keys) {
  const result = await db
    .prepare("SELECT period, count FROM visit_counters WHERE period IN (?, ?, ?)")
    .bind("total", keys.yearKey, keys.monthKey)
    .all();
  return statsFromRows(result.results || [], keys);
}

async function recordVisit(db, keys) {
  const increment = "INSERT INTO visit_counters(period, count) VALUES (?, 1) ON CONFLICT(period) DO UPDATE SET count = count + 1";
  const results = await db.batch([
    db.prepare(increment).bind("total"),
    db.prepare(increment).bind(keys.yearKey),
    db.prepare(increment).bind(keys.monthKey),
    db.prepare("SELECT period, count FROM visit_counters WHERE period IN (?, ?, ?)").bind("total", keys.yearKey, keys.monthKey),
  ]);
  return statsFromRows(results[3]?.results || [], keys);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowedOrigin = origin && SITE_ORIGINS.includes(origin);

    if (request.method === "OPTIONS") {
      return allowedOrigin
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : json({ error: "Origin not allowed" }, 403, null);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true }, 200, origin);
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      try {
        const keys = periodKeys();
        return json(await readStats(env.DB, keys), 200, origin);
      } catch {
        return json({ error: "Unable to read visit statistics" }, 500, origin);
      }
    }

    if (url.pathname === "/visit" && request.method === "POST") {
      if (!allowedOrigin) return json({ error: "Origin not allowed" }, 403, null);
      try {
        const keys = periodKeys();
        return json(await recordVisit(env.DB, keys), 200, origin);
      } catch {
        return json({ error: "Unable to record visit" }, 500, origin);
      }
    }

    return json({ error: "Not found" }, 404, origin);
  },
};
