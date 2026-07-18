import { useState } from 'react';
import { domAnimation, LazyMotion, m, MotionConfig, useReducedMotion } from 'motion/react';

type Mode = 'home' | 'project';

interface Props {
  mode?: Mode;
  steamWishlistUrl?: string | null;
}

const facts = [
  ['Status', 'Early development'],
  ['Format', 'Single-player / first person'],
  ['Genre', 'Liminal horror / exploration'],
  ['Targets', 'Windows, Linux, Steam Deck, macOS'],
  ['Storefront', 'Steam intended'],
] as const;

const timing = { type: 'spring' as const, stiffness: 185, damping: 20, mass: 0.82 };

export default function KineticProjectHero({ mode = 'home', steamWishlistUrl = null }: Props) {
  const [active, setActive] = useState(false);
  const [shareLabel, setShareLabel] = useState('Share project');
  const [shareMessage, setShareMessage] = useState('');
  const [shareFallbackUrl, setShareFallbackUrl] = useState('');
  const reduceMotion = useReducedMotion();

  async function shareProject() {
    const url = new URL('/project-meridian/', window.location.origin).toString();
    const data = {
      title: 'Project Meridian — Dead Signal Works',
      text: 'A single-player liminal horror game built around exploration across a large continuous world.',
      url,
    };

    try {
      if (navigator.share) {
        await navigator.share(data);
        setShareLabel('Shared');
        setShareMessage('Project link shared.');
      } else {
        if (!navigator.clipboard?.writeText) throw new DOMException('Clipboard access is unavailable.');
        await navigator.clipboard.writeText(url);
        setShareLabel('Link copied');
        setShareMessage('Project link copied.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareLabel('Copy link');
      setShareFallbackUrl(url);
      setShareMessage('Copying is unavailable here. Select and copy the project URL instead.');
      return;
    }

    window.setTimeout(() => setShareLabel('Share project'), 1800);
  }

  const shifted = active && !reduceMotion;

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={timing}>
        <section className="project-hero shell" aria-labelledby={`${mode}-project-title`}>
          <header className="project-hero-heading">
            <p className="kicker"><span>{mode === 'home' ? 'Current game' : 'Working title'}</span> / early development</p>
            <h1 id={`${mode}-project-title`}>Project Meridian.</h1>
            <p>A single-player, first-person liminal horror game built around exploration across a large continuous world.</p>
          </header>

          <div className="project-hero-grid">
            <m.div
              className="kinetic-poster"
              aria-hidden="true"
              initial={false}
              animate={{ opacity: 1, clipPath: 'inset(0 0 0% 0)' }}
              onHoverStart={() => setActive(true)}
              onHoverEnd={() => setActive(false)}
            >
              <m.span className="poster-block poster-red" animate={{ x: shifted ? '28%' : '0%', y: shifted ? '7%' : '0%', scaleY: shifted ? 0.9 : 1 }} />
              <m.span className="poster-block poster-grass" animate={{ x: shifted ? '-18%' : '0%', y: shifted ? '-8%' : '0%', scaleX: shifted ? 1.08 : 1 }} />
              <m.span className="poster-block poster-amber" animate={{ x: shifted ? '12%' : '0%', y: shifted ? '22%' : '0%', scale: shifted ? 1.12 : 1 }} />
              <m.span className="poster-rule poster-rule-a" animate={{ scaleX: shifted ? 0.58 : 1, x: shifted ? '22%' : '0%' }} />
              <m.span className="poster-rule poster-rule-b" animate={{ scaleY: shifted ? 0.66 : 1, y: shifted ? '-14%' : '0%' }} />
              <div className="poster-title" aria-hidden="true">
                <m.span animate={{ x: shifted ? '5%' : '0%', y: shifted ? '-4%' : '0%', fontVariationSettings: shifted ? "'wght' 820, 'wdth' 84" : "'wght' 720, 'wdth' 108" }}>Project</m.span>
                <m.span animate={{ x: shifted ? '-4%' : '0%', y: shifted ? '5%' : '0%', fontVariationSettings: shifted ? "'wght' 650, 'wdth' 118" : "'wght' 850, 'wdth' 92" }}>Meridian</m.span>
              </div>
              <div className="poster-notes" aria-hidden="true">
                <span>From a dream.</span>
                <span>Working title.</span>
              </div>
            </m.div>

            <aside className="project-summary" aria-label="Project Meridian summary">
              <dl className="fact-list">
                {facts.map(([label, value]) => (
                  <m.div key={label} layout className="fact-row">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </m.div>
                ))}
              </dl>

              <div className="project-actions">
                {steamWishlistUrl
                  ? <a className="action action-primary wishlist-action" href={steamWishlistUrl} target="_blank" rel="noreferrer">Wishlist on Steam <span aria-hidden="true">↗</span></a>
                  : <button className="action action-primary wishlist-action" type="button" disabled aria-label="Steam wishlist coming soon">Steam wishlist coming soon</button>}
                {mode === 'home' && <a className="action action-primary" href="/project-meridian/">Open the project page <span aria-hidden="true">↗</span></a>}
                <a className="action action-primary" href="https://discord.gg/3NckH4Xtrn" target="_blank" rel="noreferrer">Join Discord <span aria-hidden="true">↗</span></a>
                <button className="action action-button" type="button" onClick={shareProject}>{shareLabel} <span aria-hidden="true">↗</span></button>
                {shareFallbackUrl && (
                  <label className="share-fallback">
                    <span>Project link</span>
                    <input aria-label="Project link" readOnly value={shareFallbackUrl} onFocus={(event) => event.currentTarget.select()} />
                  </label>
                )}
                <p className="share-status" role="status" aria-live="polite">{shareMessage}</p>
              </div>

              <p className="project-fine-print">The Steam page appears here only when it is real.</p>
            </aside>
          </div>
        </section>
      </MotionConfig>
    </LazyMotion>
  );
}
