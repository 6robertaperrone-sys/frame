// FRAME — /api/auth
// Password gate. Set FRAME_PASSWORD env var on Vercel to protect the app.
// If FRAME_PASSWORD is not set, the app is open to everyone.

import crypto from "crypto";

function makeToken(password) {
  const secret = process.env.ANTHROPIC_API_KEY || "frame-key";
  return crypto.createHmac("sha256", secret).update(password).digest("hex");
}

export default function handler(req, res) {
  const FRAME_PASSWORD = process.env.FRAME_PASSWORD;

  // No password configured → open access
  if (!FRAME_PASSWORD) {
    res.status(200).json({ ok: true, open: true });
    return;
  }

  if (req.method === "POST") {
    const { password } = req.body || {};
    if (password === FRAME_PASSWORD) {
      res.status(200).json({ ok: true, token: makeToken(FRAME_PASSWORD) });
    } else {
      res.status(401).json({ ok: false, error: "Wrong password" });
    }
  } else if (req.method === "GET") {
    const token = req.query.token;
    const valid = token && token === makeToken(FRAME_PASSWORD);
    res.status(valid ? 200 : 401).json({ ok: valid });
  } else {
    res.status(405).end();
  }
}
