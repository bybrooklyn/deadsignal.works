import { Fragment, useEffect, useRef, useState } from 'react';

interface SearchResult {
  url: string;
  excerpt: string;
  meta: { title?: string };
}

interface PagefindModule {
  options: (options: { excerptLength: number }) => Promise<void>;
  search: (query: string) => Promise<{ results: Array<{ data: () => Promise<SearchResult> }> }>;
}

function renderExcerpt(excerpt: string) {
  let highlighted = false;
  return excerpt.split(/(<\/?mark>)/giu).map((part, index) => {
    const tag = part.toLowerCase();
    if (tag === '<mark>') {
      highlighted = true;
      return null;
    }
    if (tag === '</mark>') {
      highlighted = false;
      return null;
    }

    const text = part.replace(/<[^>]*>/gu, '');
    if (!text) return null;
    return highlighted
      ? <mark key={index}>{text}</mark>
      : <Fragment key={index}>{text}</Fragment>;
  });
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
      if (event.key === 'Escape' && dialogRef.current?.open) {
        event.preventDefault();
        closeSearch();
        return;
      }
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
        const safeResults = loaded.flatMap((result) => {
          const url = new URL(result.url, window.location.origin);
          const isDocumentationPath = url.pathname.startsWith('/meridian/docs/');
          if (url.origin !== window.location.origin || !isDocumentationPath) return [];
          return [{ ...result, url: `${url.pathname}${url.search}${url.hash}` }];
        });
        if (!cancelled) {
          setResults(safeResults);
          setStatus(safeResults.length === 0 ? 'No documentation pages matched.' : `${safeResults.length} result${safeResults.length === 1 ? '' : 's'}.`);
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
      <button className="docs-search-trigger" type="button" onClick={openSearch} aria-haspopup="dialog" aria-controls="docs-search-dialog">
        <span>Search docs</span>
        <kbd>Ctrl/⌘ K</kbd>
      </button>
      <dialog
        id="docs-search-dialog"
        className="docs-search-dialog"
        ref={dialogRef}
        aria-labelledby="docs-search-title"
        onCancel={(event) => {
          event.preventDefault();
          closeSearch();
        }}
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
          <p className="docs-search-status" role="status">{status}</p>
          <ul className="docs-search-results">
            {results.map((result) => (
              <li key={result.url}>
                <a href={result.url} onClick={closeSearch}>
                  <strong>{result.meta.title ?? result.url}</strong>
                  <span>{renderExcerpt(result.excerpt)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
