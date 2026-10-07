#!/usr/bin/env python3
"""Regression fixtures for public path resolution and conservative asset auditing."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from site_audit import audit, catalogue_report, local_target


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ("img", "img_new", "pdf", "css", "js", "cms"):
            (self.root / name).mkdir()
        (self.root / ".nojekyll").touch()
        (self.root / "index.html").write_text('<html><head><meta name="robots" content="noindex, nofollow"></head><body id="top"></body></html>')
        (self.root / "contact.html").write_text('<html><head><meta name="robots" content="noindex"></head><body id="contact"></body></html>')

    def tearDown(self):
        self.temp.cleanup()

    def test_preview_paths_query_fragments_and_css_parent(self):
        source = self.root / "index.html"
        for value in ("contact.html?lang=EN&amp;affil=UBC#contact", "/yachielab-preview/contact.html?lang=EN#contact", "https://ponnhide.github.io/yachielab-preview/contact.html#contact", "contact#contact"):
            self.assertEqual(local_target(self.root, source, value), ("contact.html", "contact"))
        self.assertEqual(local_target(self.root, self.root / "css/common.css", "../img/a.png"), ("img/a.png", ""))
        self.assertEqual(local_target(self.root, source, "https://ponnhide.github.io/unrelated/contact.html"), (None, ""))
        self.assertEqual(local_target(self.root, source, "mailto:lab@example.com"), (None, ""))

    def test_conservative_static_dynamic_and_private_sheet_evidence(self):
        for name in ("hover.png", "private.png", "candidate.png", "duplicate.png"):
            (self.root / "img" / name).write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        (self.root / "js/index.js").write_text('const animation = ["hover"]; const ext = ".png";')
        (self.root / "css/common.css").write_text('@import "./nested.css"; /* url("../img/comment-only.png") */')
        (self.root / "css/nested.css").write_text('body { color: black; }')
        private_sheet = self.root / "private-sheet-export.txt"
        private_sheet.write_text(json.dumps({"values": [["private.png", "NEVER_INCLUDE_PRIVATE_CELL"]]}))
        report = audit(self.root, [private_sheet])
        by_path = {item["path"]: item for item in report["assets"]}
        self.assertEqual(by_path["img/hover.png"]["status"], "referenced")
        self.assertEqual(by_path["img/private.png"]["status"], "referenced")
        self.assertEqual(by_path["img/candidate.png"]["status"], "review-candidate")
        self.assertEqual(len(report["duplicate_groups"]), 1)
        self.assertNotIn("NEVER_INCLUDE_PRIVATE_CELL", json.dumps(report))
        self.assertFalse(any(item["code"] == "missing-local-file" for item in report["errors"]))

    def test_concrete_security_path_and_media_failures(self):
        token = "github_pat_" + "x" * 40
        (self.root / "cms/config.gs").write_text("const TOKEN = '" + token + "';")
        (self.root / "index.html").write_text('<html><head></head><body><img src="img/not-image.jpg"><a href="missing.html?token=' + token + '">Missing</a><a href="https://yachie-lab.org/">Production</a></body></html>')
        (self.root / "img/not-image.jpg").write_text("<!doctype html><html>Drive login</html>")
        (self.root / "img/unreferenced.jpg").write_text("<!doctype html><html>Drive login</html>")
        (self.root / "CNAME").write_text("yachie-lab.org")
        report = audit(self.root, [])
        codes = {item["code"] for item in report["errors"]}
        self.assertTrue({"credential-literal", "missing-preview-noindex", "production-site-url", "missing-local-file", "html-in-media-file", "preview-cname"} <= codes)
        self.assertNotIn(token, json.dumps(report))
        broken = [item["source"] for item in report["errors"] if item["code"] == "html-in-media-file"]
        self.assertEqual(broken, ["img/not-image.jpg"])

    def test_duplicate_ids_and_missing_fragment_are_reviewable_warnings(self):
        (self.root / "index.html").write_text('<html><head><meta name="robots" content="noindex"></head><body><p id="same"></p><p id="same"></p><a href="contact.html#absent">Contact</a></body></html>')
        report = audit(self.root, [])
        self.assertEqual(report["errors"], [])
        self.assertEqual({item["code"] for item in report["warnings"]}, {"duplicate-id", "missing-local-fragment"})

    def test_generated_replacement_paths_are_not_literal_file_references(self):
        replacements = ["./pdf/$" + str(index) for index in range(1, 10)]
        replacements.append("./img/${filename}.png")
        (self.root / "cms/template.gs").write_text("const replacements = " + json.dumps(replacements) + "; const actual = './pdf/missing.pdf';")
        (self.root / "js/template.js").write_text("const source = `./img/${filename}.png`; ")
        (self.root / "index.html").write_text('<html><head><meta name="robots" content="noindex"></head><body><a href="pdf/$1">Literal HTML URL</a></body></html>')
        report = audit(self.root, [])
        missing = {(issue["source"], issue["target"]) for issue in report["errors"] if issue["code"] == "missing-local-file"}
        self.assertEqual(missing, {("cms/template.gs", "pdf/missing.pdf"), ("index.html", "pdf/$1")})
        self.assertEqual(len(report["errors"]), 2)

    def test_concatenated_prefixes_do_not_hide_real_literal_or_complete_paths(self):
        for affiliation in ("ubc", "osaka"):
            for color in ("white", "teal"):
                (self.root / "img" / ("header-" + affiliation + "-" + color + ".svg")).write_text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
        (self.root / "cms/builder.gs").write_text("const logo = './img/header-ubc-' /* variant */ + color + '.svg'; const generated = './img/generated-' + name + '.png'; const literal = './img/not-real-'; const complete = './img/missing.jpg' + '?v=3';")
        (self.root / "js/fallback.js").write_text("const logo = './img/header-' // affiliation follows\n + affiliation + '-' + color + '.svg';")
        (self.root / "index.html").write_text('<html><head><meta name="robots" content="noindex"></head><body><img src="./img/header-"></body></html>')
        report = audit(self.root, [])
        missing = {(item["source"], item["target"]) for item in report["errors"] if item["code"] == "missing-local-file"}
        self.assertEqual(missing, {("cms/builder.gs", "img/not-real-"), ("cms/builder.gs", "img/missing.jpg"), ("index.html", "img/header-")})
        self.assertEqual(len(report["errors"]), 3)

    def test_finite_header_family_is_referenced_and_missing_members_are_checked(self):
        paths = ["img/header-" + affiliation + "-" + color + ".svg" for affiliation in ("ubc", "osaka") for color in ("white", "teal")]
        for name in paths + ["img/unused.svg"]:
            (self.root / name).write_text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
        (self.root / "cms/builder.gs").write_text("const ubc = './img/header-ubc-' + color + '.svg'; const osaka = './img/header-osaka-' + color + '.svg';")
        (self.root / "js/fallback.js").write_text("const logo = './img/header-' + affiliation + '-' + color + '.svg';")
        report = audit(self.root, [])
        self.assertEqual(report["errors"], [])
        by_path = {item["path"]: item for item in report["assets"]}
        for name in paths:
            self.assertEqual(by_path[name]["status"], "referenced")
            self.assertIn("cms/builder.gs:code-header-svg-family", by_path[name]["reference_evidence"])
            self.assertIn("js/fallback.js:code-header-svg-family", by_path[name]["reference_evidence"])
        self.assertEqual(by_path["img/unused.svg"]["status"], "review-candidate")
        (self.root / "img/header-osaka-teal.svg").unlink()
        missing = audit(self.root, [])["errors"]
        self.assertEqual({item["target"] for item in missing}, {"img/header-osaka-teal.svg"})
        self.assertEqual({item["source"] for item in missing}, {"cms/builder.gs", "js/fallback.js"})

    def test_hashed_filenames_and_version_urls_resolve_to_existing_asset_and_check_missing_one(self):
        image = "portrait--b72148c93e05.jpg"
        (self.root / "img" / image).write_bytes(b"\xff\xd8\xff\xe0fixture")
        (self.root / "index.html").write_text('<html><head><meta name="robots" content="noindex"><link rel="stylesheet" href="css/common.css?v=12"></head><body><img src="./img/' + image + '?v=' + 'a' * 40 + '&amp;size=2"><img src="./img/missing--1a2b3c4d.jpg?v=old"></body></html>')
        (self.root / "css/common.css").write_text('body{background-image:url("../img/' + image + '?v=changed")}')
        self.assertEqual(local_target(self.root, self.root / "index.html", "./img/" + image + "?v=old#picture"), ("img/" + image, "picture"))
        report = audit(self.root, [])
        self.assertEqual([(issue["code"], issue["target"]) for issue in report["errors"]], [("missing-local-file", "img/missing--1a2b3c4d.jpg")])
        asset = report["assets"][0]
        self.assertEqual(asset["reference_class"], "published-reference")
        self.assertEqual(asset["published_reference_evidence"], ["css/common.css:css-url", "index.html:src"])
        self.assertIn("../../img/" + image + ")", catalogue_report(report))

    def test_catalogue_separates_published_graph_source_only_and_unconfirmed_without_deletion(self):
        for name in ("background.png", "hover.png", "old.png", "sheet.png", "candidate.png"):
            (self.root / "img" / name).write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        (self.root / "index.html").write_text('<html><head><meta name="robots" content="noindex"><link rel="stylesheet" href="css/common.css"></head><body><script src="js/index.js?v=1"></script></body></html>')
        (self.root / "css/common.css").write_text('@import "nested.css?v=2";')
        (self.root / "css/nested.css").write_text('@import "common.css";body{background:url("../img/background.png?v=3")}')
        (self.root / "css/unused.css").write_text('body{background:url("../img/old.png")}')
        (self.root / "js/index.js").write_text('const animation = ["hover"]; const extension = ".png";')
        private_sheet = self.root / "sheet-export.txt"
        private_sheet.write_text(json.dumps({"values": [["sheet.png", "PRIVATE_CONTENT_NOT_PUBLISHED"]]}))
        report = audit(self.root, [private_sheet])
        by_path = {asset["path"]: asset for asset in report["assets"]}
        self.assertEqual(by_path["img/background.png"]["reference_class"], "published-reference")
        self.assertEqual(by_path["img/hover.png"]["reference_class"], "published-reference")
        self.assertEqual(by_path["img/old.png"]["reference_class"], "source-reference")
        self.assertEqual(by_path["img/sheet.png"]["reference_class"], "source-reference")
        self.assertEqual(by_path["img/candidate.png"]["reference_class"], "review-candidate")
        self.assertEqual(report["summary"]["published_reference_assets"], 2)
        self.assertEqual(report["summary"]["source_only_reference_assets"], 2)
        self.assertEqual(report["asset_directory_summary"][0], {"directory": "img", "files": 5, "referenced": 4, "review_candidates": 1, "image_files": 5, "image_referenced": 4, "image_review_candidates": 1})
        catalogue = catalogue_report(report)
        self.assertNotIn("PRIVATE_CONTENT_NOT_PUBLISHED", catalogue)
        for name in by_path:
            self.assertEqual(catalogue.count("../../" + name + ")"), 1)
            self.assertTrue((self.root / name).is_file())

    def test_version_lookup_inventory_is_not_usage_evidence_but_remains_secret_checked(self):
        for name in ("active.png", "candidate--a1b2c3.png"):
            (self.root / "img" / name).write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        (self.root / "index.html").write_text('<html><head><meta name="robots" content="noindex"></head><body><img src="img/active.png?v=12"></body></html>')
        token = "ghp_" + "x" * 40
        (self.root / "asset-versions.json").write_text(json.dumps({"version": 1, "assets": {"img/active.png": "a" * 40, "img/candidate--a1b2c3.png": "b" * 40}, "invalid_test_secret": token}))
        report = audit(self.root, [])
        by_path = {asset["path"]: asset for asset in report["assets"]}
        self.assertEqual(by_path["img/active.png"]["reference_class"], "published-reference")
        self.assertEqual(by_path["img/candidate--a1b2c3.png"]["reference_class"], "review-candidate")
        self.assertEqual(by_path["img/candidate--a1b2c3.png"]["reference_evidence"], [])
        self.assertEqual(report["summary"]["referenced_assets"], 1)
        self.assertEqual(report["errors"], [{"code": "credential-literal", "source": "asset-versions.json"}])
        self.assertNotIn(token, json.dumps(report))

    def test_unclosed_quotes_in_regex_comments_do_not_exponentially_backtrack(self):
        (self.root / "cms/regex.gs").write_text('// Regex quote /"' + '\\' * 64 + "/;\nconst real = './img/missing.png';\n")
        # Bound the child process so a regression reports a failure rather than
        # leaving the whole audit/test runner stuck in a regex backtracking loop.
        code = 'import json,sys;from pathlib import Path;from site_audit import audit;print(json.dumps(audit(Path(sys.argv[1]),[])["errors"]))'
        result = subprocess.run([sys.executable, "-c", code, str(self.root)], cwd=Path(__file__).resolve().parent, capture_output=True, text=True, timeout=3, check=True)
        issues = json.loads(result.stdout)
        self.assertEqual([(issue["code"], issue["target"]) for issue in issues], [("missing-local-file", "img/missing.png")])


if __name__ == "__main__":
    unittest.main()
