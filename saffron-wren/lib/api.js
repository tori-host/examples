// What GET /api/recipes/[slug] answers, apart from Next: a status and a body
// for a slug and the query string. The route handler only sends it, so the
// tests can check every refusal without starting a server.
import { findRecipe } from './recipes.js'
import { MAX_SERVINGS, MIN_SERVINGS, SYSTEMS, parseServings, scaleRecipe } from './scale.js'

export function recipeAnswer(slug, searchParams) {
  const recipe = findRecipe(slug)
  // The answers never repeat what was asked: the slug and the numbers in them
  // come from the recipe, not from the URL.
  if (!recipe) return { status: 404, body: { error: 'There is no recipe by that name.' } }

  const rawServings = searchParams.get('servings')
  const servings = rawServings === null ? recipe.servings : parseServings(rawServings)
  if (servings === null) {
    return { status: 400, body: { error: `servings must be a whole number from ${MIN_SERVINGS} to ${MAX_SERVINGS}.` } }
  }
  const units = searchParams.get('units') ?? 'metric'
  if (!SYSTEMS.includes(units)) return { status: 400, body: { error: `units must be one of: ${SYSTEMS.join(', ')}.` } }

  return { status: 200, body: scaleRecipe(recipe, servings, units) }
}
