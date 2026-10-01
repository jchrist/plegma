// Input: [{ hash, parents[] }, ...] in display order (newest first).

const SWIMLANE_WIDTH = 11;
const SWIMLANE_HEIGHT = 22;
const SWIMLANE_CURVE_RADIUS = 5;
const CIRCLE_RADIUS = 4;
const CIRCLE_STROKE_WIDTH = 2;

// Keep old names working for the table layout during migration.
const LANE_WIDTH = SWIMLANE_WIDTH;
const ROW_HEIGHT = SWIMLANE_HEIGHT;

const GRAPH_COLOR_IDS = [
  "scmGraph.foreground1",
  "scmGraph.foreground2",
  "scmGraph.foreground3",
  "scmGraph.foreground4",
  "scmGraph.foreground5",
];

const COLOR_FALLBACKS = {
  "scmGraph.foreground1": "#FFB000",
  "scmGraph.foreground2": "#DC267F",
  "scmGraph.foreground3": "#994F00",
  "scmGraph.foreground4": "#40B0A6",
  "scmGraph.foreground5": "#B66DFF",
  "scmGraph.historyItemRefColor": "#3794FF",
  "scmGraph.historyItemRemoteRefColor": "#B180D7",
  "scmGraph.historyItemBaseRefColor": "#EA5C00",
};

const HISTORY_REF_COLOR = "scmGraph.historyItemRefColor";

// Lane colors in rotation order. Blue leads (then the VS Code SCM theme
// sequence); new lanes take the next color as branches fork.
const LANE_COLOR_ROTATION = [HISTORY_REF_COLOR, ...GRAPH_COLOR_IDS];
const BACKGROUND_CSS =
  "var(--plegma-row-background, var(--vscode-editor-background, var(--vscode-sideBar-background)))";

function colorCss(colorId) {
  const fallback = COLOR_FALLBACKS[colorId] || "#888888";
  const varName = `--vscode-${String(colorId).replace(/\./g, "-")}`;
  return `var(${varName}, ${fallback})`;
}

function rot(index, modulo) {
  return ((index % modulo) + modulo) % modulo;
}

function cloneNode(node) {
  return { id: node.id, color: node.color };
}

// options: { headHash } — marks the HEAD row so it renders the native
// double-circle HEAD node.
function toGraphViewModels(commits, options) {
  const headHash = options && typeof options.headHash === "string" ? options.headHash : null;
  let colorIndex = -1;
  const viewModels = [];

  for (const commit of commits) {
    const id = commit.hash;
    const parentIds = Array.isArray(commit.parents) ? commit.parents : [];
    const kind = headHash && id === headHash ? "HEAD" : "node";
    const prevOutput =
      viewModels.length > 0 ? viewModels[viewModels.length - 1].outputSwimlanes : [];
    const inputSwimlanes = prevOutput.map(cloneNode);
    const outputSwimlanes = [];
    let firstParentAdded = false;

    if (parentIds.length > 0) {
      for (const node of inputSwimlanes) {
        if (node.id === id) {
          if (!firstParentAdded) {
            outputSwimlanes.push({ id: parentIds[0], color: node.color });
            firstParentAdded = true;
          }
          continue;
        }
        outputSwimlanes.push(cloneNode(node));
      }
    } else {
      // Root commit: its own lane terminates here, but unrelated lanes
      // passing through must continue below instead of being dropped.
      for (const node of inputSwimlanes) {
        if (node.id === id) {
          continue;
        }
        outputSwimlanes.push(cloneNode(node));
      }
    }

    for (let i = firstParentAdded ? 1 : 0; i < parentIds.length; i++) {
      colorIndex = rot(colorIndex + 1, LANE_COLOR_ROTATION.length);
      outputSwimlanes.push({
        id: parentIds[i],
        color: LANE_COLOR_ROTATION[colorIndex],
      });
    }

    const inputIndex = inputSwimlanes.findIndex((n) => n.id === id);
    const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length;
    const circleColor =
      circleIndex < outputSwimlanes.length
        ? outputSwimlanes[circleIndex].color
        : circleIndex < inputSwimlanes.length
          ? inputSwimlanes[circleIndex].color
          : HISTORY_REF_COLOR;
    const width = SWIMLANE_WIDTH * (Math.max(inputSwimlanes.length, outputSwimlanes.length, 1) + 1);

    viewModels.push({
      ...commit,
      id,
      parentIds,
      kind,
      inputSwimlanes,
      outputSwimlanes,
      circleIndex,
      circleColor,
      width,
    });
  }

  return viewModels;
}

function findLastIndex(nodes, id) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].id === id) {
      return i;
    }
  }
  return -1;
}

// Rewrite each visible commit's parents to its nearest *visible*
// ancestors (BFS over the full parent map). Used when the list is
// filtered (e.g. text search): laying out only the visible subset with
// direct parents would dangle every edge at hidden rows, so hidden
// commits are skipped and edges connect visible commits directly.
// Unknown hashes (history cut off by the limit) and cycles terminate
// the walk. Returns Map(hash -> visibleParentIds[]).
function visibleParentIds(allCommits, visibleSet, maxWalk = 20000) {
  const byHash = new Map((allCommits || []).map((c) => [c.hash, c]));
  const out = new Map();
  for (const c of allCommits || []) {
    if (!visibleSet.has(c.hash)) {
      continue;
    }
    const found = [];
    const foundSet = new Set();
    const seen = new Set([c.hash]);
    const queue = Array.isArray(c.parents) ? [...c.parents] : [];
    let head = 0;
    let walked = 0;
    while (head < queue.length && walked < maxWalk) {
      const id = queue[head++];
      walked++;
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      if (visibleSet.has(id)) {
        if (!foundSet.has(id)) {
          foundSet.add(id);
          found.push(id);
        }
        continue;
      }
      const p = byHash.get(id);
      if (p && Array.isArray(p.parents)) {
        queue.push(...p.parents);
      }
    }
    out.set(c.hash, found);
  }
  return out;
}

// Returns { width, paths: [{ d, stroke }], circles: [{ cx, cy, r, fill, stroke, strokeWidth }] }
function rowGraph(viewModel) {
  const historyItem = {
    id: viewModel.id || viewModel.hash,
    parentIds: viewModel.parentIds || viewModel.parents || [],
  };
  const inputSwimlanes = viewModel.inputSwimlanes || [];
  const outputSwimlanes = viewModel.outputSwimlanes || [];
  const kind = viewModel.kind || "node";

  const inputIndex = inputSwimlanes.findIndex((n) => n.id === historyItem.id);
  const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length;
  const circleColor =
    viewModel.circleColor ||
    (circleIndex < outputSwimlanes.length
      ? outputSwimlanes[circleIndex].color
      : circleIndex < inputSwimlanes.length
        ? inputSwimlanes[circleIndex].color
        : HISTORY_REF_COLOR);

  const paths = [];
  let outputSwimlaneIndex = 0;

  for (let index = 0; index < inputSwimlanes.length; index++) {
    const color = colorCss(inputSwimlanes[index].color);
    if (inputSwimlanes[index].id === historyItem.id) {
      if (index !== circleIndex) {
        const d = [
          `M ${SWIMLANE_WIDTH * (index + 1)} 0`,
          `A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${SWIMLANE_WIDTH * index} ${SWIMLANE_WIDTH}`,
          `H ${SWIMLANE_WIDTH * (circleIndex + 1)}`,
        ].join(" ");
        paths.push({ d, stroke: color });
      } else {
        outputSwimlaneIndex++;
      }
    } else if (
      outputSwimlaneIndex < outputSwimlanes.length &&
      inputSwimlanes[index].id === outputSwimlanes[outputSwimlaneIndex].id
    ) {
      if (index === outputSwimlaneIndex) {
        paths.push({
          d: `M ${SWIMLANE_WIDTH * (index + 1)} 0 V ${SWIMLANE_HEIGHT}`,
          stroke: color,
        });
      } else {
        const d = [
          `M ${SWIMLANE_WIDTH * (index + 1)} 0`,
          "V 6",
          `A ${SWIMLANE_CURVE_RADIUS} ${SWIMLANE_CURVE_RADIUS} 0 0 1 ${SWIMLANE_WIDTH * (index + 1) - SWIMLANE_CURVE_RADIUS} ${SWIMLANE_HEIGHT / 2}`,
          `H ${SWIMLANE_WIDTH * (outputSwimlaneIndex + 1) + SWIMLANE_CURVE_RADIUS}`,
          `A ${SWIMLANE_CURVE_RADIUS} ${SWIMLANE_CURVE_RADIUS} 0 0 0 ${SWIMLANE_WIDTH * (outputSwimlaneIndex + 1)} ${SWIMLANE_HEIGHT / 2 + SWIMLANE_CURVE_RADIUS}`,
          `V ${SWIMLANE_HEIGHT}`,
        ].join(" ");
        paths.push({ d, stroke: color });
      }
      outputSwimlaneIndex++;
    }
  }

  for (let i = 1; i < historyItem.parentIds.length; i++) {
    const parentOutputIndex = findLastIndex(outputSwimlanes, historyItem.parentIds[i]);
    if (parentOutputIndex === -1) {
      continue;
    }
    const color = colorCss(outputSwimlanes[parentOutputIndex].color);
    const d = [
      `M ${SWIMLANE_WIDTH * parentOutputIndex} ${SWIMLANE_HEIGHT / 2}`,
      `A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${SWIMLANE_WIDTH * (parentOutputIndex + 1)} ${SWIMLANE_HEIGHT}`,
      `M ${SWIMLANE_WIDTH * parentOutputIndex} ${SWIMLANE_HEIGHT / 2}`,
      `H ${SWIMLANE_WIDTH * (circleIndex + 1)}`,
    ].join(" ");
    paths.push({ d, stroke: color });
  }

  if (inputIndex !== -1) {
    paths.push({
      d: `M ${SWIMLANE_WIDTH * (circleIndex + 1)} 0 V ${SWIMLANE_HEIGHT / 2}`,
      stroke: colorCss(inputSwimlanes[inputIndex].color),
    });
  }

  if (historyItem.parentIds.length > 0) {
    paths.push({
      d: `M ${SWIMLANE_WIDTH * (circleIndex + 1)} ${SWIMLANE_HEIGHT / 2} V ${SWIMLANE_HEIGHT}`,
      stroke: colorCss(circleColor),
    });
  }

  const cx = SWIMLANE_WIDTH * (circleIndex + 1);
  const cy = SWIMLANE_WIDTH;
  const circles = [];
  const circleStroke = BACKGROUND_CSS;

  if (kind === "HEAD") {
    circles.push({
      cx,
      cy,
      r: CIRCLE_RADIUS + 3,
      fill: colorCss(circleColor),
      stroke: circleStroke,
      strokeWidth: CIRCLE_STROKE_WIDTH,
    });
    circles.push({
      cx,
      cy,
      r: CIRCLE_STROKE_WIDTH,
      fill: BACKGROUND_CSS,
      stroke: BACKGROUND_CSS,
      strokeWidth: CIRCLE_RADIUS,
    });
  } else if (historyItem.parentIds.length > 1) {
    circles.push({
      cx,
      cy,
      r: CIRCLE_RADIUS + 2,
      fill: colorCss(circleColor),
      stroke: circleStroke,
      strokeWidth: CIRCLE_STROKE_WIDTH,
    });
    circles.push({
      cx,
      cy,
      r: CIRCLE_RADIUS - 1,
      fill: colorCss(circleColor),
      stroke: circleStroke,
      strokeWidth: CIRCLE_STROKE_WIDTH,
    });
  } else {
    circles.push({
      cx,
      cy,
      r: CIRCLE_RADIUS + 1,
      fill: colorCss(circleColor),
      stroke: circleStroke,
      strokeWidth: CIRCLE_STROKE_WIDTH,
    });
  }

  const width =
    viewModel.width ||
    SWIMLANE_WIDTH * (Math.max(inputSwimlanes.length, outputSwimlanes.length, 1) + 1);

  return { width, paths, circles, circleIndex, circleColor: colorCss(circleColor) };
}

function graphWidth(viewModel) {
  return (
    viewModel.width ||
    SWIMLANE_WIDTH *
      (Math.max(
        (viewModel.inputSwimlanes || []).length,
        (viewModel.outputSwimlanes || []).length,
        1,
      ) +
        1)
  );
}

module.exports = {
  SWIMLANE_WIDTH,
  SWIMLANE_HEIGHT,
  SWIMLANE_CURVE_RADIUS,
  CIRCLE_RADIUS,
  CIRCLE_STROKE_WIDTH,
  LANE_WIDTH,
  ROW_HEIGHT,
  GRAPH_COLOR_IDS,
  COLOR_FALLBACKS,
  HISTORY_REF_COLOR,
  colorCss,
  toGraphViewModels,
  visibleParentIds,
  rowGraph,
  graphWidth,
};
