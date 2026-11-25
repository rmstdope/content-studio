/**
 * Mounts a middle page's previous/next control beside the feature a test renders, at the address
 * `#/here`; the answer unmounts it and puts the address back.
 */
export async function mountPager(): Promise<() => void> {
  // Imported here: React reads `window` when react-dom loads, after the test file has made one.
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Pager } = await import('../src/ui/components/Pager')
  const root = createRoot(document.createElement('div'))
  const before = window.location.hash
  window.location.hash = '#/here'
  act(() =>
    root.render(
      createElement(Pager, {
        place: { position: 2, count: 3 },
        previous: { name: 'Before', href: '#/before' },
        next: { name: 'After', href: '#/after' },
      }),
    ),
  )
  return () => {
    act(() => root.unmount())
    window.location.hash = before
  }
}
