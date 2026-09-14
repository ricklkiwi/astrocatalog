import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

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

  it('NAV-7: every link is a real anchor with a non-empty href, focusable in NAV_ITEMS order', () => {
    renderSidebarAt('/dashboard');

    const links = screen.getAllByRole('link') as HTMLAnchorElement[];
    expect(links).toHaveLength(NAV_ITEMS.length);
    links.forEach((link, index) => {
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBeTruthy();
      link.focus();
      expect(document.activeElement).toBe(link);
      expect(link.textContent).toBe(NAV_ITEMS[index]?.label);
    });
  });

  it('NAV-12: no badge renders for the shipped NAV_ITEMS (none supply badgeCount)', () => {
    renderSidebarAt('/dashboard');

    for (const item of NAV_ITEMS) {
      expect(screen.queryByText(String(item.badgeCount ?? '__none__'))).toBeNull();
    }
  });
});
