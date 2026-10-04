// Fridge to Fork: backend server
// ------------------------------------------------------------
// 1. Serves the frontend (the files in /public) to the browser.
// 2. Exposes POST /api/recipes: validates the user's ingredients,
//    asks the AI (Gemini or Claude, see ai.js) for recipes, and
//    returns them as JSON.
// 3. Exposes GET /health so AWS App Runner can check the app is up.
// The AI API key is read from an environment variable and never
// leaves this server, so the browser can't see it.

const express = require("express");
const path = require("path");
const { chooseProvider } = require("./ai");
const { SYSTEM_PROMPT, RECIPE_SCHEMA, buildUserMessage, cleanReply } = require("./recipe-prompt");

const PORT = process.env.PORT || 8080; // App Runner sends traffic to 8080

// Limits that keep the app safe and the AI bill small
const MAX_INGREDIENTS = 20;
const MAX_INGREDIENT_LENGTH = 40;
const RATE_LIMIT_PER_MINUTE = 10;

const DIETS = ["none", "vegetarian", "vegan", "gluten-free", "dairy-free"];
const MAX_TIMES = [15, 30, 45, 60];

// The AI provider. If no key is set, the site still loads and explains
// the problem instead of crashing.
const ai = chooseProvider();
if (!ai) {
  console.warn("WARNING: no AI key found. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY. /api/recipes will return 503.");
}

const app = express();
app.set("trust proxy", true); // App Runner's load balancer sets X-Forwarded-For
app.use(express.json({ limit: "10kb" }));

// Basic security headers: only load scripts and styles from this site
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
  });
  next();
});

// One log line per API request. These appear in App Runner's application logs.
// Only counts and timings are logged, never what the user typed.
app.use("/api", (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`
    );
  });
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Health check used by App Runner before it sends traffic to a new version
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    aiConfigured: Boolean(ai),
    provider: ai?.name ?? null,
    providerLabel: ai?.label ?? null,
    model: ai?.model ?? null,
    freeTier: ai?.freeTier ?? false,
  });
});

// ---------- Simple in-memory rate limit (per IP, per minute) ----------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT_PER_MINUTE;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) {
    if (times.every((t) => now - t >= 60_000)) hits.delete(ip);
  }
}, 60_000).unref();

// ---------- Input validation ----------
function validate(body) {
  const { ingredients, diet = "none", maxTime = 30, servings = 2 } = body || {};

  if (!Array.isArray(ingredients)) {
    return { error: "Send ingredients as a list." };
  }
  const cleaned = [
    ...new Set(
      ingredients
        .filter((i) => typeof i === "string")
        .map((i) => i.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (cleaned.length === 0) {
    return { error: "Add at least one ingredient first." };
  }
  if (cleaned.length > MAX_INGREDIENTS) {
    return { error: `Please use ${MAX_INGREDIENTS} ingredients or fewer.` };
  }
  if (cleaned.some((i) => i.length > MAX_INGREDIENT_LENGTH)) {
    return { error: `Each ingredient must be ${MAX_INGREDIENT_LENGTH} characters or fewer.` };
  }
  if (!DIETS.includes(diet)) {
    return { error: "Unknown diet option." };
  }
  const time = Number(maxTime);
  if (!MAX_TIMES.includes(time)) {
    return { error: "Unknown cooking time option." };
  }
  const people = Number(servings);
  if (!Number.isInteger(people) || people < 1 || people > 8) {
    return { error: "Servings must be a whole number from 1 to 8." };
  }
  return { value: { ingredients: cleaned, diet, maxTime: time, servings: people } };
}

// ---------- The AI endpoint ----------
// What the user sees for each kind of AI error (see ai.js)
const AI_ERRORS = {
  auth: [503, "The server's AI key is invalid. The owner needs to fix it."],
  quota: [503, "The app has reached its AI usage limit. Wait a minute and try again. If it keeps happening, the daily limit is used up."],
  busy: [503, "The AI is busy right now. Please try again in a moment."],
  refused: [422, "The AI declined this request. Try different ingredients."],
  truncated: [502, "The AI's answer was cut off. Please try again."],
  other: [502, "Something went wrong talking to the AI. Please try again."],
};

app.post("/api/recipes", async (req, res) => {
  if (!ai) {
    return res.status(503).json({ error: "The AI service isn't configured on the server yet." });
  }
  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
  }

  const { error, value } = validate(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const reply = await ai.generate({ system: SYSTEM_PROMPT, user: buildUserMessage(value), schema: RECIPE_SCHEMA });
    const data = cleanReply(reply);
    if (!data) throw Object.assign(new Error("The AI's reply wasn't in the expected shape"), { kind: "other" });
    return res.json({ ...data, servings: value.servings, model: ai.model });
  } catch (err) {
    const kind = AI_ERRORS[err.kind] ? err.kind : "other";
    console.error(`AI error (${ai.label}, ${kind}):`, err.message);
    const [status, message] = AI_ERRORS[kind];
    return res.status(status).json({ error: message });
  }
});

// Anything else under /api is a 404 in JSON
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Fridge to Fork listening on port ${PORT}` + (ai ? ` (AI: ${ai.label}, ${ai.model})` : " (no AI key)"));
});
