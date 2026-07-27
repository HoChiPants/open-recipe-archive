"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { catalog } from "./generated/catalog";
import {
  downloadJson,
  emptyPersonalData,
  isPersonalData,
  MealPlanItem,
  PersonalData,
  personalDataStorageKey,
} from "./personal-data";

type RecipeIngredient = {
  ingredient_id?: string;
  item: string;
  quantity?: number | string;
  unit?: string;
  preparation?: string;
  optional?: boolean;
};

type Recipe = {
  schema_version: string;
  id: string;
  name: string;
  subtitle?: string;
  description?: string;
  meal_type: string;
  cuisine?: string;
  yield: { quantity: number; unit: string };
  times: { prep_minutes: number; cook_minutes: number; inactive_minutes?: number };
  ingredients: RecipeIngredient[];
  instructions: { step: number; text: string; timer_minutes?: number }[];
  tags: string[];
  seasons?: string[];
  dietary?: string[];
  allergens?: string[];
  equipment?: string[];
  notes?: string[];
  nutrition?: Record<string, string | number>;
  source?: { name: string; url?: string; adapted?: boolean; license?: string };
};

type Ingredient = {
  id: string;
  name: string;
  aliases?: string[];
  categories: string[];
  seasons: string[];
  default_unit?: string;
  storage?: { method?: string; typical_days?: number };
  allergens?: string[];
};

type View = "recipes" | "plan" | "ingredients";
const builtInRecipes = catalog.recipes as unknown as Recipe[];
const builtInIngredients = catalog.ingredients as unknown as Ingredient[];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const typeLabels: Record<string, string> = {
  breakfast: "Breakfast",
  main: "Main",
  side: "Side",
  salad: "Salad",
  soup: "Soup",
  sandwich: "Sandwich",
  dessert: "Dessert",
  snack: "Snack",
  drink: "Drink",
  sauce: "Sauce",
  "baked-good": "Baked good",
  other: "Other",
};

function totalMinutes(recipe: Recipe) {
  return recipe.times.prep_minutes + recipe.times.cook_minutes + (recipe.times.inactive_minutes ?? 0);
}

function formatQuantity(value: number | string | undefined, scale: number) {
  if (value === undefined) return "";
  if (typeof value === "string") {
    const fraction = value.match(/^(\d+)\/(\d+)$/);
    if (!fraction || scale === 1) return value;
    return `${Math.round((Number(fraction[1]) / Number(fraction[2])) * scale * 100) / 100}`;
  }
  return `${Math.round(value * scale * 100) / 100}`;
}

function isRecipe(value: unknown): value is Recipe {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Recipe>;
  return Boolean(
    candidate.id &&
      candidate.name &&
      candidate.meal_type &&
      candidate.yield &&
      candidate.times &&
      Array.isArray(candidate.ingredients) &&
      Array.isArray(candidate.instructions) &&
      Array.isArray(candidate.tags),
  );
}

export function RecipeLibrary() {
  const [view, setView] = useState<View>("recipes");
  const [query, setQuery] = useState("");
  const [mealType, setMealType] = useState("all");
  const [season, setSeason] = useState("all");
  const [dietary, setDietary] = useState("all");
  const [selectedId, setSelectedId] = useState(builtInRecipes[0]?.id ?? "");
  const [servings, setServings] = useState(builtInRecipes[0]?.yield.quantity ?? 1);
  const [selectedDay, setSelectedDay] = useState("Monday");
  const [personalData, setPersonalData] = useState<PersonalData>(emptyPersonalData);
  const [notice, setNotice] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = localStorage.getItem(personalDataStorageKey);
        if (saved) {
          const value = JSON.parse(saved);
          if (isPersonalData(value) && value.imported_recipes.every(isRecipe)) {
            setPersonalData(value);
            setMealType(value.preferences.filters.meal_type);
            setSeason(value.preferences.filters.season);
            setDietary(value.preferences.filters.dietary);
          }
        } else {
          const legacyPlan = JSON.parse(localStorage.getItem("open-recipe-archive-plan") ?? "null");
          const legacyRecipes = JSON.parse(localStorage.getItem("open-recipe-archive-imports") ?? "[]");
          if (legacyPlan || legacyRecipes.length) {
            const migrated = emptyPersonalData();
            migrated.imported_recipes = legacyRecipes;
            migrated.meal_plans[0].items = days.flatMap((day) =>
              (legacyPlan?.[day] ?? []).map((recipeId: string, position: number) => ({
                id: `${day.toLowerCase()}-${position}-${recipeId}`,
                recipe_id: recipeId,
                day,
                position,
              })),
            );
            setPersonalData(migrated);
          }
        }
      } catch {
        setNotice("Saved browser data could not be read and was left unchanged.");
      } finally {
        setHydrated(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(personalDataStorageKey, JSON.stringify(personalData));
  }, [hydrated, personalData]);

  const imported = personalData.imported_recipes as Recipe[];
  const planItems = personalData.meal_plans[0]?.items ?? [];

  const recipes = useMemo(() => {
    const byId = new Map<string, Recipe>();
    [...builtInRecipes, ...imported].forEach((recipe) => byId.set(recipe.id, recipe));
    return [...byId.values()];
  }, [imported]);

  const filteredRecipes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return recipes.filter((recipe) => {
      const searchable = [
        recipe.name,
        recipe.subtitle,
        recipe.description,
        recipe.cuisine,
        ...recipe.tags,
        ...recipe.ingredients.map((item) => item.item),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (
        (!needle || searchable.includes(needle)) &&
        (mealType === "all" || recipe.meal_type === mealType) &&
        (season === "all" || recipe.seasons?.includes(season)) &&
        (dietary === "all" || recipe.dietary?.includes(dietary))
      );
    });
  }, [recipes, query, mealType, season, dietary]);

  const selected = recipes.find((recipe) => recipe.id === selectedId) ?? filteredRecipes[0] ?? recipes[0];
  const scale = selected ? servings / selected.yield.quantity : 1;

  function chooseRecipe(recipe: Recipe) {
    setSelectedId(recipe.id);
    setServings(recipe.yield.quantity);
  }

  function updateFilters(next: Partial<PersonalData["preferences"]["filters"]>) {
    if (next.meal_type !== undefined) setMealType(next.meal_type);
    if (next.season !== undefined) setSeason(next.season);
    if (next.dietary !== undefined) setDietary(next.dietary);
    setPersonalData((current) => ({
      ...current,
      preferences: { ...current.preferences, filters: { ...current.preferences.filters, ...next } },
    }));
  }

  function addToPlan(recipe: Recipe) {
    setPersonalData((current) => {
      const plan = current.meal_plans[0] ?? { id: "weekly-plan", name: "Weekly meal plan", items: [] };
      const position = plan.items.filter((item) => item.day === selectedDay).length;
      const item: MealPlanItem = {
        id: crypto.randomUUID(),
        recipe_id: recipe.id,
        day: selectedDay,
        position,
        target_servings: servings,
      };
      return { ...current, meal_plans: [{ ...plan, items: [...plan.items, item] }, ...current.meal_plans.slice(1)] };
    });
    setNotice(`${recipe.name} added to ${selectedDay}.`);
  }

  function removeFromPlan(itemId: string) {
    setPersonalData((current) => ({
      ...current,
      meal_plans: current.meal_plans.map((plan, index) =>
        index === 0 ? { ...plan, items: plan.items.filter((item) => item.id !== itemId) } : plan,
      ),
    }));
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      if (isPersonalData(value)) {
        if (!value.imported_recipes.every(isRecipe)) throw new Error("invalid imported recipes");
        setPersonalData(value);
        setMealType(value.preferences.filters.meal_type);
        setSeason(value.preferences.filters.season);
        setDietary(value.preferences.filters.dietary);
        setNotice("Personal archive restored on this device.");
        return;
      }
      const candidates = Array.isArray(value) ? value : value.recipes && Array.isArray(value.recipes) ? value.recipes : [value];
      if (!candidates.every(isRecipe)) throw new Error("missing required fields");
      setPersonalData((current) => {
        const merged = new Map((current.imported_recipes as Recipe[]).map((recipe) => [recipe.id, recipe]));
        candidates.forEach((recipe: Recipe) => merged.set(recipe.id, recipe));
        return { ...current, imported_recipes: [...merged.values()] };
      });
      chooseRecipe(candidates[0]);
      setView("recipes");
      setNotice(`Imported ${candidates.length} recipe${candidates.length === 1 ? "" : "s"} on this device.`);
    } catch {
      setNotice("That file is not a valid recipe or recipe catalog. Run the repository validator for detailed errors.");
    }
  }

  function downloadRecipe(recipe: Recipe) {
    downloadJson(`${recipe.id}.json`, recipe);
  }

  function downloadPersonalData() {
    downloadJson("open-recipe-archive-personal.json", { ...personalData, exported_at: new Date().toISOString() });
    setNotice("Personal archive downloaded. Keep it private if it contains personal notes.");
  }

  function clearPlan() {
    setPersonalData((current) => ({
      ...current,
      meal_plans: current.meal_plans.map((plan, index) => index === 0 ? { ...plan, items: [] } : plan),
    }));
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => setView("recipes")} aria-label="Open recipe archive home">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span>Open Recipe Archive</span>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={view === "recipes" ? "active" : ""} onClick={() => setView("recipes")}>Recipes</button>
          <button className={view === "plan" ? "active" : ""} onClick={() => setView("plan")}>Meal plan</button>
          <button className={view === "ingredients" ? "active" : ""} onClick={() => setView("ingredients")}>Ingredients</button>
        </nav>
        <div className="header-actions">
          <input ref={fileInput} type="file" accept="application/json,.json" onChange={importJson} hidden />
          <button className="secondary-button" onClick={() => fileInput.current?.click()}>Import or restore</button>
          <a className="primary-button" href="/data/catalog.json" download>Download catalog</a>
        </div>
      </header>

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss message">×</button>
        </div>
      )}

      {view === "recipes" && (
        <main className="recipe-layout">
          <aside className="filters" aria-label="Recipe filters">
            <div className="filter-heading">
              <h1>Recipes</h1>
              <span>{filteredRecipes.length} of {recipes.length}</span>
            </div>
            <label>
              Search
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, tag, ingredient…" />
            </label>
            <label>
              Meal type
              <select value={mealType} onChange={(event) => updateFilters({ meal_type: event.target.value })}>
                <option value="all">All types</option>
                {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Season
              <select value={season} onChange={(event) => updateFilters({ season: event.target.value })}>
                <option value="all">Any season</option>
                <option value="spring">Spring</option><option value="summer">Summer</option>
                <option value="fall">Fall</option><option value="winter">Winter</option><option value="year-round">Year-round</option>
              </select>
            </label>
            <label>
              Dietary
              <select value={dietary} onChange={(event) => updateFilters({ dietary: event.target.value })}>
                <option value="all">No preference</option>
                <option value="vegetarian">Vegetarian</option><option value="vegan">Vegan</option>
                <option value="gluten-free">Gluten-free</option><option value="dairy-free">Dairy-free</option>
              </select>
            </label>
            <button className="text-button" onClick={() => { setQuery(""); updateFilters({ meal_type: "all", season: "all", dietary: "all" }); }}>Clear filters</button>
          </aside>

          <section className="recipe-results" aria-label="Recipe results">
            {filteredRecipes.length ? filteredRecipes.map((recipe) => (
              <button key={recipe.id} className={`recipe-row ${selected?.id === recipe.id ? "selected" : ""}`} onClick={() => chooseRecipe(recipe)}>
                <span className={`type-icon type-${recipe.meal_type}`} aria-hidden="true">{recipe.meal_type.slice(0, 1).toUpperCase()}</span>
                <span className="recipe-row-copy">
                  <strong>{recipe.name}</strong>
                  <span>{recipe.subtitle || typeLabels[recipe.meal_type]}</span>
                </span>
                <span className="recipe-row-meta">{totalMinutes(recipe)} min</span>
              </button>
            )) : <div className="empty-state">No recipes match those filters.</div>}
          </section>

          {selected && (
            <article className="recipe-detail">
              <div className="detail-topline">
                <span>{typeLabels[selected.meal_type]}{selected.cuisine ? ` · ${selected.cuisine}` : ""}</span>
                <button className="text-button" onClick={() => downloadRecipe(selected)}>Download JSON</button>
              </div>
              <h2>{selected.name}</h2>
              {selected.subtitle && <p className="subtitle">{selected.subtitle}</p>}
              {selected.description && <p className="description">{selected.description}</p>}
              <dl className="recipe-facts">
                <div><dt>Prep</dt><dd>{selected.times.prep_minutes} min</dd></div>
                <div><dt>Cook</dt><dd>{selected.times.cook_minutes} min</dd></div>
                <div><dt>Total</dt><dd>{totalMinutes(selected)} min</dd></div>
                <div><dt>Yield</dt><dd>{selected.yield.quantity} {selected.yield.unit}</dd></div>
              </dl>
              <div className="plan-controls">
                <label>Day<select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}>{days.map((day) => <option key={day}>{day}</option>)}</select></label>
                <button className="primary-button" onClick={() => addToPlan(selected)}>Add to meal plan</button>
              </div>
              <section className="detail-section">
                <div className="section-title">
                  <h3>Ingredients</h3>
                  <label>Servings<input type="number" min="1" max="100" value={servings} onChange={(event) => setServings(Math.max(1, Number(event.target.value)))} /></label>
                </div>
                <ul className="ingredient-list">
                  {selected.ingredients.map((item, index) => (
                    <li key={`${item.item}-${index}`}><span>{formatQuantity(item.quantity, scale)} {item.unit}</span><span>{item.item}{item.preparation ? `, ${item.preparation}` : ""}{item.optional ? " (optional)" : ""}</span></li>
                  ))}
                </ul>
              </section>
              <section className="detail-section">
                <h3>Instructions</h3>
                <ol className="instruction-list">
                  {selected.instructions.map((instruction) => <li key={instruction.step}><span>{instruction.step}</span><p>{instruction.text}{instruction.timer_minutes ? <em>{instruction.timer_minutes} min</em> : null}</p></li>)}
                </ol>
              </section>
              <div className="tag-list">{selected.tags.map((tag) => <span key={tag}>{tag.replaceAll("-", " ")}</span>)}</div>
              {selected.allergens && selected.allergens.length > 0 && <p className="allergen-note"><strong>Contains:</strong> {selected.allergens.join(", ")}</p>}
              {selected.notes && <section className="detail-section"><h3>Notes</h3>{selected.notes.map((note) => <p key={note} className="note-copy">{note}</p>)}</section>}
            </article>
          )}
        </main>
      )}

      {view === "plan" && (
        <main className="content-page">
          <div className="page-title"><div><h1>Meal plan</h1><p>Saved on this device. Download a backup to move it or keep it with a private project.</p></div><div className="page-actions"><button className="secondary-button" onClick={downloadPersonalData}>Download personal data</button><button className="text-button" onClick={clearPlan}>Clear week</button></div></div>
          <div className="week-grid">
            {days.map((day) => (
              <section className="day-column" key={day}>
                <h2>{day}</h2>
                {planItems.some((item) => item.day === day) ? planItems.filter((item) => item.day === day).sort((a, b) => a.position - b.position).map((item) => {
                  const recipe = recipes.find((recipe) => recipe.id === item.recipe_id);
                  return recipe ? <div className="planned-recipe" key={item.id}><button onClick={() => { chooseRecipe(recipe); setView("recipes"); }}>{recipe.name}{item.target_servings ? <span>{item.target_servings} servings</span> : null}</button><button aria-label={`Remove ${recipe.name} from ${day}`} onClick={() => removeFromPlan(item.id)}>×</button></div> : null;
                }) : <p>No recipes yet</p>}
              </section>
            ))}
          </div>
        </main>
      )}

      {view === "ingredients" && (
        <main className="content-page">
          <div className="page-title"><div><h1>Ingredient reference</h1><p>{builtInIngredients.length} canonical ingredients for consistent recipe data.</p></div></div>
          <div className="ingredient-grid">
            {builtInIngredients.map((ingredient) => (
              <article className="ingredient-card" key={ingredient.id}>
                <h2>{ingredient.name}</h2>
                <p>{ingredient.categories.join(" · ")}</p>
                <dl><div><dt>Season</dt><dd>{ingredient.seasons.join(", ")}</dd></div>{ingredient.default_unit && <div><dt>Default unit</dt><dd>{ingredient.default_unit}</dd></div>}</dl>
                {ingredient.storage?.method && <p className="storage-copy">{ingredient.storage.method}</p>}
              </article>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
