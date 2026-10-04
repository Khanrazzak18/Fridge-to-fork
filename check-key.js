// Checks that your AI key works, without printing the key.
// Run with:  npm run check-key
// It sends one small test request (eggs, bread, tomato) to the AI.

const { chooseProvider } = require("../ai");
const { SYSTEM_PROMPT, RECIPE_SCHEMA, buildUserMessage, cleanReply } = require("../recipe-prompt");

const HELP = {
  auth: "The key was rejected. Copy it again from the website and save it in .env (no quotes, no spaces).",
  quota: "The key works, but its free limit is used up for now. Wait a minute (or until tomorrow) and try again.",
  busy: "The AI service is busy. Try again in a minute.",
  refused: "The AI declined the test request. Try again.",
  truncated: "The answer was cut off. Try again.",
  other: "Something else went wrong; the details are above.",
};

(async () => {
  const ai = chooseProvider();
  if (!ai) {
    console.log("✗ No key found.");
    console.log("  Put GEMINI_API_KEY=<your key> in the .env file in this folder, then run this again.");
    process.exit(1);
  }

  console.log(`Testing ${ai.label} (${ai.model})...`);
  const started = Date.now();
  try {
    const reply = await ai.generate({
      system: SYSTEM_PROMPT,
      user: buildUserMessage({ ingredients: ["eggs", "bread", "tomato"], diet: "none", maxTime: 15, servings: 1 }),
      schema: RECIPE_SCHEMA,
    });
    const data = cleanReply(reply);
    if (!data || data.recipes.length === 0) throw Object.assign(new Error("Reply had no recipes"), { kind: "other" });
    console.log(`✓ Your key works. Got ${data.recipes.length} recipes in ${((Date.now() - started) / 1000).toFixed(1)}s, e.g. "${data.recipes[0].title}".`);
    console.log("  Next: npm run dev, then open http://localhost:8080");
  } catch (err) {
    console.log(`✗ ${err.message}`);
    console.log(`  ${HELP[err.kind] || HELP.other}`);
    process.exit(1);
  }
})();
