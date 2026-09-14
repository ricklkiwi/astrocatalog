import { NavLink } from 'react-router';

import { NAV_ITEMS } from './routes';
import styles from './Sidebar.module.css';

/**
 * The `<nav>` landmark listing the six DD-008 destinations from `NAV_ITEMS`
 * as real `<a>` elements (`NavLink`), so they are keyboard-reachable with no
 * extra work. `NavLink` sets `aria-current="page"` on the active item
 * itself; `Sidebar.module.css` keys the active-item styling off that
 * attribute (`.link[aria-current='page']`), never a hand-managed class, so
 * "the active item is visually indicated" can never drift out of sync with
 * the semantic state a screen reader sees.
 */
export function Sidebar() {
  return (
    <nav aria-label="Primary" className={styles.nav}>
      <ul className={styles.list}>
        {NAV_ITEMS.map((item) => (
          <li key={item.path}>
            <NavLink to={item.path} className={styles.link}>
              {item.label}
              {item.badgeCount !== undefined && item.badgeCount > 0 && (
                <span className={styles.badge}>{item.badgeCount}</span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
