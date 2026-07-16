import { domAnimation, LazyMotion, m, MotionConfig, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

const drawers = [
  {
    number: '01',
    kind: 'Current game',
    title: 'Project Meridian',
    copy: 'A single-player, first-person liminal horror game built around exploration across a large continuous world.',
    href: '/project-meridian',
    tone: 'red',
  },
  {
    number: '02',
    kind: 'Engine / source release planned',
    title: 'Meridian',
    copy: 'The Rust engine and integrated creator application being built alongside the game that needs them.',
    href: '/meridian',
    tone: 'grass',
  },
  {
    number: '03',
    kind: 'Other work',
    title: 'Room on the bench',
    copy: 'Future games and software will take this space when they are real enough to introduce.',
    href: '/studio',
    tone: 'amber',
  },
] as const;

export default function StudioWorkbench() {
  const [active, setActive] = useState(0);
  const [drawerGeometry, setDrawerGeometry] = useState({ available: 482, collapsed: 92 });
  const drawersRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const spring = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 235, damping: 24, mass: 0.8 };

  useEffect(() => {
    const container = drawersRef.current;
    if (!container) return;

    const measure = () => {
      const available = container.clientHeight;
      const preferredCollapsed = window.matchMedia('(max-width: 720px)').matches ? 84 : 92;
      const maximumCollapsed = Math.max(0, (available - 220) / (drawers.length - 1));
      setDrawerGeometry({
        available,
        collapsed: Math.min(preferredCollapsed, maximumCollapsed),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const expandedHeight = drawerGeometry.available - drawerGeometry.collapsed * (drawers.length - 1);

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="studio-workbench" aria-label="Work currently on the Dead Signal Works workbench">
          <div className="workbench-drawers" ref={drawersRef}>
            {drawers.map((drawer, index) => {
              const selected = active === index;
              return (
                <m.a
                  className={`workbench-drawer tone-${drawer.tone}`}
                  data-active={selected ? 'true' : undefined}
                  href={drawer.href}
                  key={drawer.number}
                  onHoverStart={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  initial={false}
                  animate={{ height: selected ? expandedHeight : drawerGeometry.collapsed }}
                  transition={spring}
                >
                  <m.b
                    className="workbench-drawer-fill"
                    aria-hidden="true"
                    initial={false}
                    animate={{ opacity: selected ? 1 : 0 }}
                    transition={spring}
                  />
                  <span>{drawer.number}</span>
                  <div>
                    <small>{drawer.kind}</small>
                    <strong>{drawer.title}</strong>
                    <m.p
                      aria-hidden={!selected}
                      initial={false}
                      style={{ visibility: selected ? 'visible' : 'hidden' }}
                      animate={{ opacity: selected ? 1 : 0, y: selected ? 0 : 7 }}
                      transition={spring}
                    >
                      {drawer.copy}
                    </m.p>
                  </div>
                  <m.i aria-hidden="true" animate={{ x: selected ? 0 : -7, rotate: selected ? 0 : -45 }} transition={spring}>↗</m.i>
                </m.a>
              );
            })}
          </div>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
