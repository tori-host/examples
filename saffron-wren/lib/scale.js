// Rescaling a recipe, and writing each amount the way a cook would say it.
// The page's servings control, the server-rendered page and the JSON API all
// call this one module, so the browser and the API can never round the same
// ingredient two different ways. It is pure: no I/O, no clock, no globals.

export const MIN_SERVINGS = 1
export const MAX_SERVINGS = 48
export const SYSTEMS = ['metric', 'us']

const GRAMS_PER_OUNCE = 28.3495
const OUNCES_PER_POUND = 16
const ML_PER_US_CUP = 236.588
const ML_PER_US_QUART = 946.353
const ML_PER_US_TBSP = 14.787
const ML_PER_US_TSP = 4.929
// A metric spoon, for the one case where spoons turn into millilitres.
const ML_PER_TSP = 5
const TSP_PER_TBSP = 3
// More spoons than this is a measuring jug's job.
const MOST_TBSP = 4

/**
 * Servings as a visitor writes them, or null when it is not a whole number
 * in range. Strict on purpose: `2.5`, `1e1`, ` 4` and `0x10` are refused,
 * not read as whatever Number() would make of them.
 */
export function parseServings(raw) {
  if (typeof raw !== 'string' || !/^[0-9]{1,2}$/.test(raw)) return null
  const servings = Number(raw)
  return servings >= MIN_SERVINGS && servings <= MAX_SERVINGS ? servings : null
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b)
}

/** `count` parts of 1/`denominator`, written as a cook writes it: 1 1/2, 3/4, 2. */
export function fraction(count, denominator) {
  const whole = Math.floor(count / denominator)
  const rest = count % denominator
  if (rest === 0) return String(whole)
  const d = gcd(rest, denominator)
  const part = `${rest / d}/${denominator / d}`
  return whole === 0 ? part : `${whole} ${part}`
}

/**
 * `value` rounded to the nearest 1/`denominator`, and never to nothing: an
 * ingredient the recipe needs at all is still there for one serving.
 */
function parts(value, denominator) {
  return Math.max(1, Math.round(value * denominator))
}

const tidy = (value) => Math.round(value * 10000) / 10000

/** The unit in the answer is always the singular; only the text says "2 cups". */
function amount(count, denominator, unit, plural = unit) {
  const quantity = tidy(count / denominator)
  const written = fraction(count, denominator)
  const display = unit === null ? written : `${written} ${quantity > 1 ? plural : unit}`
  return { quantity, unit, display }
}

/**
 * Grams and millilitres: to the gram below 10, to 5 up to a kilogram (so
 * 125 g stays 125 g), and to 50 g above, written in kilograms.
 */
function decimal(value, small, large) {
  const quantity = value >= 10 ? Math.round(value / 5) * 5 : Math.max(1, Math.round(value))
  if (quantity < 1000) return { quantity, unit: small, display: `${quantity} ${small}` }
  const thousands = tidy((Math.round(value / 50) * 50) / 1000)
  return { quantity: thousands, unit: large, display: `${thousands} ${large}` }
}

function usMass(grams) {
  const ounces = grams / GRAMS_PER_OUNCE
  if (ounces >= OUNCES_PER_POUND) return amount(parts(ounces / OUNCES_PER_POUND, 4), 4, 'lb')
  return ounces >= 4 ? amount(parts(ounces, 2), 2, 'oz') : amount(parts(ounces, 4), 4, 'oz')
}

/** US volume: quarts, then cups in quarters or thirds, then spoons. */
function usVolume(ml) {
  const cups = ml / ML_PER_US_CUP
  if (cups >= 4) return amount(parts(ml / ML_PER_US_QUART, 4), 4, 'qt')
  if (cups >= 0.25) {
    // 1/3 and 2/3 cup are on every set of measuring cups, so they compete with
    // the quarters; on a tie the quarter wins.
    const quarters = Math.round(cups * 4)
    const thirds = Math.round(cups * 3)
    return Math.abs(thirds / 3 - cups) < Math.abs(quarters / 4 - cups)
      ? amount(thirds, 3, 'cup', 'cups')
      : amount(quarters, 4, 'cup', 'cups')
  }
  const tbsp = ml / ML_PER_US_TBSP
  if (tbsp >= 1) return amount(parts(tbsp, 2), 2, 'tbsp')
  return spoonTsp(ml / ML_PER_US_TSP)
}

function spoonTsp(tsp) {
  // Quarter teaspoons, and the 1/8 spoon below that.
  return tsp < 0.25 ? amount(1, 8, 'tsp') : amount(parts(tsp, 4), 4, 'tsp')
}

/** Spoons stay spoons in both systems, up to the point where a jug is easier. */
function spoons(tsp, system) {
  if (tsp / TSP_PER_TBSP > MOST_TBSP) {
    const ml = tsp * ML_PER_TSP
    return system === 'us' ? usVolume(ml) : decimal(ml, 'ml', 'l')
  }
  if (tsp >= TSP_PER_TBSP) return amount(parts(tsp / TSP_PER_TBSP, 2), 2, 'tbsp')
  return spoonTsp(tsp)
}

/**
 * One ingredient, multiplied by `factor` and written in `system`. Returns the
 * rounded number in the unit it is shown in, that unit, the text a cook reads
 * and the ingredient's name (singular for one egg, plural for two).
 */
export function scaleIngredient(ingredient, factor, system = 'metric') {
  const { qty, unit } = ingredient
  let scaled
  if (unit === 'to taste') {
    scaled = { quantity: null, unit: null, display: 'to taste' }
  } else if (unit === 'g') {
    scaled = system === 'us' ? usMass(qty * factor) : decimal(qty * factor, 'g', 'kg')
  } else if (unit === 'ml') {
    scaled = system === 'us' ? usVolume(qty * factor) : decimal(qty * factor, 'ml', 'l')
  } else if (unit === 'tsp' || unit === 'tbsp') {
    scaled = spoons(qty * factor * (unit === 'tbsp' ? TSP_PER_TBSP : 1), system)
  } else if (unit === 'pinch') {
    scaled = amount(parts(qty * factor, 1), 1, 'pinch', 'pinches')
  } else if (unit === 'whole') {
    // Eggs come whole; a lemon or an onion can be halved.
    const per = Math.round(1 / (ingredient.step ?? 1))
    scaled = amount(parts(qty * factor, per), per, null)
  } else {
    throw new Error(`unknown unit: ${unit}`)
  }
  const one = unit === 'whole' && scaled.quantity <= 1 && ingredient.one
  return { name: one || ingredient.name, ...scaled }
}

/** Oven temperature: Celsius as written, Fahrenheit at the 25° steps US ovens are dialled in. */
export function ovenTemperature(celsius, system = 'metric') {
  if (system !== 'us') return `${celsius} °C`
  const fahrenheit = (celsius * 9) / 5 + 32
  return `${Math.round(fahrenheit / 25) * 25} °F`
}

/** The whole recipe for `servings` people, in `system` units. */
export function scaleRecipe(recipe, servings, system = 'metric') {
  if (!Number.isInteger(servings) || servings < MIN_SERVINGS || servings > MAX_SERVINGS) {
    throw new RangeError(`servings must be a whole number from ${MIN_SERVINGS} to ${MAX_SERVINGS}`)
  }
  if (!SYSTEMS.includes(system)) throw new RangeError(`system must be one of ${SYSTEMS.join(', ')}`)
  const factor = servings / recipe.servings
  return {
    slug: recipe.slug,
    title: recipe.title,
    servings,
    system,
    oven: recipe.oven ? ovenTemperature(recipe.oven, system) : null,
    ingredients: recipe.ingredients.map((ingredient) => scaleIngredient(ingredient, factor, system)),
  }
}
