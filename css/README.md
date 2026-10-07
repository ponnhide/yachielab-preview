# CSS maintenance

The filenames directly under `css/` are stable entrypoints used by existing
HTML and the Sheets CMS. Keep them available when reorganizing styles.

`common.css` imports these files in order:

1. `base.css`: document background, default font and links.
2. `layout.css`: desktop shell, content column and footer geometry.
3. `components.css`: logo layers, navigation, headings and footer defaults.
4. `responsive.css`: shared rules at the 600 px mobile boundary.

Page entrypoints import `pages/`; reusable content, people layout, Chinese
fonts and social embeds live in `components/`. The Instagram filters are an
unchanged third-party stylesheet under `vendor/`. Historical, unreferenced
styles live in `legacy/`, with compatibility imports at their original URLs.
They are retained for reference and are not linked by the registered pages.

Do not add a document-wide `box-sizing` rule to a component stylesheet. The
social card's border-box sizing and utility classes are scoped to `.x-embed`.
The short Summer Camp page retains border-box sizing only for `main` and its
`.posts` container via `data-page="summercamp_2026"` on an ancestor. This keeps
the mobile header padding inside the main height and preserves the previous
minimum-height and footer position without reviving the global rule.

## Sheets style contract

The CMS owns explicit values entered into its custom **Style**, **Image style**
and image-size fields. It emits those supported declarations as inline
`!important` styles and lists their names in `data-sheet-style`, for example:

```html
<section class="content" data-sheet-style="font-size margin-bottom"
         style="font-size: 18px !important; margin-bottom: 12px !important;">
```

This is a deliberate opt-in. Automatically generated layout defaults remain
ordinary inline declarations, so responsive CSS can still change them. CSS
provides defaults when no explicit custom value is supplied. Do not add
JavaScript that repeatedly writes a content font, image size or spacing value
and defeats the CMS setting.

Typography, colors, content image dimensions, spacing and flex alignment can
be overridden. The renderer keeps position, stacking, visibility, clipping,
overflow and motion under the site controllers' authority. Structural
containers and the paired header logos must keep that behavior.

Some important defaults intentionally remain for legacy, unmarked HTML:
navigation alignment, footer spacing/color/SNS row height and Chinese fallback
fonts. A promoted inline important declaration wins over these rules. Before
promoting an existing custom Sheet value that was previously ignored, migrate
that value to the site's current effective value if the existing appearance
must be retained. In particular, the SNS footer row was effectively **20%**
high while its old Sheet value was **42%**.

## Behavior to preserve

- The two white/teal SVG logo layers share the same width and margin geometry.
  `object-fit: cover` and `object-position: top` let the controller crop the
  white image at the header boundary while retaining the teal image beneath.
- The shared mobile breakpoint remains 600 px in both CSS and JavaScript.
- The homepage's illustration positions and animations remain page specific.
- The current pages use quirks mode. A DOCTYPE migration requires a separate
  visual review and must not be bundled into a stylesheet cleanup.
