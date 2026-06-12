// FRAME — /api/scout
// Generates a pre-production scouting report for a specific story + location.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a seasoned location scout and documentary photographer. Given a story and its location, produce a practical pre-production scouting report for a photographer planning to shoot there.

Be specific to the real place. If you are uncertain, give the best informed guidance a working pro would give.

For permits and access, always name the specific authority, ministry, or organisation the photographer should contact — not generic advice. Where a real website or official body exists, name it explicitly.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { title, place, why_photograph, tags = [] } = req.body || {};
    if (!title || !place) {
      res.status(400).json({ error: "title and place are required" });
      return;
    }

    const userPrompt = `STORY: ${title}
LOCATION: ${place}
WHY IT MATTERS PHOTOGRAPHICALLY: ${why_photograph || "(not provided)"}
TAGS: ${Array.isArray(tags) ? tags.join(", ") : ""}

Return a JSON object with this exact structure (raw JSON, no markdown):
{
  "best_season": "...",
  "constraints": "Any timing constraints that affect shooting: curfews, closed days, restricted hours, active conflict zones, seasonal access issues, political climate. Empty string if none.",
  "access": "How to physically reach the location and move around once there.",
  "access_level": "easy|moderate|hard",
  "access_source": "Specific authority, organisation or official website to verify access — e.g. 'Ministry of Interior of [country], [country] Press Accreditation Office, or [local authority name]'. Be specific.",
  "permits": "What permits or permissions are required, and how to obtain them.",
  "permits_source": "Specific authority or organisation that issues the permits — e.g. 'National Press Council of [country] (npf.org.xx), [country] Ministry of Culture'. Be specific.",
  "contacts": "Who to approach on the ground: local fixers, community leaders, NGOs, journalists already working the story.",
  "safety": "Security situation, health risks, and practical safety notes.",
  "safety_level": "low|moderate|high",
  "visual_approach": "The photographic strategy: lenses, angles, light conditions, moments to wait for, what to avoid.",
  "gear_note": "Specific gear recommendations for this environment."
}`;

    const stream = client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const message = await stream.finalMessage();
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) throw new Error("Claude returned no text content");

    let raw = textBlock.text.trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) raw = fence[1].trim();
    const report = JSON.parse(raw);

    res.status(200).json({ report, meta: { model: message.model } });
  } catch (err) {
    console.error("scout error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
}
