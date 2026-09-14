import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PlaceholderPage } from './PlaceholderPage';

afterEach(() => {
  cleanup();
});

describe('PlaceholderPage', () => {
  it('renders the title as a heading and the description as body text', () => {
    render(<PlaceholderPage title="Targets" description="Every target will appear here." />);

    expect(screen.getByRole('heading', { name: 'Targets' })).toBeTruthy();
    expect(screen.getByText('Every target will appear here.')).toBeTruthy();
  });

  it('renders a description mentioning a colour word as plain text, not a style/colour concern', () => {
    // Edge Case (plan): a description sentence containing the word "white"
    // must not be treated as a literal-colour violation by
    // no-literal-colors.test.ts — that scanner only inspects CSS
    // declarations and JSX style={{}} objects, never text content.
    render(
      <PlaceholderPage
        title="Calibration"
        description="Master darks, flats, and bias frames — including white balance notes — will appear here."
      />,
    );

    expect(screen.getByText(/including white balance notes/i, { selector: 'p' })).toBeTruthy();
  });
});
