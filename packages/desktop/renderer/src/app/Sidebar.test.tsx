import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NAV_ITEMS } from './routes';
import { Sidebar } from './Sidebar';

afterEach(() => {
  cleanup();
});

function renderSidebarAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('NAV-2: renders a nav landmark with exactly six links, accessible names in NAV_ITEMS order', () => {
    renderSidebarAt('/dashboard');

    const nav = screen.getByRole('navigation');
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(6);
    expect(nav.contains(links[0] ?? null)).toBe(true);
    expect(links.map((link) => link.textContent)).toEqual(NAV_ITEMS.map((item) => item.label));
  });

  it.each(NAV_ITEMS)(
    'NAV-5: navigating to $path marks exactly one link aria-current="page", and it is $label',
    ({ path, label }) => {
      const { container } = renderSidebarAt(path);

      const current = container.querySelectorAll('[aria-current="page"]');
      expect(current).toHaveLength(1);
      expect(current[0]?.textContent).toBe(label);
    },
  );

  it('NAV-7: every link is a real anchor with a non-empty href, and Tab visits them in NAV_ITEMS order', async () => {
    // A real Tab keypress (userEvent.tab()), not link.focus() — a
    // programmatic .focus() call succeeds even on a tabindex="-1" element,
    // so it can't tell a genuine tab-order regression from a link that has
    // been pulled out of the tab sequence.
    const user = userEvent.setup();
    renderSidebarAt('/dashboard');

    const links = screen.getAllByRole('link') as HTMLAnchorElement[];
    expect(links).toHaveLength(NAV_ITEMS.length);
    links.forEach((link) => {
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBeTruthy();
    });

    for (const [index, item] of NAV_ITEMS.entries()) {
      await user.tab();
      expect(document.activeElement).toBe(links[index]);
      expect(document.activeElement?.textContent).toBe(item.label);
    }
  });

  it('NAV-12: no badge renders for the shipped NAV_ITEMS (none supply badgeCount)', () => {
    renderSidebarAt('/dashboard');

    // A rendered badge would append its digits to the link's text content
    // (e.g. "Review queue3"); asserting each link's full text equals
    // exactly its plain label is a check that actually fails if a badge
    // unexpectedly renders, unlike querying for a literal sentinel string
    // nothing ever renders.
    const links = screen.getAllByRole('link');
    links.forEach((link, index) => {
      expect(link.textContent).toBe(NAV_ITEMS[index]?.label);
    });
  });

  it('NAV-12: a badge renders only when badgeCount is defined and > 0 (positive and zero cases)', async () => {
    vi.resetModules();
    vi.doMock('./routes', () => ({
      NAV_ITEMS: [
        { path: '/dashboard', label: 'Dashboard', badgeCount: 3 },
        { path: '/targets', label: 'Targets', badgeCount: 0 },
        { path: '/sessions', label: 'Sessions' },
      ],
    }));

    try {
      const { Sidebar: MockedSidebar } = await import('./Sidebar');
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <MockedSidebar />
        </MemoryRouter>,
      );

      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(3);

      // Positive: badgeCount: 3 renders a badge appending "3" to the link.
      expect(links[0]?.textContent).toBe('Dashboard3');
      expect(screen.getByText('3')).toBeTruthy();

      // Zero: badgeCount: 0 is defined but not > 0 — no badge.
      expect(links[1]?.textContent).toBe('Targets');

      // Undefined: no badgeCount at all — no badge.
      expect(links[2]?.textContent).toBe('Sessions');
    } finally {
      vi.doUnmock('./routes');
      vi.resetModules();
    }
  });
});
