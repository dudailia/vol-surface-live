import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="page py-24">
      <h1 className="text-h1">Page not found</h1>
      <p className="mt-4 max-w-[var(--measure)] text-graphite">
        There is no page at this address. The live surface is on the <Link href="/">front page</Link>, and past days are in the{' '}
        <Link href="/reports">daily reports</Link>.
      </p>
    </main>
  )
}
