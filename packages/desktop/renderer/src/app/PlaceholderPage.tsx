import styles from './PlaceholderPage.module.css';

export interface PlaceholderPageProps {
  title: string;
  description: string;
}

/**
 * Shared placeholder body for every DD-008 page this issue does not build
 * real content for yet: a title and a one-line "what will appear here"
 * description (DD-008's "empty states teach" convention, applied minimally
 * — full empty-state UX is each page's own future issue).
 */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className={styles.placeholder}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.description}>{description}</p>
    </div>
  );
}
