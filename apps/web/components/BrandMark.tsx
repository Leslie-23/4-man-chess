/**
 * The 4-Man Chess mark: a white king standing on a plinth in the four army
 * colours. Plain SVG with fixed colours, so the favicon, the share images
 * (rendered by next/og) and the top bar all draw the same thing.
 * Keep `app/icon.svg` in step with it.
 */
export function BrandMark({ size = 32, rounded = true }: { size?: number; rounded?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="32" height="32" rx={rounded ? 7 : 0} fill="#0b0b0b" />
      <rect x="14.5" y="3" width="3" height="8" fill="#fbfbf8" />
      <rect x="11.5" y="5" width="9" height="3" fill="#fbfbf8" />
      <path d="M8.5 11.5H23.5L20.5 20.5H11.5Z" fill="#fbfbf8" />
      <rect x="10" y="21.5" width="12" height="2" fill="#fbfbf8" />
      <rect x="6" y="25" width="5" height="4" fill="#d7362d" />
      <rect x="11" y="25" width="5" height="4" fill="#2b6be0" />
      <rect x="16" y="25" width="5" height="4" fill="#e0a810" />
      <rect x="21" y="25" width="5" height="4" fill="#229a4f" />
    </svg>
  );
}
