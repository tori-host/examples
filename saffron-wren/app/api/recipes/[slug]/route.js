// GET /api/recipes/<slug>?servings=N&units=metric|us: the ingredients for N
// people, rounded exactly as the page rounds them. lib/api.js decides.
import { recipeAnswer } from '../../../../lib/api.js'

export async function GET(request, { params }) {
  const { slug } = await params
  const { status, body } = recipeAnswer(slug, request.nextUrl.searchParams)
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
