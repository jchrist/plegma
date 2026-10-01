import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { renderRichText } from "../src/webview/richtext.js";

describe("renderRichText", () => {
  it("escapes user text so messages cannot inject markup", () => {
    assert.equal(
      renderRichText("<img src=x onerror=alert(1)>"),
      "&lt;img src=x onerror=alert(1)&gt;",
    );
    assert.equal(renderRichText("a & b"), "a &amp; b");
    assert.equal(renderRichText('say "hi"'), "say &quot;hi&quot;");
  });

  it("returns an empty string for empty input", () => {
    assert.equal(renderRichText(""), "");
    assert.equal(renderRichText(null), "");
    assert.equal(renderRichText(undefined), "");
  });

  it("linkifies URLs and trims trailing prose punctuation", () => {
    assert.equal(
      renderRichText("see https://example.dev/x."),
      'see <a class="plegma-rt-link" href="https://example.dev/x" target="_blank" rel="noopener noreferrer">https://example.dev/x</a>.',
    );
    assert.equal(
      renderRichText("(https://example.dev/a)"),
      '(<a class="plegma-rt-link" href="https://example.dev/a" target="_blank" rel="noopener noreferrer">https://example.dev/a</a>)',
    );
  });

  it("escapes URL hrefs instead of trusting them", () => {
    const html = renderRichText("https://x.dev/?a=1&b=2");
    assert.match(html, /href="https:\/\/x\.dev\/\?a=1&amp;b=2"/);
  });

  it("linkifies emails with a mailto href", () => {
    assert.equal(
      renderRichText("ping ada@example.dev please"),
      'ping <a class="plegma-rt-link" href="mailto:ada@example.dev" target="_blank" rel="noopener noreferrer">ada@example.dev</a> please',
    );
  });

  it("renders bold and italic, and prefers two-star over one-star", () => {
    assert.equal(renderRichText("**bold** and *em*"), "<strong>bold</strong> and <em>em</em>");
    assert.equal(renderRichText("__b__ _i_"), "<strong>b</strong> <em>i</em>");
    assert.equal(renderRichText("**both**"), "<strong>both</strong>");
  });

  it("renders inline code without styling its contents", () => {
    assert.equal(
      renderRichText("use `a **b** c` here"),
      'use <code class="plegma-rt-code">a **b** c</code> here',
    );
  });

  it("escapes markup inside emphasis", () => {
    assert.equal(renderRichText("**<b>x</b>**"), "<strong>&lt;b&gt;x&lt;/b&gt;</strong>");
  });

  it("replaces known gitmoji shortcodes and leaves unknown ones alone", () => {
    assert.match(
      renderRichText("fix :bug: now"),
      /<span class="plegma-rt-emoji" title=":bug:">🐛<\/span>/,
    );
    assert.equal(renderRichText("ratio 1:2:3 stays"), "ratio 1:2:3 stays");
    assert.equal(renderRichText(":not_a_real_emoji:"), ":not_a_real_emoji:");
  });

  it("turns newlines into spaces by default and into breaks on request", () => {
    assert.equal(renderRichText("one\ntwo"), "one two");
    assert.equal(renderRichText("one\ntwo", { newlines: true }), "one<br />two");
    assert.equal(renderRichText("one\r\ntwo", { newlines: true }), "one<br />two");
  });
});
