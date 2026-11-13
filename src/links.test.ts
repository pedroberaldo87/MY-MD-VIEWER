import { describe, expect, it } from "vitest";
import { classifyLink, resolveRelativePath } from "./links";

const base = "/Users/demo/notes";

describe("classifyLink", () => {
  it("opens http(s) and mailto externally", () => {
    expect(classifyLink("https://example.com/a?b=1#c", base)).toEqual({
      kind: "external",
      url: "https://example.com/a?b=1#c",
    });
    expect(classifyLink("http://example.com", base)).toEqual({
      kind: "external",
      url: "http://example.com/",
    });
    expect(classifyLink("HTTPS://Example.com/x", base)).toEqual({
      kind: "external",
      url: "https://example.com/x",
    });
    expect(classifyLink("mailto:me@example.com", base)).toEqual({
      kind: "external",
      url: "mailto:me@example.com",
    });
  });

  it("treats #fragments as in-page anchors", () => {
    expect(classifyLink("#intro", base)).toEqual({ kind: "anchor", id: "intro" });
    expect(classifyLink("#caf%C3%A9", base)).toEqual({ kind: "anchor", id: "café" });
    expect(classifyLink("#", base)).toEqual({ kind: "anchor", id: "" });
  });

  it("resolves relative Markdown links against the file's directory", () => {
    expect(classifyLink("other.md", base)).toEqual({
      kind: "markdown",
      path: "/Users/demo/notes/other.md",
    });
    expect(classifyLink("./sub/page.markdown#section", base)).toEqual({
      kind: "markdown",
      path: "/Users/demo/notes/sub/page.markdown",
    });
    expect(classifyLink("../up.MD?x=1", base)).toEqual({
      kind: "markdown",
      path: "/Users/demo/up.MD",
    });
    expect(classifyLink("my%20note.md", base)).toEqual({
      kind: "markdown",
      path: "/Users/demo/notes/my note.md",
    });
  });

  it("ignores dangerous or unsupported targets", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "tauri://localhost/index.html",
      "asset://localhost/etc/passwd",
      "vbscript:x",
      "tel:123",
      "//evil.example.com/x",
      "/etc/passwd.md",
      "image.png",
      "doc.pdf",
      "",
      "   ",
      "https://",
    ]) {
      expect(classifyLink(href, base), href).toEqual({ kind: "ignore" });
    }
    expect(classifyLink(null, base)).toEqual({ kind: "ignore" });
    expect(classifyLink(undefined, base)).toEqual({ kind: "ignore" });
  });

  it("ignores relative Markdown links when no file directory is known", () => {
    expect(classifyLink("other.md", null)).toEqual({ kind: "ignore" });
  });
});

describe("resolveRelativePath", () => {
  it("handles ., .. and keeps query/hash", () => {
    expect(resolveRelativePath("/a/b/", "./c/../d.png?x#y")).toBe("/a/b/d.png?x#y");
    expect(resolveRelativePath("/a/b", "../../../x")).toBe("/x");
  });
});
