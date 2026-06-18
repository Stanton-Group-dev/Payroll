'use client'

import { ReactNode } from 'react'

/**
 * Full-height page shell whose body is a single vertical scroll region.
 *
 * Everything passed as `children` lives inside that scroll region, so a page
 * header placed first scrolls up out of view as the user scrolls down. Any
 * descendant styled `position: sticky; top: 0` — e.g. `<DataTable stickyHeader />`
 * — then pins to the top of the region. `overlay` (a Drawer/modal) renders as a
 * sibling of the scroll region so it is never clipped or scrolled.
 *
 * Why the specific classes:
 * - `h-screen` bounds the shell to the viewport. This is the critical bit: a
 *   `h-full` chain does not reliably create a bounded scroll context here (the
 *   parent `<main>` is `min-h-screen`, which can grow), so the document scrolls
 *   instead of an internal region — taking the sidebar and any sticky header with
 *   it. `h-screen` pins the shell to the viewport regardless of ancestor sizing.
 * - `flex-1 min-h-0 overflow-auto` makes the body the one scrolling element.
 *   `min-h-0` lets the flex child shrink below its content height so it actually
 *   scrolls rather than expanding and pushing the document.
 */
export function StickyTableLayout({
  children,
  overlay,
  className = '',
}: {
  children: ReactNode
  overlay?: ReactNode
  className?: string
}) {
  return (
    <div className="flex flex-col h-screen">
      <div className={`flex-1 min-h-0 overflow-auto ${className}`}>{children}</div>
      {overlay}
    </div>
  )
}
