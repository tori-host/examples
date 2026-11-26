// One recipe. The slug only ever picks one of the recipes in lib/recipes.js;
// anything else is the 404 page, which does not repeat what was asked for.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { findRecipe } from '../../../lib/recipes.js'
import Scaler from './scaler.jsx'

export async function generateMetadata({ params }) {
  const recipe = findRecipe((await params).slug)
  return { title: recipe ? recipe.title : 'Not found' }
}

export default async function RecipePage({ params }) {
  const recipe = findRecipe((await params).slug)
  if (!recipe) notFound()
  return (
    <article>
      <p className="crumbs">
        <Link href="/">All recipes</Link>
      </p>
      <h2 className="title">{recipe.title}</h2>
      <p className="lead">{recipe.summary}</p>
      <p className="meta">
        {recipe.minutes} min · the recipe as written serves {recipe.servings}
      </p>
      <Scaler recipe={recipe} />
      <h3>Method</h3>
      <ol className="steps">
        {recipe.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </article>
  )
}
