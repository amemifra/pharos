"use client";

/**
 * /books — public-domain book catalogue (archive.org texts).
 *
 * Statically exported like every other shell route: no server, all data is
 * fetched client-side at runtime. Lives inside the shell layout, so the
 * player island and PlayerProvider are untouched — audio keeps playing while
 * the user browses books.
 */
export default function BooksPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 md:px-8 pt-6 md:pt-10" data-testid="books-page">
      <h1 className="mb-2 text-2xl font-bold tracking-tight md:text-3xl">Books</h1>
      <p className="mb-8 text-sm text-zinc-500">Public-domain and openly licensed books from archive.org.</p>
    </main>
  );
}
