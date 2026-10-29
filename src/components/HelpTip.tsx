import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';

export function HelpTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  function cancelClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  useEffect(() => () => cancelClose(), []);

  useLayoutEffect(() => {
    if (!open) return;
    const positionTooltip = () => {
      const button = buttonRef.current;
      const tooltip = tooltipRef.current;
      if (!button || !tooltip) return;
      const anchor = button.getBoundingClientRect();
      const bounds = tooltip.getBoundingClientRect();
      const gap = 8;
      const left = Math.max(gap, Math.min(anchor.left + anchor.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - gap));
      const below = anchor.bottom + gap;
      const top = below + bounds.height <= window.innerHeight - gap
        ? below
        : Math.max(gap, anchor.top - bounds.height - gap);
      setPosition({ left, top });
    };
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !buttonRef.current?.contains(event.target) && !tooltipRef.current?.contains(event.target)) {
        setOpen(false);
        setPinned(false);
      }
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setPinned(false);
      }
    };
    positionTooltip();
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      window.removeEventListener('resize', positionTooltip);
      window.removeEventListener('scroll', positionTooltip, true);
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [open, text]);

  function closeUnlessActive(nextTarget: EventTarget | null) {
    if (pinned || document.activeElement === buttonRef.current) return;
    if (nextTarget instanceof Node && (buttonRef.current?.contains(nextTarget) || tooltipRef.current?.contains(nextTarget))) return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }

  return <>
    <button
      ref={buttonRef}
      type="button"
      className="help-tip-button"
      aria-label={`Wyjaśnij: ${label}`}
      aria-describedby={open ? id : undefined}
      aria-expanded={open}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={(event) => closeUnlessActive(event.relatedTarget)}
      onFocus={() => { cancelClose(); setOpen(true); }}
      onBlur={() => { if (!pinned) { cancelClose(); setOpen(false); } }}
      onClick={() => {
        cancelClose();
        setPinned(!pinned);
        setOpen(!pinned);
      }}
    >
      <CircleHelp size={13} aria-hidden="true" />
    </button>
    {open && createPortal(
      <div
        ref={tooltipRef}
        id={id}
        role="tooltip"
        className="help-tooltip"
        style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
        onMouseEnter={cancelClose}
        onMouseLeave={(event) => closeUnlessActive(event.relatedTarget)}
      >
        {text}
      </div>,
      document.body,
    )}
  </>;
}
