import { domAnimation, LazyMotion, m, MotionConfig } from 'motion/react';

interface Item {
  slug: string;
  name: string;
  pronunciation: string;
  pronunciationLabel: string;
  role: string;
  maturity: string;
  summary: string;
  tone: string;
}

interface Props {
  items: Item[];
}

export default function MotionSubsystemGrid({ items }: Props) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="subsystem-grid">
          {items.map((item, index) => {
            const isScaffold = item.maturity.toLowerCase() === 'scaffold';
            return (
            <m.a
              className={`subsystem-card tone-${item.tone}${isScaffold ? ' is-scaffold' : ''}`}
              data-maturity={isScaffold ? 'scaffold' : undefined}
              data-subsystem-transition={item.slug}
              href={`/meridian/${item.slug}/`}
              key={item.slug}
              initial={false}
              whileHover={{ y: -6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="subsystem-transition-frame" data-subsystem-frame aria-hidden="true" />
              <span className="subsystem-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <p data-subsystem-part="role"><span>{item.role}</span><span className="status-label">{item.maturity}</span></p>
                <div className="subsystem-card-title">
                  <h3 data-subsystem-part="title">{item.name}</h3>
                  <span data-subsystem-part="pronunciation" aria-label={`pronounced ${item.pronunciationLabel}`}>{item.pronunciation}</span>
                </div>
              </div>
              <p className="subsystem-summary" data-subsystem-part="summary">{item.summary}</p>
              <span className="subsystem-arrow" aria-hidden="true">↗</span>
            </m.a>
            );
          })}
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
