#!/usr/bin/env node
/**
 * Fetch Trent & Mersey + Staffs & Worcs canal geometry from OpenStreetMap
 * (Overpass), assemble ordered polylines, snap day stops, and write
 * data/route.json for the static map to load at runtime.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BBOX = "52.78,-2.22,53.04,-2.00";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const CONNECT_M = 30;
const JUNCTION_M = 80;

function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function nearestIndex(chain, pt) {
  let best = { dist: Infinity, index: -1 };
  for (let i = 0; i < chain.length; i++) {
    const d = haversine(chain[i], pt);
    if (d < best.dist) best = { dist: d, index: i };
  }
  return best;
}

function assemble(ways) {
  if (!ways.length) return [];
  const segs = ways.map((w) =>
    w.geometry.map((g) => /** @type {[number, number]} */ ([g.lat, g.lon]))
  );
  const used = new Array(segs.length).fill(false);
  // Start from the northernmost endpoint so T&M orients roughly N→S
  let startIdx = 0;
  let startLat = -Infinity;
  segs.forEach((s, i) => {
    for (const end of [s[0], s[s.length - 1]]) {
      if (end[0] > startLat) {
        startLat = end[0];
        startIdx = i;
      }
    }
  });
  let chain = segs[startIdx].slice();
  // If the northern end of the chosen segment is at the end, reverse it
  if (haversine(chain[0], [startLat, chain[0][1]]) >
      haversine(chain[chain.length - 1], [startLat, chain[chain.length - 1][1]])) {
    // Prefer the end that is actually northernmost
  }
  const north0 = chain[0][0];
  const north1 = chain[chain.length - 1][0];
  if (north1 > north0) chain = chain.slice().reverse();
  used[startIdx] = true;

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      const s = segs[i];
      for (const cand of [s, s.slice().reverse()]) {
        if (haversine(chain[chain.length - 1], cand[0]) < CONNECT_M) {
          chain = chain.concat(cand.slice(1));
          used[i] = true;
          changed = true;
          break;
        }
        if (haversine(chain[0], cand[cand.length - 1]) < CONNECT_M) {
          chain = cand.slice(0, -1).concat(chain);
          used[i] = true;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  const unused = used.filter(Boolean).length;
  console.log(`  connected ${unused}/${segs.length} ways → ${chain.length} pts`);
  return chain;
}

function slice(chain, i0, i1) {
  if (i0 === i1) return [chain[i0]];
  if (i0 < i1) return chain.slice(i0, i1 + 1);
  return chain.slice(i1, i0 + 1).reverse();
}

function dedupeConsecutive(pts) {
  const out = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

/**
 * Build a path along the network between two snapped locations.
 * Each location is { canal: 'tm'|'sw', index }.
 * Junction is the T&M index nearest the S&W attachment point.
 */
function pathBetween(tm, sw, junctionTm, junctionSw, a, b) {
  if (a.canal === b.canal) {
    const chain = a.canal === "tm" ? tm : sw;
    return slice(chain, a.index, b.index);
  }
  // Cross canals via junction: a → junction → b
  const aChain = a.canal === "tm" ? tm : sw;
  const bChain = b.canal === "tm" ? tm : sw;
  const aJunc = a.canal === "tm" ? junctionTm : junctionSw;
  const bJunc = b.canal === "tm" ? junctionTm : junctionSw;
  return dedupeConsecutive([
    ...slice(aChain, a.index, aJunc),
    ...slice(bChain, bJunc, b.index),
  ]);
}

function snapToNetwork(tm, sw, pt) {
  const onTm = nearestIndex(tm, pt);
  const onSw = nearestIndex(sw, pt);
  if (onSw.dist < onTm.dist) {
    return { canal: "sw", index: onSw.index, dist: onSw.dist };
  }
  return { canal: "tm", index: onTm.index, dist: onTm.dist };
}

async function fetchCanals() {
  const query = `
[out:json][timeout:80];
(
  way["waterway"="canal"]["name"~"Trent.*Mersey"](${BBOX});
  way["waterway"="canal"]["name"~"Staffordshire"](${BBOX});
);
out geom;
`.trim();

  console.log("Fetching canal geometry from Overpass…");
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "travel-map-build-route/1.0",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const stopsPath = join(ROOT, "data/stops.json");
  const outPath = join(ROOT, "data/route.json");
  const data = JSON.parse(readFileSync(stopsPath, "utf8"));

  const osm = await fetchCanals();
  const ways = (osm.elements || []).filter((e) => e.geometry?.length);
  const tmWays = ways.filter((w) => /Trent/i.test(w.tags?.name || ""));
  const swWays = ways.filter((w) => /Staffordshire/i.test(w.tags?.name || ""));

  console.log("Assembling Trent & Mersey…");
  let tm = assemble(tmWays);
  console.log("Assembling Staffordshire & Worcestershire…");
  let sw = assemble(swWays);

  // Orient T&M so index 0 is the northern end (higher lat)
  if (tm[0][0] < tm[tm.length - 1][0]) tm = tm.slice().reverse();

  // Find junction: S&W endpoint nearest to T&M
  const swEnds = [
    { index: 0, pt: sw[0] },
    { index: sw.length - 1, pt: sw[sw.length - 1] },
  ];
  let bestJunc = { dist: Infinity, swIndex: 0, tmIndex: 0 };
  for (const end of swEnds) {
    const n = nearestIndex(tm, end.pt);
    if (n.dist < bestJunc.dist) {
      bestJunc = { dist: n.dist, swIndex: end.index, tmIndex: n.index };
    }
  }
  console.log(
    `Junction: S&W idx ${bestJunc.swIndex} ↔ T&M idx ${bestJunc.tmIndex} (${bestJunc.dist.toFixed(0)}m)`
  );
  if (bestJunc.dist > JUNCTION_M) {
    console.warn("Warning: junction distance is large; geometry may be incomplete.");
  }
  // Orient S&W so index 0 is at the junction
  if (bestJunc.swIndex !== 0) sw = sw.slice().reverse();
  const junctionSw = 0;
  const junctionTm = nearestIndex(tm, sw[0]).index;

  // full = all points for location snapping (order doesn't matter for nearest)
  const full = dedupeConsecutive([...tm, ...sw]);

  /** @type {Record<string, [number, number][]>} */
  const days = {};
  for (const day of data.days) {
    const snaps = day.stops.map((s) => {
      const snap = snapToNetwork(tm, sw, [s.lat, s.lng]);
      console.log(
        `  Day ${day.id} "${s.name}": ${snap.canal}[${snap.index}] ${snap.dist.toFixed(0)}m`
      );
      return snap;
    });

    let path = [];
    for (let i = 0; i < snaps.length - 1; i++) {
      const seg = pathBetween(
        tm,
        sw,
        junctionTm,
        junctionSw,
        snaps[i],
        snaps[i + 1]
      );
      path = dedupeConsecutive(path.concat(seg));
    }
    if (path.length < 2 && snaps.length) {
      // Single-stop day fallback: tiny stub around the snap
      const s = snaps[0];
      const chain = s.canal === "tm" ? tm : sw;
      const i0 = Math.max(0, s.index - 1);
      const i1 = Math.min(chain.length - 1, s.index + 1);
      path = chain.slice(i0, i1 + 1);
    }
    days[String(day.id)] = path;
    console.log(`  Day ${day.id}: ${path.length} route points`);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    source: "OpenStreetMap via Overpass (ODbL)",
    full,
    days,
  };
  writeFileSync(outPath, JSON.stringify(payload));
  console.log(
    `Wrote ${outPath} (${full.length} full pts, ${Object.keys(days).length} days)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
