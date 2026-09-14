/**
 * Pure, mechanical detector for hardcoded colour values outside the token
 * layer (DD-008: "all colors via CSS custom properties"). Exported so it can
 * be table-driven unit-tested against known-bad/known-good inputs
 * (`no-literal-colors.test.ts`), independent of walking the real repo tree.
 *
 * Scans two shapes of source:
 *  - CSS declarations (`.css`/`.module.css`) whose property is one of
 *    `COLOR_PROPERTIES` (longhands AND shorthands — `border`, `outline`,
 *    `box-shadow`, etc., not only the `-color` longhands).
 *  - `.tsx` inline `style={{ … }}` object literals whose key is a matching
 *    colour-ish JS property.
 *
 * The accepted-value set is closed: a value's colour-bearing token passes
 * only if it is a `var(--…)` reference (a `var(--x, <fallback>)` default is
 * allowed — the whole `var(...)` span is treated as opaque) or one of
 * `transparent` / `currentColor` / `inherit` / `initial` / `unset` / `none`.
 * Anything else — a hex literal, an `rgb()`/`rgba()`/`hsl()`/`hsla()` call,
 * or a named CSS colour — is a violation.
 */

export interface Violation {
  file: string;
  line: number;
  message: string;
}

/** CSS properties (longhand AND shorthand) that can carry a colour. */
export const COLOR_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'outline',
  'outline-color',
  'box-shadow',
  'text-shadow',
  'fill',
  'stroke',
  'caret-color',
  'accent-color',
  'text-decoration-color',
  'column-rule-color',
]);

/** The `style={{ … }}` JS-object counterparts of `COLOR_PROPERTIES`. */
const JSX_COLOR_KEYS = new Set([
  'color',
  'background',
  'backgroundColor',
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'borderColor',
  'outline',
  'outlineColor',
  'boxShadow',
  'textShadow',
  'fill',
  'stroke',
  'caretColor',
  'accentColor',
  'textDecorationColor',
  'columnRuleColor',
]);

const ALLOWED_VALUE_KEYWORDS = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'none',
]);

/** Standard CSS3 extended named colours (lowercased), minus `transparent`
 * (handled as an always-allowed keyword above, not a "literal colour"). */
const NAMED_COLORS = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
]);

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      line += 1;
    }
  }
  return line;
}

/** Strips CSS block comments while preserving newlines/length so byte
 * offsets (and therefore line numbers) into the rest of the file stay
 * accurate. */
function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

function hasLiteralColorToken(rawValue: string): boolean {
  // `var(...)` spans (including any fallback argument) are always opaque —
  // strip them before looking for a literal colour in what remains.
  const withoutVarCalls = rawValue.replace(/var\([^()]*\)/gi, ' ');

  if (/#[0-9a-fA-F]{3,8}\b/.test(withoutVarCalls)) {
    return true;
  }
  if (/\b(rgb|rgba|hsl|hsla)\s*\(/i.test(withoutVarCalls)) {
    return true;
  }

  const tokens = withoutVarCalls
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (ALLOWED_VALUE_KEYWORDS.has(lower)) {
      continue;
    }
    if (NAMED_COLORS.has(lower)) {
      return true;
    }
  }
  return false;
}

/** Scans CSS declarations (`property: value;`) for a colour-bearing
 * property whose value contains a literal colour. */
function findCssViolations(source: string, filename: string): Violation[] {
  const violations: Violation[] = [];
  const withoutComments = stripCssComments(source);
  const declarationPattern = /([a-zA-Z-]+)\s*:\s*([^;{}]+);/g;
  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(withoutComments)) !== null) {
    const [, rawProperty, rawValue] = match;
    if (rawProperty === undefined || rawValue === undefined) {
      continue;
    }
    const property = rawProperty.trim().toLowerCase();
    if (!COLOR_PROPERTIES.has(property)) {
      continue;
    }
    if (hasLiteralColorToken(rawValue)) {
      violations.push({
        file: filename,
        line: lineNumberAt(source, match.index),
        message: `literal colour in "${property}: ${rawValue.trim()}"`,
      });
    }
  }
  return violations;
}

/** Scans `.tsx` source for `style={{ … }}` object literals whose colour-ish
 * key holds a literal (string-valued) colour. */
function findJsxViolations(source: string, filename: string): Violation[] {
  const violations: Violation[] = [];
  const stylePattern = /style=\{\{([\s\S]*?)\}\}/g;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = stylePattern.exec(source)) !== null) {
    const [, objectBody] = styleMatch;
    if (objectBody === undefined) {
      continue;
    }
    const objectStart = styleMatch.index;
    const entryPattern = /([A-Za-z0-9_]+)\s*:\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2/g;
    let entryMatch: RegExpExecArray | null;
    while ((entryMatch = entryPattern.exec(objectBody)) !== null) {
      const [, rawKey, , rawValue] = entryMatch;
      if (rawKey === undefined || rawValue === undefined) {
        continue;
      }
      if (!JSX_COLOR_KEYS.has(rawKey)) {
        continue;
      }
      if (hasLiteralColorToken(rawValue)) {
        violations.push({
          file: filename,
          line: lineNumberAt(source, objectStart + (entryMatch.index ?? 0)),
          message: `literal colour in JSX style "${rawKey}: '${rawValue}'"`,
        });
      }
    }
  }
  return violations;
}

/**
 * Finds every literal-colour violation in `source`. `filename` is used only
 * to (a) decide CSS-declaration vs. JSX-`style` scanning by extension and
 * (b) label the returned violations — it need not be a real file on disk.
 */
export function findLiteralColorViolations(source: string, filename: string): Violation[] {
  if (filename.endsWith('.tsx')) {
    return findJsxViolations(source, filename);
  }
  return findCssViolations(source, filename);
}
