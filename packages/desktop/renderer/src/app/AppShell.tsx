import { Outlet, useLocation } from 'react-router';

import { DevPanel } from '../DevPanel';
import { GlobalScanProgress } from './GlobalScanProgress';
import { NAV_ITEMS } from './routes';
import { Sidebar } from './Sidebar';
import styles from './AppShell.module.css';

function currentPageTitle(pathname: string): string {
  const match = NAV_ITEMS.find(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
  return match?.label ?? '';
}

/**
 * The DD-008 shell chrome: brand mark, sidebar, a header row carrying the
 * current page title and the global scan-progress slot, and the routed
 * `<Outlet/>` content area. Mounted once at `/` in `App.tsx`; every page
 * renders inside it.
 */
export function AppShell() {
  const location = useLocation();
  const pageTitle = currentPageTitle(location.pathname);

  return (
    <div className={styles.shell}>
      <div className={styles.sidebarArea}>
        <Sidebar />
      </div>
      <div className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.brand}>AstroTracker</h1>
          <p className={styles.pageTitle}>{pageTitle}</p>
          <GlobalScanProgress />
        </header>
        <div className={styles.content}>
          <Outlet />
        </div>
        <DevPanel />
      </div>
    </div>
  );
}
