import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  SWIMLANE_WIDTH,
  SWIMLANE_HEIGHT,
  toGraphViewModels,
  visibleParentIds,
  rowGraph,
  colorCss,
  graphWidth,
  GRAPH_COLOR_IDS,
} from "../src/webview/graph.js";

function ids(list) {
  return toGraphViewModels(list).map((c) => c.id || c.hash);
}

describe("toGraphViewModels (native swimlanes)", () => {
  it("lays out linear history with stable single-lane swimlanes", () => {
    const vms = toGraphViewModels([
      { hash: "a", parents: ["b"] },
      { hash: "b", parents: ["c"] },
      { hash: "c", parents: [] },
    ]);
    assert.deepEqual(
      ids([
        { hash: "a", parents: ["b"] },
        { hash: "b", parents: ["c"] },
        { hash: "c", parents: [] },
      ]),
      ["a", "b", "c"],
    );
    // First row has no input, one output; middle rows pass through.
    assert.deepEqual(vms[0].inputSwimlanes, []);
    assert.equal(vms[0].outputSwimlanes.length, 1);
    assert.equal(vms[0].outputSwimlanes[0].id, "b");
    assert.equal(vms[1].inputSwimlanes.length, 1);
    assert.equal(vms[1].inputSwimlanes[0].id, "b");
    assert.equal(vms[1].outputSwimlanes[0].id, "c");
    // Same color continues down the lane.
    assert.equal(vms[1].inputSwimlanes[0].color, vms[0].outputSwimlanes[0].color);
    assert.equal(vms[0].circleIndex, 0);
    assert.equal(vms[1].circleIndex, 0);
  });

  it("opens a second swimlane for the merged branch", () => {
    const vms = toGraphViewModels([
      { hash: "M", parents: ["A", "B"] },
      { hash: "A", parents: ["base"] },
      { hash: "B", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    assert.equal(vms[0].outputSwimlanes.length, 2);
    assert.equal(vms[0].outputSwimlanes[0].id, "A");
    assert.equal(vms[0].outputSwimlanes[1].id, "B");
    // Second lane uses a different theme color.
    assert.notEqual(vms[0].outputSwimlanes[0].color, vms[0].outputSwimlanes[1].color);
    // A stays in lane 0, B arrives in lane 1.
    assert.equal(vms[1].circleIndex, 0);
    assert.equal(vms[2].circleIndex, 1);
    // Both converge back to base.
    assert.ok(vms[3].inputSwimlanes.some((n) => n.id === "base"));
  });

  it("handles a single root commit", () => {
    const [only] = toGraphViewModels([{ hash: "only", parents: [] }]);
    assert.equal(only.circleIndex, 0);
    assert.deepEqual(only.inputSwimlanes, []);
    assert.deepEqual(only.outputSwimlanes, []);
  });

  it("marks the HEAD commit with HEAD kind", () => {
    const vms = toGraphViewModels(
      [
        { hash: "a", parents: ["b"] },
        { hash: "b", parents: [] },
      ],
      { headHash: "a" },
    );
    assert.equal(vms[0].kind, "HEAD");
    assert.equal(vms[1].kind, "node");
  });

  it("keeps circle colors inside the theme registry", () => {
    const vms = toGraphViewModels([
      { hash: "M1", parents: ["A", "B"] },
      { hash: "A", parents: ["M2"] },
      { hash: "B", parents: ["C"] },
      { hash: "M2", parents: ["C", "D"] },
      { hash: "C", parents: [] },
      { hash: "D", parents: [] },
    ]);
    const allowed = new Set([...GRAPH_COLOR_IDS, "scmGraph.historyItemRefColor"]);
    for (const vm of vms) {
      assert.ok(allowed.has(vm.circleColor), `${vm.hash} color ${vm.circleColor}`);
      assert.ok(vm.width >= SWIMLANE_WIDTH * 2);
    }
  });
});

describe("rowGraph (native SVG)", () => {
  function laidOut(list, options) {
    return toGraphViewModels(list, options);
  }

  it("draws straight verticals for linear history", () => {
    const [a] = laidOut([
      { hash: "a", parents: ["b"] },
      { hash: "b", parents: [] },
    ]);
    const g = rowGraph(a);
    assert.equal(g.width, SWIMLANE_WIDTH * 2);
    // One vertical down from the node; no sideways arcs.
    assert.ok(g.paths.some((p) => /V /.test(p.d)));
    assert.ok(!g.paths.some((p) => /C /.test(p.d)), "native graph never uses cubic beziers");
    assert.equal(g.circles.length, 1);
    assert.equal(g.circles[0].cx, SWIMLANE_WIDTH * 1);
    assert.equal(g.circles[0].cy, SWIMLANE_HEIGHT / 2);
  });

  it("uses orthogonal arcs (not beziers) for merges", () => {
    const [m, a, b] = laidOut([
      { hash: "M", parents: ["A", "B"] },
      { hash: "A", parents: ["base"] },
      { hash: "B", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    const g = rowGraph(m);
    assert.ok(g.paths.length >= 1);
    for (const p of g.paths) {
      assert.ok(!/C /.test(p.d), `merge path must not use C: ${p.d}`);
      assert.match(p.stroke, /--vscode-scmGraph-/);
    }
    // Merge node renders the native double-circle.
    assert.equal(rowGraph(m).circles.length, 2);
    // The second parent fans out with an orthogonal arc.
    assert.ok(g.paths.some((p) => /A /.test(p.d)));
    assert.deepEqual(rowGraph(a).circles.length, 1);
  });

  it("renders HEAD as a donut (outer color ring, background hole)", () => {
    const [head] = laidOut(
      [
        { hash: "a", parents: ["b"] },
        { hash: "b", parents: [] },
      ],
      { headHash: "a" },
    );
    const g = rowGraph(head);
    assert.equal(g.circles.length, 2);
    assert.match(g.circles[0].fill, /--vscode-scmGraph-/);
    assert.match(String(g.circles[1].fill), /editor-background|sideBar-background/);
  });

  it("maps every stroke through theme CSS variables with fallbacks", () => {
    assert.match(colorCss("scmGraph.foreground1"), /--vscode-scmGraph-foreground1/);
    assert.match(colorCss("scmGraph.foreground1"), /#FFB000/);
    const [a] = laidOut([
      { hash: "a", parents: ["b"] },
      { hash: "b", parents: [] },
    ]);
    for (const p of rowGraph(a).paths) {
      assert.match(p.stroke, /^var\(--vscode-/);
    }
  });

  it("falls back to grey for unknown color ids", () => {
    assert.match(colorCss("nope.unknown"), /#888888/);
  });

  it("reports row widths matching the widest swimlane side", () => {
    const [m] = laidOut([
      { hash: "M", parents: ["A", "B"] },
      { hash: "A", parents: ["base"] },
      { hash: "B", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    assert.equal(graphWidth(m), SWIMLANE_WIDTH * 3);
    assert.equal(rowGraph(m).width, graphWidth(m));
  });

  it("lays out octopus merges and disconnected roots without overlap", () => {
    const vms = toGraphViewModels([
      { hash: "O", parents: ["A", "B", "C"] },
      { hash: "A", parents: [] },
      { hash: "B", parents: [] },
      { hash: "C", parents: [] },
      { hash: "lonely", parents: [] },
    ]);
    assert.equal(vms[0].outputSwimlanes.length, 3);
    const colors = new Set(vms[0].outputSwimlanes.map((n) => n.color));
    assert.equal(colors.size, 3);
    const [lonely] = toGraphViewModels([{ hash: "lonely", parents: [] }]);
    assert.equal(lonely.circleIndex, 0);
    assert.deepEqual(rowGraph(lonely).circles.length, 1);
  });
});

describe("toGraphViewModels root lane passthrough", () => {
  it("keeps unrelated lanes alive below a root commit", () => {
    const vms = toGraphViewModels([
      { hash: "top", parents: ["mid"] },
      { hash: "root", parents: [] },
      { hash: "mid", parents: [] },
    ]);
    // 'mid' lane passes through the root row instead of being dropped.
    assert.ok(
      vms[1].outputSwimlanes.some((n) => n.id === "mid"),
      "passing lane survives the root row",
    );
    // The root's own row draws no downward stub.
    const g = rowGraph(vms[1]);
    assert.ok(
      !g.paths.some(
        (p) =>
          p.d.endsWith(`V ${SWIMLANE_HEIGHT}`) &&
          p.d.includes(`${SWIMLANE_WIDTH} ${SWIMLANE_HEIGHT / 2} V`),
      ),
      "root row has no continuing stub of its own",
    );
  });
});

describe("visibleParentIds (filtered graph rewiring)", () => {
  const linear = [
    { hash: "a", parents: ["b"] },
    { hash: "b", parents: ["c"] },
    { hash: "c", parents: ["d"] },
    { hash: "d", parents: [] },
  ];

  it("skips hidden commits to the nearest visible ancestors", () => {
    const out = visibleParentIds(linear, new Set(["a", "d"]));
    assert.deepEqual(out.get("a"), ["d"]);
    assert.deepEqual(out.get("d"), []);
  });

  it("keeps direct visible parents and dedupes merges", () => {
    const commits = [
      { hash: "m", parents: ["b", "c"] },
      { hash: "b", parents: ["r"] },
      { hash: "c", parents: ["r"] },
      { hash: "r", parents: [] },
    ];
    const out = visibleParentIds(commits, new Set(["m", "r"]));
    assert.deepEqual(out.get("m"), ["r"]);
  });

  it("ignores unknown hashes and never includes self", () => {
    const out = visibleParentIds(
      [
        { hash: "a", parents: ["ghost"] },
        { hash: "loop", parents: ["loop"] },
      ],
      new Set(["a", "loop"]),
    );
    assert.deepEqual(out.get("a"), []);
    assert.deepEqual(out.get("loop"), []);
  });

  it("produces a connected layout for the visible subset", () => {
    const visible = new Set(["a", "c"]);
    const rewritten = visibleParentIds(linear, visible);
    const pruned = linear
      .filter((c) => visible.has(c.hash))
      .map((c) => ({ ...c, parents: rewritten.get(c.hash) || [] }));
    const vms = toGraphViewModels(pruned);
    assert.equal(vms.length, 2);
    // 'a' reaches 'c' through one lane with no dangling second lane.
    assert.deepEqual(
      vms[0].outputSwimlanes.map((n) => n.id),
      ["c"],
    );
    assert.deepEqual(
      vms[1].inputSwimlanes.map((n) => n.id),
      ["c"],
    );
  });
});
