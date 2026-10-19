import { AUTHOR_URL, REPO_URL } from '@/lib/site'

export function Footer() {
  return (
    <footer className="page mb-12 mt-24 border-t border-rule pt-6 text-note text-graphite sm:mt-32">
      <div className="flex flex-wrap justify-between gap-4">
        <p>
          By <a href={AUTHOR_URL}>Ilia Duda</a>. Data from Deribit&rsquo;s public API. Not a trading signal.
        </p>
        <p className="flex gap-5">
          <a href="/reports">Daily reports</a>
          <a href={REPO_URL}>Source on GitHub</a>
        </p>
      </div>
    </footer>
  )
}
