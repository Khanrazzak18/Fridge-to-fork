// Fridge to Fork: AI provider
// ------------------------------------------------------------
// The rest of the app calls generateRecipes() and doesn't care which
// AI answers. This file picks the provider from environment variables:
//
//   GEMINI_API_KEY    -> Google Gemini (has a free tier)   <- default
//   ANTHROPIC_API_KEY -> Anthropic Claude (paid)
//
// If both keys are set, Gemini is used unless AI_PROVIDER=claude.
// Every error is turned into an AIError with a simple "kind", so the
// server can show the user a clear message whichever AI is in use.

const { GoogleGenAI } = require("@google/genai");
const Anthropic = require("@anthropic-ai/sdk");

class AIError extends Error {
  // kind: "auth" | "quota" | "busy" | "refused" | "truncated" | "other"
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const TIMEOUT_MS = 45_000;

// ---------- Google Gemini ----------
function geminiProvider(apiKey) {
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const client = new GoogleGenAI({
    apiKey,
    // GEMINI_BASE_URL is only used for local testing with a fake server
    httpOptions: { timeout: TIMEOUT_MS, ...(process.env.GEMINI_BASE_URL && { baseUrl: process.env.GEMINI_BASE_URL }) },
  });

  async function generate({ system, user, schema }) {
    let response;
    try {
      response = await client.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json", // reply with JSON only...
          responseJsonSchema: schema, // ...in exactly this shape
          maxOutputTokens: 8192,
        },
      });
    } catch (err) {
      const status = err.status;
      const text = String(err.message || "");
      // Google answers 400 (not 401) for a bad key, and 403 for a key that isn't allowed
      if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(text)) {
        throw new AIError("auth", text);
      }
      if (status === 429) throw new AIError("quota", text); // free-tier limit reached
      if (status === 500 || status === 503) throw new AIError("busy", text);
      throw new AIError("other", text);
    }

    if (response.promptFeedback?.blockReason) {
      throw new AIError("refused", `Prompt blocked: ${response.promptFeedback.blockReason}`);
    }
    const finish = response.candidates?.[0]?.finishReason;
    if (finish === "MAX_TOKENS") throw new AIError("truncated", "Gemini hit the output limit");
    if (finish && finish !== "STOP") throw new AIError("refused", `Gemini stopped: ${finish}`);

    try {
      return JSON.parse(response.text);
    } catch {
      throw new AIError("other", "Gemini returned text that isn't valid JSON");
    }
  }

  return { name: "gemini", label: "Google Gemini", model, freeTier: true, generate };
}

// ---------- Anthropic Claude ----------
function claudeProvider(apiKey) {
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });

  async function generate({ system, user, schema }) {
    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 3000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema } },
      });
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw new AIError("auth", err.message);
      if (err.status === 429) throw new AIError("quota", err.message);
      if (err.status === 529 || err.status >= 500) throw new AIError("busy", err.message);
      throw new AIError("other", err.message);
    }

    if (response.stop_reason === "refusal") throw new AIError("refused", "Claude declined");
    if (response.stop_reason === "max_tokens") throw new AIError("truncated", "Claude hit max_tokens");
    const text = response.content.find((block) => block.type === "text")?.text;
    try {
      return JSON.parse(text);
    } catch {
      throw new AIError("other", "Claude returned text that isn't valid JSON");
    }
  }

  return { name: "claude", label: "Anthropic Claude", model, freeTier: false, generate };
}

// ---------- Pick one ----------
function chooseProvider() {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const claudeKey = process.env.ANTHROPIC_API_KEY?.trim();
  const usable = (key) => key && !/your-.*-here/.test(key); // ignore the .env.example placeholder
  const wanted = (process.env.AI_PROVIDER || "").toLowerCase();

  if (wanted === "claude" && usable(claudeKey)) return claudeProvider(claudeKey);
  if (usable(geminiKey)) return geminiProvider(geminiKey);
  if (usable(claudeKey)) return claudeProvider(claudeKey);
  return null;
}

module.exports = { chooseProvider, AIError };
