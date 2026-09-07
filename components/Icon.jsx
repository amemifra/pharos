/**
 * Icone SVG inline — zero dipendenze.
 * @param {{name: string, className?: string}} props
 */
export default function Icon({ name, className = "h-5 w-5" }) {
  const paths = {
    home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.8-3.8" /></>,
    library: <><path d="M4 4v16M9 4v16" /><path d="m13 5 5 15" /></>,
    play: <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />,
    pause: <><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /></>,
    next: <><path d="M5 4.5v15l10-7.5z" fill="currentColor" stroke="none" /><rect x="16" y="4" width="3" height="16" rx="1" fill="currentColor" stroke="none" /></>,
    prev: <><path d="M19 4.5v15l-10-7.5z" fill="currentColor" stroke="none" /><rect x="5" y="4" width="3" height="16" rx="1" fill="currentColor" stroke="none" /></>,
    note: <><path d="M9 18V5l10-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>,
    close: <><path d="m5 5 14 14" /><path d="m19 5-14 14" /></>,
    podcast: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
