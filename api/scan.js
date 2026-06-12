// FRAME — /api/scan
// Primary: receives pre-fetched GDELT articles from the browser.
// Fallback: if the browser couldn't reach GDELT, tries server-side GDELT
// using a module-level cache (persists across warm Vercel instances).

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// ---------- Server-side GDELT cache (module-level, warm across invocations) ----------
const serverGdeltCache = {};
const SERVER_GDELT_TTL = 25 * 60 * 1000; // 25 min

function dedupArticles(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = `${a.domain}|${(a.title || "").slice(0, 60).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: a.title || "",
      url: a.url || "",
      domain: a.domain || "",
      country: a.sourcecountry || "",
      language: a.language || "",
      seendate: a.seendate || "",
    });
    if (out.length >= 40) break;
  }
  return out;
}

async function fetchGdeltServer(query) {
  const cached = serverGdeltCache[query];
  if (cached && Date.now() - cached.ts < SERVER_GDELT_TTL) {
    return cached.articles;
  }
  // Don't try a live GDELT fetch from the server — Vercel's shared IPs are
  // almost always rate-limited by GDELT. The browser handles live fetches
  // via its serialised queue (5.5 s spacing); we only serve warm cache here.
  return [];
}

// ---------- Claude ----------

const SYSTEM_PROMPT = `You are a senior photo editor at a documentary photography agency. You think like the juries of World Press Photo, POYi, and Visa pour l'Image — you are looking for the stories behind the story.

YOUR EDITORIAL COMPASS — the stories that work:
• A named individual whose face carries the weight of a systemic crisis (a 65-year-old woman sitting next to the rubble of her bombed building, not "Russia strikes Kyiv")
• A community that resists, organises, or endures — not just suffers
• The human cost of abstract forces: climate displacement mapped to a specific coastline eroding three times faster than the global average; a healthcare system collapsing onto one midwife working without pay
• Justice and accountability stories with faces: indigenous women winning a 14-year legal battle, a Gen Z revolt that changes a government
• Invisible geographies: conflicts, crises and cultural moments that the global media ignores (Sudan, Nepal, Yurumangui river communities)
• Intimate long-term access: a photographer embedded in their own family, a community, or alongside a person facing illness or loss

WHAT TO SKIP:
• Diplomatic meetings, summit communiqués, electoral results, stock market moves — no faces, no place to stand
• Pure military/security updates without a civilian angle
• Anything where the story is a number, not a person

EVALUATION — ask yourself: Can a photographer stand somewhere specific and make a picture that tells this story without a caption? Are there real people whose lives, bodies and faces carry the weight? Is this the hidden angle that major wire services are missing?

Return 10 to 20 stories spread across DIFFERENT countries and continents when possible, so they map well globally.

For each story:
- title: how a photographer would pitch it to an editor — specific, human, visual (not the wire headline)
- source: short attribution ("Reuters", "Local report", or the outlet from the candidates)
- url: the URL of the single most relevant candidate article for this story (copy it exactly from the list — empty string if none matches)
- place: the specific place where a photographer should go ("Daikundi Province, Afghanistan", "Yurumangui River, Colombia")
- lat / lng: best-guess coordinates of that place
- why_photograph: 1–2 sentences on what images could reveal that words cannot — the visual logic of the story
- scores: 1–10 each for visual_depth, human_angle, accessibility, urgency
- total_score: integer 0–100, weighted (visual_depth*3 + human_angle*3 + accessibility*2 + urgency*2)
- tags: 2–4 short lowercase strings`;

function buildUserPrompt(channel, refine, candidates) {
  const refineLine = refine ? `\nNarrow the focus toward: "${refine}".` : "";
  const list = candidates
    .map((c, i) => {
      const date = c.seendate ? String(c.seendate).slice(0, 8) : "";
      return `${i + 1}. [${c.country || "?"}] (${date}) ${c.domain || ""} — ${c.title || ""}${c.url ? `\n   URL: ${c.url}` : ""}`;
    })
    .join("\n");

  return `Channel: ${channel.label}
Editorial direction: ${channel.seed}${refineLine}

Below are real news items from the last three weeks, pulled from a global media monitor (GDELT). Use them as ground truth for what is actually happening right now. Synthesize across them — you may combine multiple items into one story angle, or follow a thread one item only hints at. Do not invent unrelated stories.

CANDIDATE NEWS ITEMS:
${list}

Return the strongest 10–20 photographic stories as a JSON object with this exact structure:
{"stories": [ { "title": "...", "source": "...", "url": "https://...", "place": "...", "lat": 0.0, "lng": 0.0, "why_photograph": "...", "scores": { "visual_depth": 0, "human_angle": 0, "accessibility": 0, "urgency": 0 }, "total_score": 0, "tags": ["..."] } ]}
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

    let candidates = Array.isArray(clientArticles) ? clientArticles : [];

    if (candidates.length === 0) {
      if (gdeltRateLimited) {
        // Browser got 429 — try server cache before giving up
        if (channel.gdelt) {
          const query = refine ? `${channel.gdelt} (${refine})` : channel.gdelt;
          candidates = await fetchGdeltServer(query);
        }
        if (candidates.length === 0) {
          res.status(200).json({
            stories: [],
            notice: "GDELT is busy right now — wait 30 seconds and try again.",
          });
          return;
        }
      } else if (browserGdeltOk) {
        res.status(200).json({
          stories: [],
          notice: "No recent news matched this channel. Try again in a few minutes or pick another channel.",
        });
        return;
      } else {
        // Browser network error — try server-side GDELT (with cache)
        if (channel.gdelt) {
          const query = refine ? `${channel.gdelt} (${refine})` : channel.gdelt;
          candidates = await fetchGdeltServer(query);
        }
        if (candidates.length === 0) {
          res.status(200).json({
            stories: [],
            notice: "Couldn't reach the news feed — wait a moment and try again.",
          });
          return;
        }
      }
    }

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
    if (!textBlock) throw new Error("Claude returned no text content");

    let raw = textBlock.text.trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) raw = fence[1].trim();
    const parsed = JSON.parse(raw);
    const stories = Array.isArray(parsed) ? parsed : (parsed.stories || []);

    res.status(200).json({
      stories,
      meta: { gdelt_candidates: candidates.length, model: message.model },
    });
  } catch (err) {
    console.error("scan error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
}
