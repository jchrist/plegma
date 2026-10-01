// Commit-message rich text: URLs and emails become links, a small Markdown
// subset (bold, italic, inline code) is rendered, and gitmoji shortcodes
// become emoji. Output is an HTML string built from raw input: every piece
// of user text is escaped before any tag is emitted, so the result is safe
// to hand to v-html.

// Allow-list of gitmoji shortcodes. Deliberately small: unknown `:name:`
// sequences stay literal text instead of guessing.
const GITMOJI = {
  ":sparkles:": "✨",
  ":bug:": "🐛",
  ":fire:": "🔥",
  ":memo:": "📝",
  ":pencil2:": "✏️",
  ":tada:": "🎉",
  ":rocket:": "🚀",
  ":boom:": "💥",
  ":recycle:": "♻️",
  ":white_check_mark:": "✅",
  ":heavy_plus_sign:": "➕",
  ":heavy_minus_sign:": "➖",
  ":twisted_rightwards_arrows:": "🔀",
  ":twisted_leftwards_arrows:": "🔁",
  ":arrow_up:": "⬆️",
  ":arrow_down:": "⬇️",
  ":lock:": "🔒️",
  ":unlock:": "🔓",
  ":wrench:": "🔧",
  ":hammer:": "🔨",
  ":construction:": "🚧",
  ":bulb:": "💡",
  ":zap:": "⚡️",
  ":snowflake:": "❄️",
  ":flame:": "🔥",
  ":hourglass:": "⌛️",
  ":warning:": "⚠️",
  ":question:": "❓",
  ":book:": "📖",
  ":books:": "📚",
  ":coffee:": "☕️",
  ":computer:": "💻",
  ":package:": "📦️",
  ":gear:": "⚙️",
  ":clown_face:": "🤡",
  ":shipit:": "🐦",
};

// Order matters: the first alternative that matches at a position wins, so
// code spans come first (no styling inside them) and the two-star forms
// come before their single-character counterparts.
const TOKEN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|_[^_\n]+_)|(https?:\/\/[^\s<>()]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|(:[a-z0-9_+-]{2,24}:)/g;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Trailing punctuation is almost never part of the URL when a message
// ends a sentence ("see https://x.dev."), and an unbalanced trailing
// paren usually closes prose rather than the link.
function trimUrl(url) {
  let out = url;
  for (;;) {
    const before = out;
    out = out.replace(/[.,;:!?]+$/, "");
    if (out !== before) {
      continue;
    }
    if (out.endsWith(")") && (out.match(/\)/g) || []).length > (out.match(/\(/g) || []).length) {
      out = out.slice(0, -1);
      continue;
    }
    break;
  }
  return out;
}

function link(href, label) {
  const safeHref = escapeHtml(href);
  return `<a class="plegma-rt-link" href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(
    label,
  )}</a>`;
}

// Render one line of a commit message. `newlines: false` turns line breaks
// into spaces (subjects stay on one line in the list); `true` emits <br>.
export function renderRichText(text, opts = {}) {
  const newlines = !!opts.newlines;
  const src = String(text == null ? "" : text);
  if (!src) {
    return "";
  }
  let out = "";
  let last = 0;
  TOKEN.lastIndex = 0;
  let m = TOKEN.exec(src);
  while (m) {
    out += escapeHtml(src.slice(last, m.index));
    const [, code, strong, em, url, mail, emoji] = m;
    if (code) {
      out += `<code class="plegma-rt-code">${escapeHtml(code.slice(1, -1))}</code>`;
    } else if (strong) {
      out += `<strong>${escapeHtml(strong.slice(2, -2))}</strong>`;
    } else if (em) {
      out += `<em>${escapeHtml(em.slice(1, -1))}</em>`;
    } else if (url) {
      const href = trimUrl(url);
      out += link(href, href);
      out += escapeHtml(url.slice(href.length));
    } else if (mail) {
      out += link(`mailto:${mail}`, mail);
    } else if (emoji && GITMOJI[emoji]) {
      out += `<span class="plegma-rt-emoji" title="${escapeHtml(emoji)}">${GITMOJI[emoji]}</span>`;
    } else {
      out += escapeHtml(emoji);
    }
    last = m.index + m[0].length;
    m = TOKEN.exec(src);
  }
  out += escapeHtml(src.slice(last));
  if (newlines) {
    return out.replace(/\r?\n/g, "<br />");
  }
  return out.replace(/\r?\n/g, " ");
}
