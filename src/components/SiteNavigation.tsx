import { AnimatePresence, domAnimation, LazyMotion, m, MotionConfig, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

interface Props {
  currentPath: string;
}

type PanelName = 'meridian' | 'connect' | null;

const meridianLinks = [
  { label: 'Engine overview', href: '/meridian' },
  { label: 'Documentation', href: '/meridian/docs' },
  { label: 'Penumbra', detail: 'Rendering', href: '/meridian/penumbra' },
  { label: 'Cairn', detail: 'Physics', href: '/meridian/cairn' },
  { label: 'Wavefront', detail: 'Audio', href: '/meridian/wavefront' },
  { label: 'Alluvium', detail: 'Procedural worlds', href: '/meridian/alluvium' },
] as const;

const connectLinks = [
  { label: 'Join Discord', href: 'https://discord.gg/3NckH4Xtrn', external: true },
  { label: 'Contact', href: '/contact', external: false },
  { label: 'Press kit', href: '/press', external: false },
] as const;

const directLinks = [
  { label: 'Project Meridian', href: '/project-meridian' },
  { label: 'Studio', href: '/studio' },
  { label: 'Devlog', href: '/updates' },
] as const;

function isCurrent(currentPath: string, href: string) {
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export default function SiteNavigation({ currentPath }: Props) {
  const [openPanel, setOpenPanel] = useState<PanelName>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [panelRight, setPanelRight] = useState(0);
  const navigationRef = useRef<HTMLDivElement>(null);
  const meridianTriggerRef = useRef<HTMLButtonElement>(null);
  const connectTriggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openedByPointerRef = useRef<PanelName>(null);
  const reduceMotion = useReducedMotion();

  const cancelPanelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openNavigationPanel = (panel: Exclude<PanelName, null>) => {
    cancelPanelClose();
    if (openPanel !== panel) openedByPointerRef.current = panel;
    const trigger = panel === 'meridian' ? meridianTriggerRef.current : connectTriggerRef.current;
    const navigation = navigationRef.current;
    if (trigger && navigation) {
      const triggerBounds = trigger.getBoundingClientRect();
      const navigationBounds = navigation.getBoundingClientRect();
      setPanelRight(Math.max(0, navigationBounds.right - triggerBounds.right));
    }
    setOpenPanel(panel);
  };

  const closeNavigationPanel = () => {
    cancelPanelClose();
    openedByPointerRef.current = null;
    setOpenPanel(null);
  };

  const schedulePanelClose = () => {
    cancelPanelClose();
    closeTimerRef.current = window.setTimeout(() => {
      openedByPointerRef.current = null;
      setOpenPanel(null);
      closeTimerRef.current = null;
    }, 140);
  };

  useEffect(() => {
    if (!openPanel) return;

    const updatePanelPosition = () => {
      const trigger = openPanel === 'meridian' ? meridianTriggerRef.current : connectTriggerRef.current;
      const navigation = navigationRef.current;
      if (!trigger || !navigation) return;

      const triggerBounds = trigger.getBoundingClientRect();
      const navigationBounds = navigation.getBoundingClientRect();
      setPanelRight(Math.max(0, navigationBounds.right - triggerBounds.right));
    };

    window.addEventListener('resize', updatePanelPosition);
    return () => window.removeEventListener('resize', updatePanelPosition);
  }, [openPanel]);

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!navigationRef.current?.contains(event.target as Node)) {
        cancelPanelClose();
        openedByPointerRef.current = null;
        setOpenPanel(null);
        setMobileOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelPanelClose();
        openedByPointerRef.current = null;
        setOpenPanel(null);
        setMobileOpen(false);
      }
    };
    const closeForNavigation = () => {
      cancelPanelClose();
      openedByPointerRef.current = null;
      flushSync(() => {
        setOpenPanel(null);
        setMobileOpen(false);
      });
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('astro:before-preparation', closeForNavigation);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('astro:before-preparation', closeForNavigation);
      cancelPanelClose();
    };
  }, []);

  const spring = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 330, damping: 27, mass: 0.72 };

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div
          className="site-navigation"
          ref={navigationRef}
          onPointerEnter={cancelPanelClose}
          onPointerLeave={schedulePanelClose}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) closeNavigationPanel();
          }}
        >
          <nav className="desktop-nav" aria-label="Primary navigation">
            <a
              href="/project-meridian"
              aria-current={isCurrent(currentPath, '/project-meridian') ? 'page' : undefined}
              onPointerEnter={closeNavigationPanel}
              onFocus={closeNavigationPanel}
            >Project Meridian</a>

            <div className="nav-cluster" onPointerEnter={() => openNavigationPanel('meridian')}>
              <button
                ref={meridianTriggerRef}
                className={isCurrent(currentPath, '/meridian') ? 'is-current' : undefined}
                type="button"
                aria-expanded={openPanel === 'meridian'}
                aria-controls="meridian-navigation-panel"
                onClick={() => {
                  cancelPanelClose();
                  if (openedByPointerRef.current === 'meridian') {
                    openedByPointerRef.current = null;
                    setOpenPanel('meridian');
                    return;
                  }
                  setOpenPanel(openPanel === 'meridian' ? null : 'meridian');
                }}
              >
                Meridian <m.span animate={{ rotate: openPanel === 'meridian' ? 45 : 0 }} transition={spring}>+</m.span>
              </button>
            </div>

            {directLinks.slice(1).map((item) => (
              <a
                href={item.href}
                aria-current={isCurrent(currentPath, item.href) ? 'page' : undefined}
                key={item.href}
                onPointerEnter={closeNavigationPanel}
                onFocus={closeNavigationPanel}
              >{item.label}</a>
            ))}

            <div className="nav-cluster" onPointerEnter={() => openNavigationPanel('connect')}>
              <button
                ref={connectTriggerRef}
                className={currentPath === '/contact' || currentPath === '/press' ? 'is-current' : undefined}
                type="button"
                aria-expanded={openPanel === 'connect'}
                aria-controls="connect-navigation-panel"
                onClick={() => {
                  cancelPanelClose();
                  if (openedByPointerRef.current === 'connect') {
                    openedByPointerRef.current = null;
                    setOpenPanel('connect');
                    return;
                  }
                  setOpenPanel(openPanel === 'connect' ? null : 'connect');
                }}
              >
                Connect <m.span animate={{ rotate: openPanel === 'connect' ? 45 : 0 }} transition={spring}>+</m.span>
              </button>
            </div>
          </nav>

          <AnimatePresence initial={false}>
            {openPanel && (
              <m.div
                className="nav-panel-hitbox"
                id={openPanel === 'meridian' ? 'meridian-navigation-panel' : 'connect-navigation-panel'}
                initial={{ opacity: 0, y: -10, width: openPanel === 'meridian' ? 480 : 270 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  right: panelRight,
                  width: openPanel === 'meridian' ? 480 : 270,
                }}
                exit={{ opacity: 0, y: -7 }}
                transition={spring}
              >
                <div className="nav-panel">
                  <AnimatePresence initial={false} mode="wait">
                    <m.div
                      className={`nav-panel-body nav-panel-body-${openPanel}`}
                      key={openPanel}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 3 }}
                      transition={reduceMotion ? { duration: 0 } : { duration: 0.1 }}
                    >
                      {openPanel === 'meridian' ? (
                        <>
                          <p>Meridian engine</p>
                          <div>
                            {meridianLinks.map((item) => (
                              <a href={item.href} aria-current={currentPath === item.href ? 'page' : undefined} key={item.href}>
                                <span>{item.label}</span>
                                {'detail' in item && <small>{item.detail}</small>}
                              </a>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <p>Find the studio</p>
                          {connectLinks.map((item) => (
                            <a href={item.href} target={item.external ? '_blank' : undefined} rel={item.external ? 'noreferrer' : undefined} key={item.href}>
                              {item.label}<span aria-hidden="true">↗</span>
                            </a>
                          ))}
                        </>
                      )}
                    </m.div>
                  </AnimatePresence>
                </div>
              </m.div>
            )}
          </AnimatePresence>

          <div className="mobile-nav">
            <button
              className="mobile-nav-trigger"
              type="button"
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation-panel"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              Menu <m.span animate={{ rotate: mobileOpen ? 45 : 0 }} transition={spring}>+</m.span>
            </button>
            <AnimatePresence>
              {mobileOpen && (
                <m.nav
                  className="mobile-nav-panel"
                  id="mobile-navigation-panel"
                  aria-label="Mobile navigation"
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={spring}
                  onClick={(event) => {
                    if ((event.target as Element).closest('a')) flushSync(() => setMobileOpen(false));
                  }}
                >
                  <a href="/project-meridian">Project Meridian</a>
                  <section>
                    <a href="/meridian">Meridian</a>
                    <div>{meridianLinks.slice(1).map((item) => <a href={item.href} key={item.href}>{item.label}</a>)}</div>
                  </section>
                  <a href="/studio">Studio</a>
                  <a href="/updates">Devlog</a>
                  <section>
                    <span>Connect</span>
                    <div>{connectLinks.map((item) => <a href={item.href} target={item.external ? '_blank' : undefined} rel={item.external ? 'noreferrer' : undefined} key={item.href}>{item.label}</a>)}</div>
                  </section>
                </m.nav>
              )}
            </AnimatePresence>
          </div>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
