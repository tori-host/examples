// The list of recipes, drawn on the server for each request.
import Link from 'next/link'
import { RECIPES } from '../lib/recipes.js'

export default function Home() {
  return (
    <>
      <p className="lead">Recipes, scaled to your table. Pick one, then set how many people are eating.</p>
      <ul className="recipes">
        {RECIPES.map((recipe) => (
          <li key={recipe.slug}>
            <Link href={`/recipes/${recipe.slug}`}>{recipe.title}</Link>
            <span className="meta">
              serves {recipe.servings} · {recipe.minutes} min
            </span>
            <p>{recipe.summary}</p>
          </li>
        ))}
      </ul>

      <h2>How it runs</h2>
      <ul>
        <li>
          There is no Dockerfile. Tori finds <code>next</code> in <code>package.json</code>, runs{' '}
          <code>npm run build</code> and then <code>npm start</code>, which is <code>next start</code> on port 8080.
        </li>
        <li>
          Pages are drawn by the server on each request. The servings control on a recipe page is a client component:
          it rescales the list in the browser, with the same code the server uses.
        </li>
        <li>
          The same numbers come as JSON from the API, for example{' '}
          <a href="/api/recipes/shakshuka?servings=6">
            <code>/api/recipes/shakshuka?servings=6</code>
          </a>
          .
        </li>
      </ul>

      <h2>Deploy your own</h2>
      <p>With Node.js installed:</p>
      <pre>
        <code>{`git clone https://github.com/tori-host/examples
cd examples/saffron-wren
npx tori.host`}</code>
      </pre>
      <p>
        The build runs on Tori, so nothing needs installing first. The first run creates a service under a new name of
        its own and writes it to <code>tori.json</code>, so that the next run updates the same service.
      </p>
    </>
  )
}
