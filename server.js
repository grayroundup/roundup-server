import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_SECRET = process.env.API_SECRET; // simple shared secret for beta

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !API_SECRET) {
  console.error("Missing env vars. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_SECRET");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// health check
app.get("/health", (req, res) => res.json({ ok: true }));

// receive donation event
app.post("/events/donation", async (req, res) => {
  try {
    // simple auth: extension must send the secret
    const secret = req.header("x-api-secret");
    if (secret !== API_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { installId, amount, charity, host, timestamp } = req.body || {};

    // validate
    if (!installId || typeof installId !== "string") {
      return res.status(400).json({ ok: false, error: "installId required" });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1000) {
      return res.status(400).json({ ok: false, error: "amount invalid" });
    }
    if (!charity || typeof charity !== "string") {
      return res.status(400).json({ ok: false, error: "charity required" });
    }
    if (!host || typeof host !== "string") {
      return res.status(400).json({ ok: false, error: "host required" });
    }

    const eventTime = timestamp ? new Date(Number(timestamp)) : new Date();
    if (Number.isNaN(eventTime.getTime())) {
      return res.status(400).json({ ok: false, error: "timestamp invalid" });
    }

    const { error } = await supabase.from("donations").insert({
      install_id: installId,
      amount: amt,
      charity,
      host,
      event_time: eventTime.toISOString()
    });

    if (error) throw error;

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on ${port}`));
