// FRAME — /api/scan
// Receives pre-fetched GDELT articles from the browser (uses the user's IP,
// avoids Vercel shared-IP rate limits). If the browser couldn't reach GDELT,
// returns a friendly retry message — no server-side GDELT fetch.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

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

    let candidates = Array.isArray(clientArticles) ? clientArticles : [];

    if (candidates.length === 0) {
      // Browser was rate-limited by GDELT.
      if (gdeltRateLimited) {
        res.status(200).json({
          stories: [],
          notice: "GDELT is busy right now — wait 60 seconds and try again.",
        });
        return;
      }
      // Browser reached GDELT successfully but got 0 results.
      if (browserGdeltOk) {
        res.status(200).json({
          stories: [],
          notice: "No recent news matched this channel. Try again in a few minutes or pick another channel.",
        });
        return;
      }
      // Browser got a network error — ask user to retry instead of hitting GDELT
      // from Vercel's shared IPs (which get rate-limited immediately).
      res.status(200).json({
        stories: [],
        notice: "Couldn't reach the news feed — wait a moment and try again.",
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
