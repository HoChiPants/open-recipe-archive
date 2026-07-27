export const personalDataVersion = "1.0.0" as const;
export const personalDataStorageKey = "open-recipe-archive-personal-data";

export type MealPlanItem = {
  id: string;
  recipe_id: string;
  day: string;
  position: number;
  target_servings?: number;
  note?: string;
  completed?: boolean;
};

export type PersonalData = {
  schema_version: typeof personalDataVersion;
  exported_at?: string;
  preferences: {
    dietary: string[];
    default_servings?: number;
    filters: { meal_type: string; season: string; dietary: string };
  };
  meal_plans: Array<{
    id: string;
    name: string;
    items: MealPlanItem[];
  }>;
  cookbooks: Array<{
    id: string;
    name: string;
    description?: string;
    recipe_ids: string[];
  }>;
  imported_recipes: unknown[];
};

export function emptyPersonalData(): PersonalData {
  return {
    schema_version: personalDataVersion,
    preferences: {
      dietary: [],
      filters: { meal_type: "all", season: "all", dietary: "all" },
    },
    meal_plans: [{ id: "weekly-plan", name: "Weekly meal plan", items: [] }],
    cookbooks: [],
    imported_recipes: [],
  };
}

export function isPersonalData(value: unknown): value is PersonalData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<PersonalData>;
  const preferences = data.preferences as PersonalData["preferences"] | undefined;
  return (
    data.schema_version === personalDataVersion &&
    Boolean(
      preferences &&
      typeof preferences === "object" &&
      Array.isArray(preferences.dietary) &&
      preferences.filters &&
      typeof preferences.filters.meal_type === "string" &&
      typeof preferences.filters.season === "string" &&
      typeof preferences.filters.dietary === "string",
    ) &&
    Array.isArray(data.meal_plans) &&
    data.meal_plans.every((plan) =>
      Boolean(plan && typeof plan.id === "string" && typeof plan.name === "string" && Array.isArray(plan.items)),
    ) &&
    Array.isArray(data.cookbooks) &&
    Array.isArray(data.imported_recipes)
  );
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
