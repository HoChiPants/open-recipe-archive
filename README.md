# Open Recipe Archive

A portable recipe library where every recipe and ingredient is plain JSON. Clone it, search it in the included browser app, use the generated catalog in another project, or contribute a recipe without depending on a hosted database.

The repository starts small on purpose: the data model and contribution tools are designed to support a much larger community collection.

## Start the library

You need Node.js 22 or newer.

```bash
npm install
npm start
```

Open the local address shown in the terminal. The app can:

- search by title, tag, cuisine, or ingredient;
- filter by meal type, dietary flag, and season;
- scale ingredient quantities for a different number of servings;
- build a weekly meal plan saved in the browser;
- import a recipe JSON file for device-local browsing;
- download individual recipes or the complete generated catalog;
- browse the canonical ingredient reference.

Browser imports and meal plans stay on that device. To add a recipe to the shared library, add its JSON file to the repository and open a pull request.

## Repository layout

```text
recipes/                 one recipe per file, grouped by meal type
ingredients/             canonical ingredient records and seasonality
schemas/                 JSON Schema contracts for recipes and ingredients
scripts/                 validation, catalog generation, and scaffolding tools
public/data/catalog.json generated portable catalog used by other apps
app/                     the searchable local website
docs/                    schema and content guidance
```

## Add a recipe

Create a ready-to-edit file:

```bash
npm run recipe:new -- --name "Crispy roast potatoes" --type side
```

Then edit the new JSON file and check it:

```bash
npm run data:validate
```

The required recipe fields are:

- `schema_version`, `id`, and `name`
- `meal_type`
- `yield` and `times`
- `ingredients` and `instructions`
- `tags`

Useful optional fields include `subtitle`, `description`, `cuisine`, `nutrition`, `seasons`, `dietary`, `allergens`, `equipment`, `source`, and `notes`. See [the schema guide](docs/SCHEMA.md) and [the complete JSON Schema](schemas/recipe.schema.json).

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Validate the data, rebuild the catalog, and start the website |
| `npm run data:validate` | Check schemas, unique IDs, step order, and ingredient references |
| `npm run catalog:build` | Rebuild the TypeScript and public JSON catalogs |
| `npm run recipe:new -- --name "…" --type main` | Scaffold a recipe file |
| `npm run build` | Produce a deployment build |
| `npm test` | Validate data, build the app, and run rendering checks |

## Use the catalog elsewhere

After `npm run catalog:build`, `public/data/catalog.json` contains:

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-07-14T00:00:00.000Z",
  "recipes": [],
  "ingredients": []
}
```

Consumers should depend on `schema_version`, not the generated timestamp or file order. Recipe and ingredient IDs are stable lookup keys.

## Licensing and recipe sources

Code is available under the MIT License. Original repository data is dedicated to the public domain under CC0 1.0; contributors must have the right to make that dedication.

A recipe's ingredient list and underlying procedure may not be protected by U.S. copyright, but expressive descriptions, photographs, and creative instructional text can be. Do not copy a cookbook page or food blog verbatim. Use your own concise wording and record the source when adapting an idea. Read [the content policy](docs/CONTENT_POLICY.md) before contributing.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), keep each recipe in its own file, add canonical ingredients when useful, and run `npm test` before opening a pull request.
