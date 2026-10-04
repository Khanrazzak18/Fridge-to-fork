// Fridge to Fork: frontend logic
// ------------------------------------------------------------
// Keeps the list of ingredients, sends it to our backend at
// POST /api/recipes, and draws the recipes that come back.
// AI output is only ever inserted with textContent (never innerHTML),
// so nothing the model writes can run as code in the page.

const MAX_INGREDIENTS = 20;
const MAX_LENGTH = 40;
const EXAMPLE = ["chicken thighs", "rice", "broccoli", "garlic", "soy sauce", "eggs"];

const form = document.getElementById("recipe-form");
const input = document.getElementById("ingredient-input");
const addBtn = document.getElementById("add-btn");
const chipList = document.getElementById("chips");
const chipsEmpty = document.getElementById("chips-empty");
const exampleBtn = document.getElementById("example-btn");
const clearBtn = document.getElementById("clear-btn");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const results = document.getElementById("results");
const cardTemplate = document.getElementById("card-template");

let ingredients = [];

// ---------- Status line ----------
function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

// ---------- Ingredient chips ----------
function renderChips() {
  chipList.replaceChildren(
    ...ingredients.map((name) => {
      const li = document.createElement("li");
      li.className = "chip";
      const label = document.createElement("span");
      label.textContent = name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${name}`);
      remove.addEventListener("click", () => {
        ingredients = ingredients.filter((i) => i !== name);
        renderChips();
        input.focus();
      });
      li.append(label, remove);
      return li;
    })
  );
  chipsEmpty.hidden = ingredients.length > 0;
}

function addFromInput() {
  const parts = input.value.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) {
    setStatus("Type an ingredient, then press Add.", true);
    return;
  }
  for (const part of parts) {
    if (part.length > MAX_LENGTH) {
      setStatus(`"${part.slice(0, 20)}…" is too long. Keep each ingredient under ${MAX_LENGTH} characters.`, true);
      return;
    }
    if (ingredients.length >= MAX_INGREDIENTS) {
      setStatus(`That's the limit of ${MAX_INGREDIENTS} ingredients.`, true);
      break;
    }
    if (!ingredients.includes(part)) ingredients.push(part);
  }
  input.value = "";
  if (!statusEl.classList.contains("is-error")) setStatus("");
  renderChips();
}

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault(); // Enter adds an ingredient instead of submitting
    addFromInput();
  }
});
input.addEventListener("input", () => {
  if (statusEl.classList.contains("is-error")) setStatus("");
});
addBtn.addEventListener("click", () => {
  setStatus("");
  addFromInput();
  input.focus();
});

exampleBtn.addEventListener("click", () => {
  ingredients = [...EXAMPLE];
  renderChips();
  setStatus("Example ingredients added. Press Find recipes.");
});

clearBtn.addEventListener("click", () => {
  ingredients = [];
  input.value = "";
  renderChips();
  results.replaceChildren();
  results.hidden = true;
  setStatus("Cleared.");
  input.focus();
});

// ---------- Recipe cards ----------
function makeCard(recipe, servings) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector(".card-title").textContent = recipe.title;
  card.querySelector(".card-meta").textContent = recipeMeta(recipe, servings);
  card.querySelector(".card-desc").textContent = recipe.description;
  card.querySelector(".card-uses").textContent = recipe.ingredients_used.join(", ");

  const extra = card.querySelector(".card-extra");
  const extraLabel = card.querySelector(".card-extra-label");
  if (recipe.extra_ingredients.length) {
    extra.textContent = recipe.extra_ingredients.join(", ");
  } else {
    extraLabel.remove();
    extra.remove();
  }

  card.querySelector(".card-steps").replaceChildren(
    ...recipe.steps.map((step) => {
      const li = document.createElement("li");
      li.textContent = step;
      return li;
    })
  );

  const allergens = card.querySelector(".card-allergens");
  const allergenLabel = document.createElement("strong");
  allergenLabel.textContent = "Allergens: ";
  allergens.append(allergenLabel, recipe.allergens.length ? recipe.allergens.join(", ") : "none listed, but check labels");

  const tip = card.querySelector(".card-tip");
  if (recipe.tip) {
    const tipLabel = document.createElement("strong");
    tipLabel.textContent = "Tip: ";
    tip.append(tipLabel, recipe.tip);
  } else {
    tip.remove();
  }

  const copyBtn = card.querySelector(".copy-btn");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(recipeAsText(recipe, servings));
      copyBtn.textContent = "Copied";
    } catch {
      copyBtn.textContent = "Copy failed";
    }
    setTimeout(() => (copyBtn.textContent = "Copy recipe"), 2000);
  });
  return card;
}

function recipeMeta(recipe, servings) {
  const time = recipe.time_minutes ? `${recipe.time_minutes} minutes, ` : "";
  return `${time}${recipe.difficulty.toLowerCase()}, serves ${servings}`;
}

function recipeAsText(recipe, servings) {
  return [
    recipe.title,
    recipeMeta(recipe, servings),
    "",
    `Uses: ${recipe.ingredients_used.join(", ")}`,
    recipe.extra_ingredients.length ? `Also need: ${recipe.extra_ingredients.join(", ")}` : "",
    "",
    ...recipe.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `Allergens: ${recipe.allergens.join(", ") || "none listed"}`,
    recipe.tip ? `Tip: ${recipe.tip}` : "",
    "",
    "AI-generated by Fridge to Fork. Double-check allergens and cooking temperatures.",
  ].filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");
}

function showLoadingCards() {
  results.hidden = false;
  results.setAttribute("aria-busy", "true");
  results.replaceChildren(
    ...[1, 2, 3].map((n) => {
      const card = document.createElement("article");
      card.className = "card is-loading";
      card.innerHTML = `<div class="card-head"><h2 class="card-title">Writing recipe ${n}…</h2></div><div class="card-body"></div>`;
      return card;
    })
  );
}

// ---------- Ask the backend for recipes ----------
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (input.value.trim()) addFromInput(); // include anything still in the box

  if (ingredients.length === 0) {
    setStatus("Add at least one ingredient first.", true);
    input.focus();
    return;
  }

  const servings = Number(document.getElementById("servings").value);
  const payload = {
    ingredients,
    diet: document.getElementById("diet").value,
    maxTime: Number(document.getElementById("max-time").value),
    servings,
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Finding recipes…";
  setStatus("The AI is writing your recipes. This takes a few seconds.");
  showLoadingCards();

  try {
    const response = await fetch("/api/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `The server returned an error (${response.status}).`);
    }

    if (data.status === "not_food" || data.recipes.length === 0) {
      const note = document.createElement("p");
      note.className = "results-message";
      note.textContent = data.message || "Those don't look like ingredients. Try foods you have at home.";
      results.replaceChildren(note);
      setStatus("No recipes this time.", true);
      return;
    }

    results.replaceChildren(...data.recipes.map((r) => makeCard(r, data.servings)));
    const count = data.recipes.length;
    setStatus(data.message || (count === 1 ? "Here's 1 recipe." : `Here are ${count} recipes.`));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    results.querySelector(".card")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  } catch (err) {
    results.replaceChildren();
    results.hidden = true;
    const offline = err instanceof TypeError; // fetch throws TypeError when the network fails
    setStatus(offline ? "Couldn't reach the server. Check your connection and try again." : err.message, true);
  } finally {
    results.removeAttribute("aria-busy");
    submitBtn.disabled = false;
    submitBtn.textContent = "Find recipes";
  }
});

// ---------- Show which AI is in use (from the server's /health check) ----------
async function showAIInfo() {
  try {
    const info = await (await fetch("/health")).json();
    if (info.aiConfigured) {
      document.getElementById("ai-name").textContent = `${info.providerLabel} (${info.model})`;
      document.getElementById("free-tier-note").hidden = !info.freeTier;
    }
  } catch {
    // Not critical: the footer keeps its generic wording
  }
}

renderChips();
showAIInfo();
