# Yachie Lab preview

This is an independent public preview of the Yachie Lab website.

- Source snapshot: `yachielab/yachielab.github.io` at `fe9429cd9a0fee84ae23f40e33a20af708ff71fd`.
- Pages source: `codex/preview`, repository root.
- Preview URL: https://ponnhide.github.io/yachielab-preview/
- The production repository and custom domain are not deployment targets of this copy.

Initial changes only isolate the preview: remove the production CNAME and Google Analytics tag, keep links inside the preview, add noindex metadata, and recognize the project homepage path in the mobile menu. Existing page content, styles, assets, and interactions are retained.

The preview CMS uses a separate native Google Sheets copy and its separate bound Apps Script project. Its GitHub credential must be set privately in Script Properties as `PREVIEW_GITHUB_TOKEN`; use a credential limited to this preview repository. Never commit credentials. The copied script is guarded to write only this repository's `codex/preview` branch from its designated preview spreadsheet.
