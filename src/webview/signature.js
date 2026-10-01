// GPG signature display. The backend passes git's %G? code and %GS signer
// straight through; the labels and colors are presentation, so they live
// here rather than in the git parsers.
const LABELS = {
  G: "Verified",
  U: "Verified (unknown validity)",
  X: "Verified (expired signature)",
  Y: "Verified (expired key)",
  R: "Verified (revoked key)",
  B: "Bad signature",
  E: "Cannot be checked (missing key)",
  N: "Unsigned",
};

export function signatureLabel(status) {
  return LABELS[String(status || "").trim()] || "Unsigned";
}

export function signatureColor(status) {
  const s = String(status || "").trim();
  if (s === "G" || s === "U") {
    return "var(--vscode-testing-iconPassed, #3fb950)";
  }
  if (s === "B" || s === "E" || s === "X" || s === "Y" || s === "R") {
    return "var(--vscode-editorWarning-foreground, #cca700)";
  }
  return "var(--vscode-descriptionForeground, #999)";
}

export function signatureText(commit) {
  if (!commit) {
    return "";
  }
  const signer = commit.sigSigner ? " · " + commit.sigSigner : "";
  return signatureLabel(commit.sigStatus) + signer;
}
