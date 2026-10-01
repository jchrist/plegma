// Git data shapes (plain JS docs, no runtime).
// CommitInfo: { hash, parents[], authorName, authorEmail, timestamp, subject, body, refs[],
//               sigStatus, sigSigner, avatar, filesChanged, additions, deletions }
// BranchInfo: { name, kind: 'local'|'remote', target, isHead, upstream? }
// WorktreeInfo: { path, hash, branch: string|null, bare, detached }
// TagInfo: { name, target }
// ChangedFile: { path, oldPath?, status: 'Added'|'Modified'|'Deleted'|'Renamed'|'Copied'|'Unknown' }
// ProbeResult: { vscodeGitAvailable, vscodeGitVersion?, repositoryCount?, capabilities{}, fallback: 'vscode-git'|'cli' }
