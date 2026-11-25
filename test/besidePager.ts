/** A middle page's previous/next control, mounted beside the feature a test renders. */
export async function mountPager(): Promise<() => void> {
  // Imported here: React reads `window` when react-dom loads, after the test file has made one.
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Pager } = await import('../src/ui/components/Pager')
  const root = createRoot(document.createElement('div'))
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
  return () => act(() => root.unmount())
}
