'use client'
// The servings control and the ingredient list. The server draws it once for
// the servings the recipe was written for, so the list is there without
// JavaScript; in the browser every click rescales it with lib/scale.js, the
// module the API answers with, so the page and the JSON always agree.
import { useState } from 'react'
import { MAX_SERVINGS, MIN_SERVINGS, scaleRecipe } from '../../../lib/scale.js'

const SYSTEMS = [
  ['metric', 'Metric'],
  ['us', 'US'],
]

export default function Scaler({ recipe }) {
  const [servings, setServings] = useState(recipe.servings)
  const [system, setSystem] = useState('metric')
  const scaled = scaleRecipe(recipe, servings, system)
  const change = (by) => setServings((n) => Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, n + by)))

  return (
    <section className="card" aria-labelledby="ingredients">
      <div className="controls">
        <div className="stepper" role="group" aria-label="Servings">
          <button type="button" onClick={() => change(-1)} disabled={servings <= MIN_SERVINGS} aria-label="One serving fewer">
            −
          </button>
          <output aria-live="polite">
            {servings} {servings === 1 ? 'serving' : 'servings'}
          </output>
          <button type="button" onClick={() => change(1)} disabled={servings >= MAX_SERVINGS} aria-label="One serving more">
            +
          </button>
        </div>
        <div className="toggle" role="group" aria-label="Units">
          {SYSTEMS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={system === value} onClick={() => setSystem(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <h3 id="ingredients">Ingredients</h3>
      <table className="ingredients">
        <tbody>
          {scaled.ingredients.map((ingredient, i) => (
            <tr key={i}>
              <td className="amount">{ingredient.display}</td>
              <td>{ingredient.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {scaled.oven && <p className="oven">Oven: {scaled.oven}</p>}
      {system === 'us' && (
        <p className="note">US weights are in ounces and pounds: turning grams of flour into cups would be a guess.</p>
      )}
      <p className="note">
        {servings === recipe.servings ? (
          'As written. '
        ) : (
          <>
            <button type="button" className="link" onClick={() => setServings(recipe.servings)}>
              Back to {recipe.servings}
            </button>{' '}
          </>
        )}
        As JSON:{' '}
        <a href={`/api/recipes/${recipe.slug}?servings=${servings}&units=${system}`}>
          <code>
            /api/recipes/{recipe.slug}?servings={servings}&amp;units={system}
          </code>
        </a>
      </p>
    </section>
  )
}
