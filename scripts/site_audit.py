#!/usr/bin/env python3
"""Offline, read-only checks and asset inventory for the static preview.

Uses Python's standard library only. A Sheet export may be supplied with
--sheet-source; it is scanned in memory and never copied into the report.
No file is deleted or moved. A missing reference is not proof of non-use.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

PREVIEW_PREFIX = "/yachielab-preview"
ASSET_DIRS = ("img", "img_new", "pdf")
SOURCE_SUFFIXES = {".html", ".css", ".js", ".gs", ".json"}
TOKEN_PATTERN = re.compile(r"(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})")
PRODUCTION_URL = re.compile(r"https?://(?:www\.)?yachie-lab\.org(?=[/\s\"'<>)]|$)", re.I)
CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.I)
CSS_IMPORT = re.compile(r"@import\s+(['\"])(.*?)\1", re.I)
QUOTED = re.compile(r"(['\"`])((?:\\.|(?!\1).)*?)\1", re.S)
DYNAMIC_CODE_PATH = re.compile(r"\$(?:[1-9]|\{)")
CONCAT_AFTER_LITERAL = re.compile(r"(?:\s|/\*[\s\S]*?\*/|//[^\n]*(?:\n|$))*\+")
HEADER_SVG_FAMILY = tuple(
    "img/header-" + affiliation + "-" + color + ".svg"
    for affiliation in ("ubc", "osaka") for color in ("white", "teal")
)


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: Counter[str] = Counter()
        self.refs: list[tuple[str, str, int]] = []
        self.robots: list[str] = []
        self.tags: Counter[str] = Counter()
        self.inline_style: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        self.tags[tag] += 1
        identifier = attrs_dict.get("id")
        if identifier:
            self.ids[identifier] += 1
        if tag == "meta" and (attrs_dict.get("name") or "").lower() == "robots":
            self.robots.append(attrs_dict.get("content") or "")
        if attrs_dict.get("style"):
            self.inline_style.append(attrs_dict["style"] or "")
        for key in ("href", "src", "poster", "data"):
            if attrs_dict.get(key):
                self.refs.append((key, attrs_dict[key] or "", self.getpos()[0]))
        # The site's current srcset values contain no data URLs or comma filenames.
        if attrs_dict.get("srcset"):
            for candidate in (attrs_dict["srcset"] or "").split(","):
                parts = candidate.strip().split()
                if parts:
                    self.refs.append(("srcset", parts[0], self.getpos()[0]))

    handle_startendtag = handle_starttag


def local_target(root: Path, source: Path, value: str) -> tuple[str | None, str]:
    """Resolve a public URL/path against the root without touching the network."""
    root = root.resolve()
    source = source.resolve()
    value = unescape(value.strip())
    try:
        parts = urlsplit(value)
    except ValueError:
        return None, ""
    if parts.scheme in {"mailto", "tel", "data", "javascript", "blob"}:
        return None, ""
    if parts.netloc:
        if parts.netloc.lower() != "ponnhide.github.io":
            return None, ""
        if not (parts.path == PREVIEW_PREFIX or parts.path.startswith(PREVIEW_PREFIX + "/")):
            return None, ""
        path = parts.path[len(PREVIEW_PREFIX):].lstrip("/") or "index.html"
    elif parts.path.startswith("/"):
        path = parts.path
        if path == PREVIEW_PREFIX or path.startswith(PREVIEW_PREFIX + "/"):
            path = path[len(PREVIEW_PREFIX):]
        path = path.lstrip("/") or "index.html"
    elif not parts.path:
        path = source.relative_to(root).as_posix()
    else:
        path = (source.parent / unquote(parts.path)).resolve().relative_to(root).as_posix() if (source.parent / unquote(parts.path)).resolve().is_relative_to(root) else "../" + parts.path
    path = unquote(path)
    candidate = root / path
    if candidate.is_dir():
        path = (Path(path) / "index.html").as_posix()
    elif not candidate.exists() and not Path(path).suffix and (root / (path + ".html")).is_file():
        path += ".html"
    return path, unquote(parts.fragment)


def walk_strings(value: object):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)


def file_kind(path: Path) -> str:
    with path.open("rb") as handle:
        header = handle.read(512)
    stripped = header.lstrip().lower()
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "webp"
    if header.startswith(b"%PDF-"):
        return "pdf"
    if b"<svg" in stripped:
        return "svg"
    if stripped.startswith((b"<!doctype html", b"<html")):
        return "html"
    if header.startswith(b"\x00\x00\x01\x00"):
        return "ico"
    if header[4:8] == b"ftyp" and any(x in header[:40] for x in (b"heic", b"heix", b"mif1")):
        return "heic"
    return "unknown"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def audit(root: Path, sheet_sources: list[Path]) -> dict:
    root = root.resolve()
    assets = sorted(path for name in ASSET_DIRS for path in (root / name).rglob("*") if path.is_file())
    source_files = sorted(path for folder in (root, root / "css", root / "js", root / "cms") for path in (folder.glob("*.*") if folder == root else folder.rglob("*.*")) if path.is_file() and path.suffix in SOURCE_SUFFIXES)
    source_files = sorted(set(source_files))
    sources = [(path.relative_to(root).as_posix(), path, path.read_text(encoding="utf-8", errors="replace")) for path in source_files]
    errors: list[dict] = []
    warnings: list[dict] = []
    refs: dict[str, set[str]] = defaultdict(set)
    pages: dict[str, Page] = {}
    checked_links: list[tuple[str, str, str, str, int]] = []

    # Developer documentation and tools are not runtime asset references, but
    # credentials must not be published in them either.
    secret_text_files = set(source_files)
    for folder in (root, root / "scripts", root / "docs", root / ".github"):
        paths = folder.glob("*.*") if folder == root else folder.rglob("*.*")
        secret_text_files.update(path for path in paths if path.is_file() and path.suffix in {".md", ".py", ".yaml", ".yml", ".json"})
    for path in sorted(secret_text_files):
        if TOKEN_PATTERN.search(path.read_text(encoding="utf-8", errors="replace")):
            errors.append({"code": "credential-literal", "source": path.relative_to(root).as_posix()})

    def add_ref(source: str, path: Path, value: str, kind: str, line: int = 0) -> None:
        target, fragment = local_target(root, path, value)
        if target is not None:
            refs[target].add(source + ":" + kind)
            checked_links.append((source, value, target, fragment, line))

    for name, path, content in sources:
        if path.suffix == ".html":
            page = Page()
            page.feed(content)
            pages[name] = page
            if not any(re.search(r"\bnoindex\b", item, re.I) for item in page.robots):
                errors.append({"code": "missing-preview-noindex", "source": name})
            if PRODUCTION_URL.search(content):
                errors.append({"code": "production-site-url", "source": name})
            if re.search(r"googletagmanager\.com/gtag/|gtag\(['\"]config", content):
                errors.append({"code": "production-analytics", "source": name})
            for key, value, line in page.refs:
                add_ref(name, path, value, key, line)
            for style in page.inline_style:
                for match in CSS_URL.finditer(style):
                    add_ref(name, path, match[2], "inline-style")
            for identifier, count in page.ids.items():
                if count > 1:
                    warnings.append({"code": "duplicate-id", "source": name, "id": identifier, "count": count})
        elif path.suffix == ".css":
            active = re.sub(r"/\*[\s\S]*?\*/", "", content)
            for match in CSS_URL.finditer(active):
                add_ref(name, path, match[2], "css-url", active[:match.start()].count("\n") + 1)
            for match in CSS_IMPORT.finditer(active):
                add_ref(name, path, match[2], "css-import", active[:match.start()].count("\n") + 1)
        elif path.suffix in {".js", ".gs"}:
            for match in QUOTED.finditer(content):
                value = match[2]
                # Replacement backreferences and template interpolation are
                # runtime expressions, not literal files named '$1' or '${...}'.
                # This exemption is only for code; actual HTML URLs still get
                # checked. Filename/stem evidence below remains conservative.
                if DYNAMIC_CODE_PATH.search(value):
                    continue
                if re.match(r"(?:\./|\.\./|/)?(?:img|img_new|pdf)/[^\n]+$", value):
                    # A quoted prefix immediately concatenated with a filename
                    # is not a literal resource. A complete filename remains a
                    # real reference even when a query string is added to it.
                    fragment = not Path(urlsplit(value).path).suffix
                    if fragment and CONCAT_AFTER_LITERAL.match(content, match.end()):
                        prefix, _ = local_target(root, root / "index.html", value)
                        if prefix in {"img/header-", "img/header-ubc-", "img/header-osaka-"}:
                            for member in HEADER_SVG_FAMILY:
                                if member.startswith(prefix):
                                    add_ref(name, root / "index.html", member, "code-header-svg-family")
                        continue
                    # Browser-side JS resolves relative URLs against the page.
                    add_ref(name, root / "index.html", value, "code-literal")
                elif path.suffix == ".js" and re.match(r"(?:\./|\.\./)?(?:css|js)/[^\n]+$", value):
                    add_ref(name, root / "index.html", value, "code-literal")

    if (root / "CNAME").exists():
        errors.append({"code": "preview-cname", "source": "CNAME"})
    if not (root / ".nojekyll").exists():
        errors.append({"code": "missing-nojekyll", "source": ".nojekyll"})

    for source, value, target, fragment, line in checked_links:
        if target.startswith("../"):
            errors.append({"code": "outside-site-root", "source": source, "line": line, "url": value})
        elif not (root / target).is_file():
            errors.append({"code": "missing-local-file", "source": source, "line": line, "url": value, "target": target})
        elif fragment and target in pages and fragment not in pages[target].ids:
            warnings.append({"code": "missing-local-fragment", "source": source, "line": line, "url": value})

    sheet_texts: list[str] = []
    sheet_tabs: set[str] = set()
    for path in sheet_sources:
        # Parsing JSON avoids matching container syntax rather than cell content.
        sheet_data = json.loads(path.read_text(encoding="utf-8"))
        sheet_texts.extend(walk_strings(sheet_data))
        if isinstance(sheet_data, dict) and isinstance(sheet_data.get("sheets"), list):
            for tab in sheet_data["sheets"]:
                if isinstance(tab, dict) and isinstance(tab.get("title"), str):
                    sheet_tabs.add(tab["title"])
    static_text = "\n".join(content for _, _, content in sources)
    sheet_text = "\n".join(sheet_texts)
    records: list[dict] = []
    groups: dict[str, list[str]] = defaultdict(list)
    image_kind = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif", ".webp": "webp", ".svg": "svg", ".ico": "ico", ".heic": "heic", ".pdf": "pdf"}
    for path in assets:
        name = path.relative_to(root).as_posix()
        evidence = set(refs.get(name, set()))
        # Conservative name matches cover inline markup, archive code, and the
        # index animation's extensionless name + '.png' expression. They may
        # include comments; therefore they can only reduce deletion candidates.
        if path.name in static_text:
            evidence.add("source:filename-match")
        if path.suffix.lower() == ".png" and re.search(r"['\"]" + re.escape(path.stem) + r"['\"]", static_text):
            evidence.add("source:dynamic-png-stem")
        if path.name in sheet_text or name in sheet_text:
            evidence.add("sheet:filename-match")
        kind = file_kind(path)
        expected = image_kind.get(path.suffix.lower())
        sha = digest(path)
        groups[sha].append(name)
        if expected and kind != expected and kind != "unknown":
            warnings.append({"code": "asset-type-mismatch", "source": name, "expected": expected, "detected": kind})
        if expected and kind == "html" and refs.get(name):
            errors.append({"code": "html-in-media-file", "source": name})
        records.append({"path": name, "bytes": path.stat().st_size, "sha256": sha, "kind": kind, "reference_evidence": sorted(evidence), "status": "referenced" if evidence else "review-candidate", "source_asset": path.suffix.lower() in {".afdesign", ".heic"}})

    duplicate_groups = [{"sha256": sha, "paths": paths, "bytes_each": (root / paths[0]).stat().st_size} for sha, paths in sorted(groups.items()) if len(paths) > 1]
    # Deduplicate repeated link failures without concealing separate sources.
    errors = [json.loads(item) for item in sorted({TOKEN_PATTERN.sub("[REDACTED]", json.dumps(item, sort_keys=True, ensure_ascii=False)) for item in errors})]
    warnings = [json.loads(item) for item in sorted({TOKEN_PATTERN.sub("[REDACTED]", json.dumps(item, sort_keys=True, ensure_ascii=False)) for item in warnings})]
    return {
        "schema_version": 1,
        "scope": {
            "asset_directories": list(ASSET_DIRS),
            "source_files": len(sources),
            "secret_text_files": len(secret_text_files),
            "html_pages": len(pages),
            "sheet_sources_supplied": len(sheet_sources),
            "sheet_tabs_supplied": len(sheet_tabs),
            "external_direct_links_checked": False,
        },
        "summary": {
            "asset_files": len(records),
            "asset_bytes": sum(r["bytes"] for r in records),
            "referenced_assets": sum(r["status"] == "referenced" for r in records),
            "review_candidates": sum(r["status"] == "review-candidate" for r in records),
            "review_candidate_bytes": sum(r["bytes"] for r in records if r["status"] == "review-candidate"),
            "duplicate_groups": len(duplicate_groups),
            "errors": len(errors),
            "warnings": len(warnings),
        },
        "errors": errors,
        "warnings": warnings,
        "assets": records,
        "duplicate_groups": duplicate_groups,
        "unused_stylesheet_candidates": [
            p.relative_to(root).as_posix() for p in sorted((root / "css").glob("*.css"))
            if p.relative_to(root).as_posix() not in refs
        ],
    }


def markdown_report(report: dict) -> str:
    summary = report["summary"]
    rows = [
        "# 画像・PDF の資産監査", "",
        "このファイルは `scripts/site_audit.py --markdown docs/assets/README.md` で生成します。個別のパス・SHA-256・参照証拠・重複は [manifest.json](manifest.json) に保存しています。", "",
        "## 範囲と結果", "",
        "HTML / CSS / JS / GAS のローカルソースを確認しました。ファイル名の動的組み立てやコメントも保守的に参照証拠へ含めるため、参照数は実行時の使用数とは一致しません。外部からの直接リンクは確認できていません。", "",
        "| 項目 | 結果 |", "| --- | --- |",
        f"| 画像・PDF のファイル | {summary['asset_files']} |",
        f"| 総容量 | {summary['asset_bytes'] / 1024 / 1024:.1f} MiB |",
        f"| 参照証拠あり | {summary['referenced_assets']} |",
        f"| 参照証拠なしの確認候補 | {summary['review_candidates']} |",
        f"| 候補の容量 | {summary['review_candidate_bytes'] / 1024 / 1024:.1f} MiB |",
        f"| SHA-256 が同一のグループ | {summary['duplicate_groups']} |",
        f"| Sheet JSON の入力ファイル | {report['scope']['sheet_sources_supplied']} |",
        f"| 入力された Sheet のタブ | {report['scope']['sheet_tabs_supplied']} |",
        f"| 具体的な検査エラー | {summary['errors']} |", "",
        "**確認候補は削除候補の確定ではありません。** Sheet、生成処理、組み立てた URL、過去の公開資料、外部リンクの確認が必要です。この整理では既存の画像・PDF を削除・移動していません。", "",
        "## 作業元のファイル", "",
        "ブラウザ向け配信物以外の形式を個別に記録します。元の公開パスは維持しています。", "",
    ]
    for asset in report["assets"]:
        if asset["source_asset"]:
            rows.append(f"- `{asset['path']}` ({asset['bytes'] / 1024 / 1024:.1f} MiB)")
    rows += ["", "## 形式が一致しないファイル", "", "画像拡張子なのに HTML になっているものなどを記録します。未参照のファイルは公開表示の不具合と断定しません。", ""]
    mismatch = [item for item in report["warnings"] if item["code"] == "asset-type-mismatch"]
    if mismatch:
        for item in mismatch:
            rows.append(f"- `{item['source']}`: 拡張子から期待する形式 `{item['expected']}`、実体 `{item['detected']}`")
    else:
        rows.append("検出なし。")
    rows += ["", "## 容量の大きい確認候補", "", "上位 20 件です。全件の一覧は manifest.json の `status: review-candidate` を参照してください。", "", "| パス | MiB |", "| --- | ---: |"]
    candidates = sorted((asset for asset in report["assets"] if asset["status"] == "review-candidate"), key=lambda asset: (-asset["bytes"], asset["path"]))
    for asset in candidates[:20]:
        rows.append(f"| `{asset['path']}` | {asset['bytes'] / 1024 / 1024:.1f} |")
    rows += ["", "## 参照が見つからない CSS", "", "HTML / JS の静的参照を基準にしています。旧資料や外部利用を確認してから整理してください。", ""]
    if report["unused_stylesheet_candidates"]:
        rows += [f"- `{path}`" for path in report["unused_stylesheet_candidates"]]
    else:
        rows.append("検出なし。")
    rows += ["", "## 再生成", "", "Sheet の入力を含める場合は、非公開の JSON をリポジトリ外に置きます。セルの内容はレポートに保存しません。", "", "```sh", "python3 scripts/site_audit.py --sheet-data /private/tmp/yachielab-preview-sheet-source.json --output docs/assets/manifest.json --markdown docs/assets/README.md", "```", "", "`--check` は欠落したローカルファイル、参照中の HTML 実体画像、機密情報らしい文字列、プレビューの公開設定などの具体的エラーで失敗します。重複ファイル・参照候補・重複 ID は別途レビューできる警告です。", ""]
    return "\n".join(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--sheet-source", "--sheet-data", dest="sheet_source", action="append", type=Path, default=[], help="Optional private JSON export with Sheet cell strings; repeat for multiple files")
    parser.add_argument("--output", type=Path, help="Write deterministic report JSON; the private Sheet data is never included")
    parser.add_argument("--markdown", type=Path, help="Write the human-readable asset report")
    parser.add_argument("--check", action="store_true", help="Exit 1 on concrete errors; review candidates and duplicate IDs remain warnings")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        report = audit(root, args.sheet_source)
    except (OSError, ValueError) as exc:
        print("Audit input error: " + str(exc), file=sys.stderr)
        return 2
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.markdown:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(markdown_report(report), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    for issue in report["errors"]:
        print("ERROR " + json.dumps(issue, ensure_ascii=False))
    return 1 if args.check and report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
