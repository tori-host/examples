// The recipes, in code: there is no database and nothing a visitor writes is
// kept. Quantities are metric, for `servings` people. Units are the ones
// lib/scale.js knows: g, ml, tsp, tbsp, pinch, whole (with `one` for the
// singular and `step` when half of one makes sense) and 'to taste'.
// The steps name no amounts, so rescaling can never contradict them.

export const RECIPES = [
  {
    slug: 'saffron-rice',
    title: 'Saffron rice with peas',
    summary: 'Buttery basmati, golden with saffron, studded with green peas.',
    servings: 4,
    minutes: 30,
    ingredients: [
      { name: 'basmati rice', qty: 300, unit: 'g' },
      { name: 'water', qty: 500, unit: 'ml' },
      { name: 'saffron threads', qty: 1, unit: 'pinch' },
      { name: 'butter', qty: 30, unit: 'g' },
      { name: 'onions', one: 'onion', qty: 1, unit: 'whole', step: 0.5 },
      { name: 'frozen peas', qty: 150, unit: 'g' },
      { name: 'salt', qty: 1, unit: 'tsp' },
    ],
    steps: [
      'Rinse the rice until the water runs clear, then leave it to drain.',
      'Crumble the saffron into a few spoonfuls of the water, just off the boil, and let it steep.',
      'Soften the finely chopped onion in the butter over a low heat without letting it brown.',
      'Stir in the rice until every grain is coated, then add the rest of the water, the saffron water and the salt.',
      'Cover and simmer gently until the water is absorbed. Scatter the peas on top, cover again and rest off the heat for ten minutes.',
      'Fluff with a fork before serving.',
    ],
  },
  {
    slug: 'red-lentil-soup',
    title: 'Red lentil soup',
    summary: 'A thick, warming soup with cumin and a squeeze of lemon.',
    servings: 4,
    minutes: 40,
    ingredients: [
      { name: 'red lentils', qty: 250, unit: 'g' },
      { name: 'onions', one: 'onion', qty: 1, unit: 'whole', step: 0.5 },
      { name: 'carrots', one: 'carrot', qty: 2, unit: 'whole' },
      { name: 'garlic cloves', one: 'garlic clove', qty: 2, unit: 'whole' },
      { name: 'olive oil', qty: 2, unit: 'tbsp' },
      { name: 'ground cumin', qty: 1, unit: 'tsp' },
      { name: 'vegetable stock', qty: 1200, unit: 'ml' },
      { name: 'lemons', one: 'lemon', qty: 0.5, unit: 'whole', step: 0.5 },
      { name: 'salt and pepper', qty: null, unit: 'to taste' },
    ],
    steps: [
      'Chop the onion and carrots and soften them in the olive oil for a few minutes.',
      'Add the crushed garlic and the cumin and stir until fragrant.',
      'Add the rinsed lentils and the stock, bring to the boil and simmer until the lentils fall apart.',
      'Blend until smooth, or leave it rustic.',
      'Season, and finish with the lemon juice just before serving.',
    ],
  },
  {
    slug: 'buttermilk-pancakes',
    title: 'Buttermilk pancakes',
    summary: 'Tall, tender pancakes for a slow weekend breakfast.',
    servings: 4,
    minutes: 25,
    ingredients: [
      { name: 'plain flour', qty: 200, unit: 'g' },
      { name: 'sugar', qty: 1, unit: 'tbsp' },
      { name: 'baking powder', qty: 2, unit: 'tsp' },
      { name: 'salt', qty: 0.5, unit: 'tsp' },
      { name: 'eggs', one: 'egg', qty: 2, unit: 'whole' },
      { name: 'buttermilk', qty: 300, unit: 'ml' },
      { name: 'melted butter', qty: 30, unit: 'g' },
    ],
    steps: [
      'Whisk the flour, sugar, baking powder and salt together in a large bowl.',
      'In another bowl beat the eggs with the buttermilk and the melted butter.',
      'Pour the wet into the dry and fold until just combined; a few lumps are fine.',
      'Cook ladlefuls in a lightly buttered pan over a medium heat, turning once bubbles appear on top.',
    ],
  },
  {
    slug: 'shakshuka',
    title: 'Shakshuka',
    summary: 'Eggs poached in a spiced tomato and pepper sauce.',
    servings: 3,
    minutes: 35,
    ingredients: [
      { name: 'olive oil', qty: 3, unit: 'tbsp' },
      { name: 'onions', one: 'onion', qty: 1, unit: 'whole', step: 0.5 },
      { name: 'red peppers', one: 'red pepper', qty: 2, unit: 'whole' },
      { name: 'garlic cloves', one: 'garlic clove', qty: 3, unit: 'whole' },
      { name: 'sweet paprika', qty: 2, unit: 'tsp' },
      { name: 'ground cumin', qty: 1, unit: 'tsp' },
      { name: 'chopped tomatoes', qty: 800, unit: 'g' },
      { name: 'eggs', one: 'egg', qty: 6, unit: 'whole' },
      { name: 'salt', qty: null, unit: 'to taste' },
    ],
    steps: [
      'Soften the sliced onion and peppers in the olive oil in a wide pan.',
      'Add the garlic, paprika and cumin and cook for a minute.',
      'Add the tomatoes, season and simmer until the sauce thickens.',
      'Make hollows in the sauce, crack an egg into each, cover and cook until the whites are set but the yolks still run.',
    ],
  },
  {
    slug: 'plum-sheet-cake',
    title: 'Plum sheet cake',
    summary: 'A late-summer tray cake, plums pressed into a soft sponge.',
    servings: 12,
    minutes: 70,
    oven: 180,
    ingredients: [
      { name: 'butter, softened', qty: 125, unit: 'g' },
      { name: 'sugar', qty: 150, unit: 'g' },
      { name: 'eggs', one: 'egg', qty: 3, unit: 'whole' },
      { name: 'plain flour', qty: 250, unit: 'g' },
      { name: 'baking powder', qty: 2, unit: 'tsp' },
      { name: 'milk', qty: 100, unit: 'ml' },
      { name: 'plums, halved and stoned', qty: 800, unit: 'g' },
      { name: 'ground cinnamon', qty: 1, unit: 'tsp' },
    ],
    steps: [
      'Heat the oven and line a baking tray with paper.',
      'Beat the butter and most of the sugar until pale, then beat in the eggs one at a time.',
      'Fold in the flour and baking powder, loosening the batter with the milk.',
      'Spread the batter on the tray and press the plums in, cut side up, close together.',
      'Mix the rest of the sugar with the cinnamon and sprinkle it over the plums.',
      'Bake until golden and a skewer comes out clean. Cool on the tray before cutting.',
    ],
  },
  {
    slug: 'rosemary-potatoes',
    title: 'Rosemary roast potatoes',
    summary: 'Crisp edges, soft middles, garlic and rosemary.',
    servings: 4,
    minutes: 60,
    oven: 220,
    ingredients: [
      { name: 'floury potatoes', qty: 1000, unit: 'g' },
      { name: 'olive oil', qty: 3, unit: 'tbsp' },
      { name: 'rosemary sprigs', one: 'rosemary sprig', qty: 2, unit: 'whole' },
      { name: 'garlic cloves', one: 'garlic clove', qty: 4, unit: 'whole' },
      { name: 'flaky salt', qty: 1, unit: 'tsp' },
    ],
    steps: [
      'Heat the oven with the oil in a roasting tin.',
      'Cut the potatoes into chunks and boil them in salted water until the edges soften.',
      'Drain and shake them in the pan to rough up the surfaces.',
      'Tip them into the hot oil, turn to coat and roast, turning once, until deep golden.',
      'Add the rosemary and the unpeeled garlic for the last fifteen minutes, then sprinkle with the salt.',
    ],
  },
]

/** The recipe with this slug, or null. A lookup by property would answer `constructor`. */
export function findRecipe(slug) {
  return RECIPES.find((recipe) => recipe.slug === slug) ?? null
}
