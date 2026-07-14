# Data model

Version `1.0.0` favors three goals: a recipe should be readable by itself, records should be easy to validate, and downstream apps should have stable IDs to join on.

## Recipe identity

`id` is a permanent lowercase kebab-case identifier. A file may move between folders without changing its ID. `name` is the display title and may be edited. `subtitle` is optional supporting context, not a second identifier.

## Classification

`meal_type` is a controlled, single-value field for dependable filtering. It answers the broad question “what kind of item is this?” Tags are open-ended and describe technique, use, or character. A grilled cheese is therefore `meal_type: "sandwich"` and may have tags such as `"quick"` and `"comfort-food"`.

Seasons describe when a complete recipe is most appropriate. Ingredient records separately describe the seasonality of individual foods.

## Ingredients

Every entry requires a readable `item`. `ingredient_id` is optional but recommended when the canonical ingredient exists. This duplication is intentional: the recipe remains portable while the ID enables reliable searching and future shopping-list features.

Quantities can be numbers or simple strings. Numbers scale automatically in the website. Familiar fractions may be strings when that keeps source JSON readable.

## Instructions

Instructions are objects rather than strings so they can carry a stable step number and optional timer. Steps begin at 1 and must not have gaps.

## Nutrition

Nutrition is optional. Values are per the stated `serving_size`; include a short `source`, such as a named calculator or `"Estimated"`. The data is informational and not medical advice.

## Compatibility

Consumers should reject unsupported major schema versions. New optional fields may be introduced in minor versions. Removing or changing a required field requires a major version.
