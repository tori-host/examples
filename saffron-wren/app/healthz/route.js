// What Tori's readiness check asks for: an answer that needs no rendering.
export function GET() {
  return new Response('ok\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
