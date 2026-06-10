// FRAME — /api/scan
// Accepts pre-fetched articles from the client when available,
// otherwise fetches GDELT server-side as a fallback (with aggressive retry).
// Then asks Claude to curate the strongest photographic stories.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// ---------- GDELT (server-side fallback) ----------

async function fetchGdelt(query, attempt = 0) {
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: "75",
    sort: "hybridrel",
    timespan: "3weeks",
  });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "FRAME-photo-scouting/1.0 (documentary photography scouting tool)",
    },
  });

  // GDELT rate-limits ~1 req/5s per IP. Vercel IPs are shared, so retry with
  // exponential-ish backoff up to 3 attempts before giving up.
  if (res.status === 429 && attempt < 2) {
    const delay = attempt === 0 ? 7000 : 15000;
    await new Promise((r) => setTimeout(r, delay));
    return fetchGdelt(query, attempt + 1);
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(
        "GDELT is currently rate-limiting our server. Wait a minute and try again."
      );
    }
    const body = await res.text().catch(() => "");
    throw new Error(`GDELT ${res.status}: ${body.slice(0, 200)}`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  return Array.isArray(data.articles) ? data.articles : [];
}

function dedupArticles(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = `${a.domain}|${(a.title || "").slice(0, 60).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: a.title || "",
      domain: a.domain || "",
      country: a.sourcecountry || "",
      language: a.language || "",
      seendate: a.seendate || "",
    });
    if (out.length >= 40) break;
  }
  return out;
}

// ---------- Claude ----------

const SYSTEM_PROMPT = `You are a photo editor at a documentary photography agency. You read raw news headlines and pick the strongest photographic stories — NOT the loud headlines everyone covers, but the hidden human angles, the quiet places changing, the invisible people behind big events.

Evaluate each candidate as a photographer would: can powerful images be made here? Are there real people with faces and hands? Is there a place to go and stand in?

Return 6 to 9 stories spread across DIFFERENT countries and continents when possible, so they map well. Prioritize stories behind the news, not the top headlines. Skip pure financial/political coverage with no visual substance.

For each story:
- title: how a photographer would pitch it, not the news headline
- source: short attribution ("Reuters", "Local report", or the actual outlet from the candidates)
- place: specific place ("Taranto, Italy", "Aral Sea, Kazakhstan")
- lat / lng: best-guess coordinates of the place
- why_photograph: 1–2 sentences on the visual story and what images could reveal
- scores: 1–10 each for visual_depth, human_angle, accessibility, urgency
- total_score: integer 0–100, weighted (visual_depth*3 + human_angle*3 + accessibility*2 + urgency*2)
- tags: 2–4 short lowercase strings`;

function buildUserPrompt(channel, refine, candidates) {
  const refineLine = refine ? `\nNarrow the focus toward: "${refine}".` : "";
  const list = candidates
    .map((c, i) => {
      const date = c.seendate ? String(c.seendate).slice(0, 8) : "";
      return `${i + 1}. [${c.country || "?"}] (${date}) ${c.domain || ""} — ${c.title || ""}`;
    })
    .join("\n");

  return `Channel: ${channel.label}
Editorial direction: ${channel.seed}${refineLine}

Below are real news items from the last three weeks, pulled from a global media monitor (GDELT). Use them as ground truth for what is actually happening right now. Synthesize across them — you may combine multiple items into one story angle, or follow a thread one item only hints at. Do not invent unrelated stories.

CANDIDATE NEWS ITEMS:
${list}

Return the strongest 6–9 photographic stories as a JSON object with this exact structure:
{"stories": [ { "title": "...", "source": "...", "place": "...", "lat": 0.0, "lng": 0.0, "why_photograph": "...", "scores": { "visual_depth": 0, "human_angle": 0, "accessibility": 0, "urgency": 0 }, "total_score": 0, "tags": ["..."] } ]}
Output raw JSON only, no markdown.`;
}

// ---------- Handler ----------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const {
      channel,
      refine = "",
      articles: clientArticles = [],
      browserGdeltOk = false,
      gdeltRateLimited = false,
    } = req.body || {};

    if (!channel || !channel.label || !channel.seed) {
      res.status(400).json({ error: "channel.label and channel.seed are required" });
      return;
    }

    // 1. Use client-fetched GDELT articles when available (preferred — uses
    //    the user's residential IP and avoids Vercel's shared-IP rate limits).
    // 2. If empty (browser blocked the fetch), fall back to server-side fetch.
    let candidates = clientArticles;
    let usedServerFallback = false;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      // Browser was rate-limited by GDELT — don't retry server-side (same IP pool).
      if (gdeltRateLimited) {
        res.status(200).json({
          stories: [],
          notice: "GDELT is busy right now — wait 60 seconds and try again.",
        });
        return;
      }
      // Browser reached GDELT successfully but got 0 results — don't retry
      // server-side (same query would also get 0, and Vercel IPs get rate-limited).
      if (browserGdeltOk) {
        res.status(200).json({
          stories: [],
          notice: "No recent news matched this channel. Try again in a few minutes or pick another channel.",
        });
        return;
      }
      if (!channel.gdelt) {
        res.status(400).json({
          error: "No articles provided and no server-side query available.",
        });
        return;
      }
      usedServerFallback = true;
      const query = refine
        ? `${channel.gdelt} (${refine})`
        : channel.gdelt;
      const rawArticles = await fetchGdelt(query);
      candidates = dedupArticles(rawArticles);
    }

    if (candidates.length === 0) {
      res.status(200).json({
        stories: [],
        notice: "No news items matched. Try a different channel or refine term.",
      });
      return;
    }

    // Cap to keep the prompt manageable.
    candidates = candidates.slice(0, 40);

    const stream = client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildUserPrompt(channel, refine, candidates) },
      ],
    });

    const message = await stream.finalMessage();

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) {
      throw new Error("Claude returned no text content");
    }

    // Strip markdown code fences if Claude wraps the JSON
    let raw = textBlock.text.trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) raw = fence[1].trim();
    const parsed = JSON.parse(raw);
    const stories = Array.isArray(parsed) ? parsed : (parsed.stories || []);

    res.status(200).json({
      stories,
      meta: {
        gdelt_candidates: candidates.length,
        source: usedServerFallback ? "server" : "browser",
        model: message.model,
      },
    });
  } catch (err) {
    console.error("scan error:", err);
    res.status(500).json({
      error: err?.message || "Internal error",
    });
  }
}
