// The scaling module and the API's answers, without Next: these run in a
// fraction of a second. test/server.test.mjs checks the built server.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recipeAnswer } from '../lib/api.js'
import { RECIPES, findRecipe } from '../lib/recipes.js'
import {
  MAX_SERVINGS,
  MIN_SERVINGS,
  fraction,
  ovenTemperature,
  parseServings,
  scaleIngredient,
  scaleRecipe,
} from '../lib/scale.js'

const display = (ingredient, factor, system) => scaleIngredient(ingredient, factor, system).display
const query = (text) => new URLSearchParams(text)

test('servings are a whole number from 1 to 48, and nothing else', () => {
  assert.equal(parseServings('1'), 1)
  assert.equal(parseServings('48'), 48)
  assert.equal(parseServings('7'), 7)
  for (const refused of ['0', '49', '99', '100', '-1', '2.5', '1e1', '0x10', ' 4', '4 ', '+4', '', 'four', '١٢']) {
    assert.equal(parseServings(refused), null, JSON.stringify(refused))
  }
  assert.equal(parseServings(undefined), null)
  assert.equal(parseServings(4), null, 'only text from a URL is parsed')
})

test('fractions are written the way a cook writes them', () => {
  assert.equal(fraction(2, 4), '1/2')
  assert.equal(fraction(6, 4), '1 1/2')
  assert.equal(fraction(8, 4), '2')
  assert.equal(fraction(2, 3), '2/3')
  assert.equal(fraction(1, 8), '1/8')
})

test('eggs come whole, and one serving still gets one', () => {
  const eggs = { name: 'eggs', one: 'egg', qty: 2, unit: 'whole' }
  assert.deepEqual(scaleIngredient(eggs, 1 / 4), { name: 'egg', quantity: 1, unit: null, display: '1' })
  assert.deepEqual(scaleIngredient(eggs, 1.6), { name: 'eggs', quantity: 3, unit: null, display: '3' })
  assert.equal(display(eggs, 0.7), '1', 'never half an egg')
  // An onion can be halved.
  const onion = { name: 'onions', one: 'onion', qty: 1, unit: 'whole', step: 0.5 }
  assert.deepEqual(scaleIngredient(onion, 0.25), { name: 'onion', quantity: 0.5, unit: null, display: '1/2' })
  assert.equal(scaleIngredient(onion, 1.75).display, '2')
  assert.equal(scaleIngredient(onion, 1.75).name, 'onions')
})

test('spoons round to quarter teaspoons and half tablespoons, and grow into a jug', () => {
  const salt = { name: 'salt', qty: 1, unit: 'tsp' }
  assert.equal(display(salt, 0.5), '1/2 tsp')
  assert.equal(display(salt, 0.6), '1/2 tsp')
  assert.equal(display(salt, 1.75), '1 3/4 tsp')
  assert.equal(display(salt, 0.1), '1/8 tsp', 'a pinch of a teaspoon is still there')
  assert.equal(display(salt, 3), '1 tbsp', 'three teaspoons are a tablespoon')
  const oil = { name: 'olive oil', qty: 2, unit: 'tbsp' }
  assert.equal(display(oil, 1.75), '3 1/2 tbsp')
  assert.equal(display(oil, 0.25), '1 1/2 tsp', 'half a tablespoon is written in teaspoons')
  assert.equal(display(oil, 12), '360 ml', 'two dozen tablespoons are measured in a jug')
  assert.equal(display(oil, 12, 'us'), '1 1/2 cups')
})

test('grams and millilitres round to 5, and become kilograms and litres', () => {
  const flour = { name: 'flour', qty: 200, unit: 'g' }
  assert.equal(display(flour, 1.33), '265 g')
  assert.equal(display(flour, 0.02), '4 g')
  assert.equal(display(flour, 0.001), '1 g', 'never rounded to nothing')
  assert.equal(display(flour, 4.99), '1 kg', 'not "1000 g"')
  assert.equal(display(flour, 6.2), '1.25 kg')
  assert.deepEqual(scaleIngredient({ name: 'stock', qty: 1200, unit: 'ml' }, 12), {
    name: 'stock',
    quantity: 14.4,
    unit: 'l',
    display: '14.4 l',
  })
})

test('US units: ounces and pounds, cups in quarters or thirds, quarts', () => {
  const flour = { name: 'flour', qty: 200, unit: 'g' }
  assert.equal(display(flour, 1, 'us'), '7 oz')
  assert.equal(display(flour, 0.1, 'us'), '3/4 oz')
  assert.equal(display(flour, 3, 'us'), '1 1/4 lb')
  const milk = { name: 'milk', qty: 300, unit: 'ml' }
  assert.equal(display(milk, 1, 'us'), '1 1/4 cups')
  assert.equal(display(milk, 0.25, 'us'), '1/3 cup', '75 ml is nearer a third of a cup than a quarter')
  assert.equal(display(milk, 0.15, 'us'), '3 tbsp')
  assert.equal(display(milk, 4, 'us'), '1 1/4 qt')
  const pinch = { name: 'saffron', qty: 1, unit: 'pinch' }
  assert.equal(display(pinch, 3, 'us'), '3 pinches')
  assert.equal(display(pinch, 0.25, 'us'), '1 pinch')
})

test('what is to taste stays to taste', () => {
  const salt = { name: 'salt', qty: null, unit: 'to taste' }
  assert.deepEqual(scaleIngredient(salt, 9, 'us'), { name: 'salt', quantity: null, unit: null, display: 'to taste' })
})

test('an unknown unit is a mistake in the recipes, not something to guess', () => {
  assert.throws(() => scaleIngredient({ name: 'milk', qty: 1, unit: 'cup' }, 1), /unknown unit/)
})

test('oven temperatures: Celsius as written, Fahrenheit in steps of 25', () => {
  assert.equal(ovenTemperature(180), '180 °C')
  assert.equal(ovenTemperature(180, 'us'), '350 °F')
  assert.equal(ovenTemperature(220, 'us'), '425 °F')
})

test('every recipe, as written, comes back as written', () => {
  for (const recipe of RECIPES) {
    const scaled = scaleRecipe(recipe, recipe.servings)
    recipe.ingredients.forEach((ingredient, i) => {
      const { quantity, unit } = scaled.ingredients[i]
      if (ingredient.unit === 'to taste') return assert.equal(quantity, null)
      const asWritten = unit === 'kg' || unit === 'l' ? quantity * 1000 : quantity
      assert.equal(asWritten, ingredient.qty, `${recipe.slug}: ${ingredient.name}`)
    })
  }
})

test('every recipe scales to every number of servings in both systems, with nothing rounded away', () => {
  for (const recipe of RECIPES) {
    for (let servings = MIN_SERVINGS; servings <= MAX_SERVINGS; servings += 1) {
      for (const system of ['metric', 'us']) {
        for (const ingredient of scaleRecipe(recipe, servings, system).ingredients) {
          if (ingredient.quantity !== null) assert.ok(ingredient.quantity > 0, `${recipe.slug} ${servings} ${system}`)
          assert.doesNotMatch(ingredient.display, /NaN|undefined|Infinity/)
        }
      }
    }
  }
})

test('scaleRecipe refuses what parseServings would refuse', () => {
  const recipe = RECIPES[0]
  for (const servings of [0, 49, 2.5, NaN, '4']) assert.throws(() => scaleRecipe(recipe, servings), RangeError)
  assert.throws(() => scaleRecipe(recipe, 4, 'imperial'), RangeError)
})

test('a slug finds its recipe, and an object property is not a recipe', () => {
  assert.equal(findRecipe('shakshuka').title, 'Shakshuka')
  for (const slug of ['constructor', '__proto__', 'toString', 'Shakshuka', '', 'shakshuka ']) assert.equal(findRecipe(slug), null, slug)
  assert.equal(new Set(RECIPES.map((recipe) => recipe.slug)).size, RECIPES.length, 'slugs are unique')
  for (const recipe of RECIPES) assert.match(recipe.slug, /^[a-z]+(-[a-z]+)*$/)
})

test('the API answers the scaled ingredients', () => {
  const answer = recipeAnswer('shakshuka', query('servings=6'))
  assert.equal(answer.status, 200)
  assert.deepEqual(answer.body, scaleRecipe(findRecipe('shakshuka'), 6))
  assert.equal(answer.body.ingredients.find((ingredient) => ingredient.name === 'eggs').quantity, 12)
  assert.equal(recipeAnswer('shakshuka', query('servings=6&units=us')).body.system, 'us')
  // Without servings, the recipe as written.
  assert.equal(recipeAnswer('plum-sheet-cake', query('')).body.servings, 12)
})

test('the API refuses servings out of range or not a number, with a 400 that repeats nothing', () => {
  for (const servings of ['0', '49', 'abc', '2.5', '', '-3', '1e1', '<b>x</b>']) {
    const answer = recipeAnswer('shakshuka', query(`servings=${encodeURIComponent(servings)}`))
    assert.equal(answer.status, 400, servings)
    assert.equal(answer.body.error, 'servings must be a whole number from 1 to 48.')
  }
  assert.equal(recipeAnswer('shakshuka', query('units=imperial')).status, 400)
})

test('the API answers 404 for a recipe that does not exist, whatever the servings', () => {
  for (const slug of ['nope', 'constructor', '__proto__', '<script>']) {
    const answer = recipeAnswer(slug, query('servings=4'))
    assert.equal(answer.status, 404, slug)
    assert.ok(!JSON.stringify(answer.body).includes(slug), 'the answer does not repeat the slug')
  }
  assert.equal(recipeAnswer('nope', query('servings=0')).status, 404)
})
