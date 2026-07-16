import { useEffect, useRef, useState } from 'react';

interface SearchResult {
  url: string;
  excerpt: string;
  meta: { title?: string };
}

interface PagefindModule {
  options: (options: { excerptLength: number }) => Promise<void>;
  search: (query: string) => Promise<{ results: Array<{ data: () => Promise<SearchResult> }> }>;
}

export default function DocsSearch() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState('Type at least two characters.');

  function openSearch() {
    dialogRef.current?.showModal();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function closeSearch() {
    dialogRef.current?.close();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dialogRef.current?.open ? closeSearch() : openSearch();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) {
      setResults([]);
      setStatus('Type at least two characters.');
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setStatus('Searching…');
      try {
        const pagefindPath = '/pagefind/pagefind.js';
        const pagefind = await import(/* @vite-ignore */ pagefindPath) as PagefindModule;
        await pagefind.options({ excerptLength: 24 });
        const response = await pagefind.search(cleanQuery);
        const loaded = await Promise.all(response.results.slice(0, 10).map((result) => result.data()));
        if (!cancelled) {
          setResults(loaded);
          setStatus(loaded.length === 0 ? 'No documentation pages matched.' : `${loaded.length} result${loaded.length === 1 ? '' : 's'}.`);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setStatus('Search is available after a production build.');
        }
      }
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <>
      <button className="docs-search-trigger" type="button" onClick={openSearch}>
        <span>Search docs</span>
        <kbd>⌘ K</kbd>
      </button>
      <dialog
        className="docs-search-dialog"
        ref={dialogRef}
        aria-labelledby="docs-search-title"
        onClick={(event) => {
          if (event.target === dialogRef.current) closeSearch();
        }}
      >
        <div className="docs-search-panel">
          <header>
            <div>
              <span>Meridian documentation</span>
              <h2 id="docs-search-title">Find a page.</h2>
            </div>
            <button type="button" onClick={closeSearch} aria-label="Close documentation search">Close</button>
          </header>
          <label htmlFor="docs-search-input">Search terms</label>
          <input
            id="docs-search-input"
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Render graph, build from source, Alluvium…"
            autoComplete="off"
          />
          <p className="docs-search-status" aria-live="polite">{status}</p>
          <div className="docs-search-results">
            {results.map((result) => (
              <a href={result.url} onClick={closeSearch} key={result.url}>
                <strong>{result.meta.title ?? result.url}</strong>
                <span dangerouslySetInnerHTML={{ __html: result.excerpt }} />
              </a>
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
