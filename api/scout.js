// FRAME — /api/scout
// Generates a pre-production scouting report for a specific story + location.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a seasoned location scout and documentary photographer. Given a story and its location, produce a practical pre-production scouting report for a photographer planning to shoot there.

Be specific to the real place. If you are uncertain, give the best informed guidance a working pro would give.`;


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

Write the scouting report.`;

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
    if (!textBlock) {
      throw new Error("Claude returned no text content");
    }

    // Strip markdown code fences if Claude wraps the JSON
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
