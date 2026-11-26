// Every unknown path and every unknown recipe. It names nothing from the URL.
import Link from 'next/link'

export const metadata = { title: 'Not found' }

export default function NotFound() {
  return (
    <>
      <p className="lead">There is nothing here.</p>
      <p>
        <Link href="/">All recipes</Link>
      </p>
    </>
  )
}
