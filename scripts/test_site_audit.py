#!/usr/bin/env python3
"""Regression fixtures for public path resolution and conservative asset auditing."""
import json
from pathlib import Path
import tempfile
import unittest

from site_audit import audit, local_target


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


if __name__ == "__main__":
    unittest.main()
