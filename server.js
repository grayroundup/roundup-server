import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// Env vars (server only)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars. Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -------------------------
// Tiny in-memory rate limiter
// -------------------------
// This is just enough for MVP. It resets when the server restarts.
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX = 60; // max requests per window per key (installId or IP)
const rateMap = new Map();

function rateLimitKey(req) {
  // prefer installId if present, otherwise fall back to IP
  const installId = req.body?.installId;
  if (typeof installId === "string" && installId.length > 0) return `id:${installId}`;
  return `ip:${req.ip}`;
}

function checkRateLimit(req) {
  const key = rateLimitKey(req);
  const now = Date.now();
  const entry = rateMap.get(key);

  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rateMap.set(key, { start: now, count: 1 });
    return { ok: true };
  }

  entry.count += 1;
  if (entry.count > RATE_MAX) {
    return { ok: false };
  }
  return { ok: true };
}

// health check
app.get("/health", (req, res) => res.json({ ok: true }));

// receive donation event (no secret required)
app.post("/events/donation", async (req, res) => {
  try {
    // rate limit
    const rl = checkRateLimit(req);
    if (!rl.ok) {
      return res.status(429).json({ ok: false, error: "Rate limited" });
    }

    const { installId, amount, charity, host, timestamp } = req.body || {};

    // validate required fields
    if (!installId || typeof installId !== "string" || installId.length > 200) {
      return res.status(400).json({ ok: false, error: "installId required" });
    }
    if (!host || typeof host !== "string" || host.length > 300) {
      return res.status(400).json({ ok: false, error: "host required" });
    }

    // amount can be optional if you want, but your current table expects it.
    // Keep your original constraint, just slightly safer.
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1000) {
      return res.status(400).json({ ok: false, error: "amount invalid" });
    }

    // charity optional for MVP, but keep it required if your extension always sends it
    if (!charity || typeof charity !== "string" || charity.length > 200) {
      return res.status(400).json({ ok: false, error: "charity required" });
    }

    // timestamp: accept either a number (ms) or ISO string
    let eventTime = new Date();
    if (timestamp !== undefined && timestamp !== null && timestamp !== "") {
      if (typeof timestamp === "number" || (typeof timestamp === "string" && /^\d+$/.test(timestamp))) {
        eventTime = new Date(Number(timestamp));
      } else {
        eventTime = new Date(String(timestamp));
      }
    }
    if (Number.isNaN(eventTime.getTime())) {
      return res.status(400).json({ ok: false, error: "timestamp invalid" });
    }

    const { error } = await supabase.from("donations").insert({
      install_id: installId,
      amount: amt,
      charity,
      host,
      event_time: eventTime.toISOString(),
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ ok: false, error: "DB insert failed" });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on ${port}`));
