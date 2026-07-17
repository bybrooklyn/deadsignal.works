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
          {items.map((item, index) => (
            <m.a
              className={`subsystem-card tone-${item.tone}`}
              data-subsystem-transition={item.slug}
              href={`/meridian/${item.slug}`}
              key={item.slug}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              whileHover={{ y: -6 }}
              transition={{ duration: 0.2, delay: index * 0.035, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="subsystem-transition-frame" data-subsystem-frame aria-hidden="true" />
              <span className="subsystem-number">0{index + 1}</span>
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
          ))}
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
