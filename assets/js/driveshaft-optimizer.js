/* ==========================================================================
   Driveshaft material optimizer — a live, editable port of
   driveshaft_material_optimization.xlsx. Same inputs, same formulas, same
   tabs; every blue cell is an input and everything downstream recalculates.
   Imperial units throughout, matching the workbook.
   ========================================================================== */
(function () {
  "use strict";

  const root = document.querySelector("[data-optimizer]");
  if (!root) return;

  const PI = Math.PI;
  const N_ROWS = 129; // each material sweeps 129 diameters in 0.01 in steps
  const NM_PER_LBIN = 0.1129848;
  const MPA_PER_PSI = 0.00689476;
  const KG_PER_LB = 0.45359237;

  const MATS = ["al", "st", "ti"];
  const MAT_NAME = { al: "6061-T6", st: "AISI 4130 (normalized)", ti: "Ti-6Al-4V (Grade 5)" };
  const MAT_SHORT = { al: "6061-T6 aluminum", st: "4130 steel", ti: "Ti-6Al-4V titanium" };
  const SWEEP_START = { al: 1.1, st: 0.9, ti: 0.75 };
  const SCALE_LO = [0x63, 0xbe, 0x7b]; // Excel colour-scale green
  const SCALE_HI = [0xf8, 0x69, 0x6b]; // Excel colour-scale red

  const DEFAULTS = {
    T: 2655.2, L1: 23.91, L2: 14.37, fosY: 2, kd: 0.7, shear: 0.577, fosB: 2,
    al: { rho: 0.0976, sy: 40030, E: 9993622, nu: 0.33, tmin: 0.125, price: 5 },
    st: { rho: 0.2836, sy: 66717, E: 29732790, nu: 0.29, tmin: 0.035, price: 4 },
    ti: { rho: 0.1601, sy: 127633, E: 16503324, nu: 0.342, tmin: 0.035, price: 30 },
    baseOD: 1.25, baseT: 0.125, yokeVol: 1.7818158274,
    weld: { al: 40, st: 25, ti: 80 }, mach: { al: 30, st: 35, ti: 60 },
    od: { A: 1.26, B: 1.64, C: 1.13, S: 1.64 },
  };

  let s = structuredClone(DEFAULTS);
  let r = null; // latest results
  let optMat = "st"; // material shown on the Optimizer tab

  /* ---------- the workbook's formulas ---------- */

  const tauY = (m) => s[m].sy * s.shear;
  const kBuck = (m) => s.kd * 0.272 * s[m].E / Math.pow(1 - s[m].nu * s[m].nu, 0.75);

  // One row of the optimizer: the thinnest wall at this OD that passes
  // yield and buckling with their factors of safety, floored at the
  // material's minimum manufacturable wall.
  function sizeTube(m, OD) {
    const ro = OD / 2;
    const tau = tauY(m), k = kBuck(m);
    const X = Math.pow(ro, 4) - s.T * ro / (PI / 2 * (tau / s.fosY));
    if (!(X > 0)) return null;
    const tY = ro - Math.pow(X, 0.25);
    const tB = Math.pow(s.T * s.fosB / (2 * PI * Math.sqrt(ro) * k), 0.4);
    const tMin = s[m].tmin;
    const t = Math.max(tY, tB, tMin);
    const ID = OD - 2 * t;
    if (!(ID >= 0)) return null;
    const gov = tMin >= tY && tMin >= tB ? "min-wall" : tY >= tB ? "yield" : "buckling";
    const area = PI / 4 * (OD * OD - ID * ID);
    const mpi = area * s[m].rho;
    const fosY = tau * (PI / 32 * (Math.pow(OD, 4) - Math.pow(ID, 4))) / (OD / 2) / s.T;
    const fosB = k * Math.pow(t / ro, 1.5) * 2 * PI * ro * ro * t / s.T;
    return { OD, tY, tB, tMin, t, gov, ID, area, mpi, fosY, fosB };
  }

  function compute() {
    const out = { sweep: {}, best: {}, yoke: {} };
    const Ltot = s.L1 + s.L2;
    out.Ltot = Ltot;

    // Current baseline tube
    const bID = s.baseOD - 2 * s.baseT;
    const bArea = PI / 4 * (s.baseOD ** 2 - bID ** 2);
    const bZp = (PI / 32 * (s.baseOD ** 4 - bID ** 4)) / (s.baseOD / 2);
    const bCap = tauY("al") * bZp;
    out.base = { ID: bID, area: bArea, Zp: bZp, tau: tauY("al"), rho: s.al.rho, cap: bCap, fos: bCap / s.T, mass: bArea * Ltot * s.al.rho };

    for (const m of MATS) {
      out.yoke[m] = s.yokeVol * s[m].rho;
      const rows = [];
      for (let i = 0; i < N_ROWS; i++) {
        const OD = Math.round((SWEEP_START[m] + i * 0.01) * 100) / 100;
        rows.push({ OD, res: sizeTube(m, OD) });
      }
      out.sweep[m] = rows;
      let best = null;
      for (const row of rows) if (row.res && (!best || row.res.mpi < best.mpi)) best = row.res;
      out.best[m] = best && { ...best, full: best.mpi * Ltot, vsBase: best.mpi * Ltot - out.base.mass };
    }

    // Design Comparison: tube selections
    const tube = (m, OD, L) => {
      const res = sizeTube(m, OD);
      if (!res) return { m, OD, L, res: null, mass: NaN, cost: NaN };
      const mass = res.area * L * s[m].rho;
      return { m, OD, L, res, mass, cost: mass * s[m].price };
    };
    const tA = tube("al", s.od.A, s.L1);
    const tB = tube("st", s.od.B, s.L1);
    const tC = tube("ti", s.od.C, s.L1);
    const tS = tube("st", s.od.S, s.L2);
    out.tubes = { A: tA, B: tB, C: tC, S: tS };

    const y = out.yoke;
    const A = {
      lines: [
        ["Long aluminum tube", tA.mass, tA.cost],
        ["Short steel tube", tS.mass, tS.cost],
        ["Aluminum yokes, qty 2", 2 * y.al, 2 * y.al * s.al.price],
        ["Steel yokes, qty 2", 2 * y.st, 2 * y.st * s.st.price],
      ],
      fab: 2 * s.weld.al + 2 * s.weld.st + 2 * s.mach.al + 2 * s.mach.st,
    };
    const B = {
      lines: [
        ["Long steel tube", tB.mass, tB.cost],
        ["Short steel tube", tS.mass, tS.cost],
        ["Steel yokes, qty 4", 4 * y.st, 4 * y.st * s.st.price],
      ],
      fab: 4 * s.weld.st + 4 * s.mach.st,
    };
    const C = {
      lines: [
        ["Long titanium tube", tC.mass, tC.cost],
        ["Short steel tube", tS.mass, tS.cost],
        ["Titanium yokes, qty 2", 2 * y.ti, 2 * y.ti * s.ti.price],
        ["Steel yokes, qty 2", 2 * y.st, 2 * y.st * s.st.price],
      ],
      fab: 2 * s.weld.ti + 2 * s.weld.st + 2 * s.mach.ti + 2 * s.mach.st,
    };
    for (const d of [A, B, C]) {
      d.mass = d.lines.reduce((a, l) => a + l[1], 0);
      d.cost = d.lines.reduce((a, l) => a + l[2], 0) + d.fab;
    }
    out.designs = { A, B, C };

    const cur = {
      lines: [
        ["Long aluminum tube, " + fmt(s.baseT, 3) + " in wall", bArea * s.L1 * s.al.rho],
        ["Short steel tube, " + fmt(s.baseT, 3) + " in wall", bArea * s.L2 * s.st.rho],
        ["Aluminum yokes, qty 2", 2 * y.al],
        ["Steel yokes, qty 2", 2 * y.st],
      ],
    };
    cur.mass = cur.lines.reduce((a, l) => a + l[1], 0);
    cur.cost = cur.lines[0][1] * s.al.price + cur.lines[1][1] * s.st.price + 2 * y.al * s.al.price + 2 * y.st * s.st.price
      + 2 * s.weld.al + 2 * s.weld.st + 2 * s.mach.al + 2 * s.mach.st;
    out.current = cur;

    const names = { A: "Design A, mixed", B: "Design B, all steel", C: "Design C, Ti long + steel short" };
    const keys = ["A", "B", "C"];
    const pick = (f) => keys.filter((k) => Number.isFinite(out.designs[k][f]))
      .reduce((a, k) => (a === null || out.designs[k][f] < out.designs[a][f] ? k : a), null);
    out.lightest = pick("mass");
    out.cheapest = pick("cost");
    out.names = names;
    return out;
  }

  /* ---------- formatting ---------- */

  function fmt(v, d) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "–";
    const str = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return (v < 0 && Number(str.replace(/,/g, "")) !== 0 ? "−" : "") + str;
  }
  const money = (v) => (Number.isFinite(v) ? (v < 0 ? "−$" : "$") + fmt(Math.abs(v), 2) : "–");
  const signed = (v, d, unit = "") => (Number.isFinite(v) ? (v > 0 ? "+" : "") + fmt(v, d) + unit : "–");
  const pct = (v) => signed(v * 100, 1, "%");
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- input plumbing ---------- */

  function getPath(path) {
    return path.split(".").reduce((o, k) => o[k], s);
  }
  function setPath(path, v) {
    const ks = path.split(".");
    const last = ks.pop();
    ks.reduce((o, k) => o[k], s)[last] = v;
  }

  function inp(path, label, opts = {}) {
    const step = opts.step || "any";
    return `<input class="xl-in" type="number" inputmode="decimal" step="${step}" data-path="${path}" value="${getPath(path)}" aria-label="${esc(label)}" />`;
  }
  const out = (key, cls = "") => `<span class="xl-out ${cls}" data-out="${key}"></span>`;

  /* ---------- static skeleton ---------- */

  const TABS = [
    ["inputs", "Inputs"],
    ["optimizer", "Optimizer"],
    ["summary", "Summary"],
    ["compare", "Design Comparison"],
    ["method", "Methodology"],
  ];

  function matRow(m) {
    return `<tr>
      <th scope="row">${MAT_NAME[m]}</th>
      <td>${inp(m + ".rho", MAT_NAME[m] + " density")}</td>
      <td>${inp(m + ".sy", MAT_NAME[m] + " tensile yield")}<span class="xl-sub">${out("mpa-sy-" + m)} MPa</span></td>
      <td class="xl-num">${out("tau-" + m)}<span class="xl-sub">${out("mpa-tau-" + m)} MPa</span></td>
      <td>${inp(m + ".E", MAT_NAME[m] + " Young's modulus")}</td>
      <td>${inp(m + ".nu", MAT_NAME[m] + " Poisson ratio")}</td>
      <td>${inp(m + ".tmin", MAT_NAME[m] + " minimum wall")}</td>
      <td>${inp(m + ".price", MAT_NAME[m] + " price per pound")}</td>
      <td class="xl-note">${{
        al: "E and yield from Wikipedia 6061-T6. Tubing about $4–6/lb.",
        st: "E and yield from MatWeb 4130; yield matches the FEA. Tubing about $3–5/lb.",
        ti: "Grade 5 titanium, if funded. About 3× steel's strength-to-weight. Tubing about $25–40/lb.",
      }[m]}</td>
    </tr>`;
  }

  function kvRow(label, cell, note = "") {
    return `<tr><th scope="row">${label}</th><td>${cell}</td><td class="xl-note">${note}</td></tr>`;
  }

  const inputsTab = `
    <section class="xl-block">
      <h4>Design inputs</h4>
      <div class="xl-table-wrap"><table class="xl-table xl-kv">
        <tbody>
          ${kvRow("Design torque (lb·in)", inp("T", "Design torque") + `<span class="xl-sub">= ${out("nm")} N·m</span>`, "Peak torque from the gearbox output.")}
          ${kvRow("Section 1 length, long (in)", inp("L1", "Section 1 length"))}
          ${kvRow("Section 2 length, short (in)", inp("L2", "Section 2 length"))}
          ${kvRow("Total shaft length (in)", out("Ltot", "xl-num"))}
          ${kvRow("Yield factor of safety", inp("fosY", "Yield factor of safety"), "Margin against yielding in shear. Sizes the yield-required wall.")}
          ${kvRow("Buckling knockdown factor", inp("kd", "Buckling knockdown factor"), "Real cylinders buckle below the ideal value because of imperfections. About 0.7 for torsion (NASA SP-8007).")}
          ${kvRow("Shear-yield factor (von Mises)", inp("shear", "Shear-yield factor"), "Shear yield is tensile yield × 0.577 (1/√3).")}
          ${kvRow("Buckling factor of safety", inp("fosB", "Buckling factor of safety"), "Margin against torsional buckling, independent of the knockdown.")}
        </tbody>
      </table></div>
    </section>

    <section class="xl-block">
      <h4>Material properties</h4>
      <div class="xl-table-wrap"><table class="xl-table xl-mats">
        <thead><tr>
          <th>Material</th><th>Density (lb/in³)</th><th>Tensile yield (psi)</th><th>Shear yield (psi)</th>
          <th>Young's modulus E (psi)</th><th>Poisson ratio</th><th>Min wall (in)</th><th>Price ($/lb)</th><th>Notes</th>
        </tr></thead>
        <tbody>${MATS.map(matRow).join("")}</tbody>
      </table></div>
    </section>

    <div class="xl-grid-2">
      <section class="xl-block">
        <h4>Current baseline, 6061-T6 tube</h4>
        <div class="xl-table-wrap"><table class="xl-table xl-kv">
          <tbody>
            ${kvRow("Outer diameter OD (in)", inp("baseOD", "Baseline outer diameter"))}
            ${kvRow("Wall thickness (in)", inp("baseT", "Baseline wall thickness"))}
            ${kvRow("Inner diameter ID (in)", out("b-ID", "xl-num"))}
            ${kvRow("Cross-section area (in²)", out("b-area", "xl-num"))}
            ${kvRow("Polar section modulus Zp (in³)", out("b-Zp", "xl-num"))}
            ${kvRow("Shear yield (psi)", out("b-tau", "xl-num"))}
            ${kvRow("Torque capacity at shear yield (lb·in)", out("b-cap", "xl-num"))}
            ${kvRow("Factor of safety at design torque", out("b-fos", "xl-num"))}
            ${kvRow("Mass of full shaft in this tube (lb)", out("b-mass", "xl-num"))}
          </tbody>
        </table></div>
      </section>

      <div>
        <section class="xl-block">
          <h4>Yoke properties</h4>
          <div class="xl-table-wrap"><table class="xl-table xl-kv">
            <tbody>
              ${kvRow("Volume per yoke (in³)", inp("yokeVol", "Volume per yoke"), "From the yoke CAD. Same geometry assumed for every material.")}
              ${kvRow("6061 aluminum yoke (lb)", out("y-al", "xl-num"))}
              ${kvRow("4130 steel yoke (lb)", out("y-st", "xl-num"))}
              ${kvRow("Titanium yoke (lb)", out("y-ti", "xl-num"))}
            </tbody>
          </table></div>
        </section>
        <section class="xl-block">
          <h4>Fabrication cost estimates ($)</h4>
          <div class="xl-table-wrap"><table class="xl-table xl-costs">
            <thead><tr><th></th><th>Aluminum</th><th>Steel</th><th>Titanium</th></tr></thead>
            <tbody>
              <tr><th scope="row">Welding, per joint</th><td>${inp("weld.al", "Aluminum welding cost")}</td><td>${inp("weld.st", "Steel welding cost")}</td><td>${inp("weld.ti", "Titanium welding cost")}</td></tr>
              <tr><th scope="row">Yoke machining</th><td>${inp("mach.al", "Aluminum machining cost")}</td><td>${inp("mach.st", "Steel machining cost")}</td><td>${inp("mach.ti", "Titanium machining cost")}</td></tr>
            </tbody>
          </table></div>
          <p class="xl-hint">All costs are estimates.</p>
        </section>
      </div>
    </div>`;

  const optimizerTab = `
    <p class="xl-lede">For every outer diameter, the optimal wall is the thinnest that passes both yield and buckling, never below the material's minimum. The lightest row is the optimum. Each material sweeps its own diameter range.</p>
    <div class="xl-opt-bar">
      <div class="xl-seg" role="radiogroup" aria-label="Material">
        ${MATS.map((m) => `<button type="button" role="radio" class="xl-seg-btn" data-mat="${m}"><span class="xl-swatch xl-swatch-${m}"></span>${MAT_NAME[m]}</button>`).join("")}
      </div>
      <button type="button" class="xl-btn xl-btn-small" data-action="jump-best">Jump to the lightest row</button>
    </div>
    <div class="xl-chips" data-out-html="lookup"></div>
    <div class="xl-table-wrap xl-sweep-wrap">
      <table class="xl-table xl-sweep">
        <thead><tr>
          <th>OD (in)</th><th>Yield wall (in)</th><th>Buckling wall (in)</th><th>Optimal wall (in)</th><th>Governing</th>
          <th>ID (in)</th><th>Area (in²)</th><th>Mass (lb/in)</th><th>Yield FoS</th><th>Buckling FoS</th><th></th>
        </tr></thead>
        <tbody data-out-html="sweep"></tbody>
      </table>
    </div>`;

  const summaryTab = `
    <p class="xl-lede">The lightest tube for each material with the diameter left free. Hover the chart to compare all three materials at any diameter.</p>
    <figure class="xl-chart" data-chart>
      <figcaption class="xl-chart-head">
        <span class="xl-chart-title">Tube mass per inch vs outer diameter</span>
        <span class="xl-legend">${MATS.map((m) => `<span><i class="xl-swatch xl-swatch-${m}"></i>${MAT_SHORT[m]}</span>`).join("")}</span>
      </figcaption>
      <div class="xl-chart-box">
        <svg role="img" aria-label="Line chart of tube mass per inch against outer diameter for aluminum, steel and titanium. Each curve has one lowest point, marked as that material's optimum." data-chart-svg></svg>
        <div class="xl-tip" data-chart-tip hidden></div>
      </div>
    </figure>
    <div class="xl-table-wrap">
      <table class="xl-table xl-summary">
        <thead><tr>
          <th>Material</th><th>Best OD (in)</th><th>Optimal wall (in)</th><th>Sized by</th><th>Yield FoS</th><th>Buckling FoS</th>
          <th>Tube mass (lb/in)</th><th>Full-shaft tube (lb)</th><th>vs current Al tube (lb)</th>
        </tr></thead>
        <tbody data-out-html="summary"></tbody>
      </table>
    </div>`;

  function tubeRow(key, label) {
    return `<tr>
      <th scope="row">${label}</th>
      <td>${inp("od." + key, label + " outer diameter")}</td>
      ${["tY", "tB", "tMin", "t", "gov", "area", "L", "rho", "mass", "cost"].map((c) => `<td class="xl-num">${out("tube-" + key + "-" + c)}</td>`).join("")}
    </tr>`;
  }

  function designCard(key, title, tag) {
    return `<section class="xl-card" data-design="${key}">
      <h5>${title}${tag ? `<span class="xl-tag ${tag[0]}">${tag[1]}</span>` : ""}</h5>
      <table class="xl-table xl-breakdown"><tbody data-out-html="design-${key}"></tbody></table>
    </section>`;
  }

  const compareTab = `
    <p class="xl-lede">Set each tube's outer diameter in the blue cells. The wall is solved from yield, buckling and the material minimum. The short section is always steel; the long section is aluminum (A), steel (B) or titanium (C).</p>
    <div class="xl-table-wrap">
      <table class="xl-table xl-tubes">
        <thead><tr>
          <th>Part</th><th>OD (in)</th><th>Yield needs (in)</th><th>Buckling needs (in)</th><th>Min floor (in)</th><th>Wall used (in)</th>
          <th>Governed by</th><th>Area (in²)</th><th>Length (in)</th><th>Density (lb/in³)</th><th>Mass (lb)</th><th>Material cost</th>
        </tr></thead>
        <tbody>
          ${tubeRow("A", "Long section, aluminum (A)")}
          ${tubeRow("B", "Long section, steel (B)")}
          ${tubeRow("C", "Long section, titanium (C)")}
          ${tubeRow("S", "Short section, steel (all)")}
        </tbody>
      </table>
    </div>
    <button type="button" class="xl-btn xl-btn-small" data-action="use-optimum">Set every OD to its material's optimum</button>

    <div class="xl-cards">
      ${designCard("A", "Design A, mixed", ["xl-tag-out", "Ruled out by FEA"])}
      ${designCard("B", "Design B, all steel", ["xl-tag-final", "Final design"])}
      ${designCard("C", "Design C, titanium long", null)}
    </div>

    <section class="xl-block">
      <h4>Main comparison</h4>
      <div class="xl-table-wrap"><table class="xl-table xl-main">
        <thead><tr><th>Design</th><th>Total mass (lb)</th><th>Δ vs A (lb)</th><th>Δ vs A (%)</th><th>Total cost</th><th>Δ cost vs A</th></tr></thead>
        <tbody data-out-html="main"></tbody>
      </table></div>
      <p class="xl-verdict" data-out-html="verdict"></p>
    </section>

    <div class="xl-grid-2">
      <section class="xl-block">
        <h4>Current car drive shaft</h4>
        <p class="xl-hint" data-out-html="current-note"></p>
        <div class="xl-table-wrap"><table class="xl-table xl-breakdown"><tbody data-out-html="current"></tbody></table></div>
      </section>
      <section class="xl-block">
        <h4>Against the current car</h4>
        <div class="xl-table-wrap"><table class="xl-table xl-main">
          <thead><tr><th>Design</th><th>Mass (lb)</th><th>Δ (lb)</th><th>Δ (%)</th><th>Cost</th></tr></thead>
          <tbody data-out-html="vs-current"></tbody>
        </table></div>
      </section>
    </div>
    <p class="xl-hint">Design C puts titanium only in the long tube, with two titanium and two steel yokes. Cost figures are estimates and can be edited on the Inputs tab.</p>`;

  const methodTab = `
    <div class="xl-prose">
      <h4>The idea</h4>
      <p>A tube in pure torsion can fail two ways: yield and buckling. Yield wants a thicker wall, and for a given torque a bigger diameter needs less wall, so yield alone keeps getting lighter as the diameter grows. Buckling is the opposite: a big, thin tube buckles easily. Together they give a real lightest tube.</p>
      <h4>Yield and buckling walls</h4>
      <p>Shear stress from torque is T over the polar section modulus Z<sub>p</sub>, and shear yield is tensile yield × 0.577. The yield wall is the thinnest that keeps the shear stress at the design torque times the yield factor of safety below shear yield.</p>
      <p>The buckling wall uses the Timoshenko long-cylinder critical shear stress, τ<sub>cr</sub> = 0.272 · E · (t/r)<sup>1.5</sup> / (1 − ν²)<sup>0.75</sup>, times a knockdown factor, held to the buckling factor of safety.</p>
      <h4>Governing wall and material minimum</h4>
      <p>Each material has its own minimum manufacturable wall, because aluminum needs a thicker weldable section than steel or titanium. The wall used at each diameter is the largest of the yield wall, the buckling wall and that minimum. The optimizer sweeps the diameter and reports the lightest.</p>
      <h4>Materials</h4>
      <p>6061-T6 aluminum is the current material. AISI 4130 chromoly is the weldable steel candidate. Ti-6Al-4V is the titanium option if funding allows: strong and light, but expensive and hard to machine.</p>
      <h4>Assumptions and limits</h4>
      <p>Static pure torsion only. The buckling check uses the long-cylinder thin-wall formula with one knockdown factor. It ignores stress concentrations at the yoke welds, fatigue, and bending or axial loads. The optimized sizes are rounded to the closest standard tube sizes before anything is ordered.</p>
      <h4>Units</h4>
      <p>Imperial throughout: inches, psi, lb·in torque, lb/in³ density and lb mass. Since psi is lb/in², shear yield times Z<sub>p</sub> gives lb·in directly.</p>
    </div>`;

  root.innerHTML = `
    <header class="xl-head">
      <div class="xl-head-text">
        <p class="xl-file">driveshaft_material_optimization.xlsx</p>
        <p class="xl-title" role="heading" aria-level="2">Driveshaft Material Optimization</p>
        <p class="xl-editable"><span class="xl-in-demo">blue cells</span> are editable. Change any of them and everything recalculates live.</p>
      </div>
      <button type="button" class="xl-btn" data-action="reset">Reset to workbook values</button>
    </header>
    <div class="xl-results" data-out-html="results" aria-live="polite"></div>
    <nav class="xl-tabs" role="tablist" aria-label="Workbook sheets">
      ${TABS.map(([id, label], i) => `<button type="button" role="tab" class="xl-tab" id="xl-tab-${id}" aria-controls="xl-sheet-${id}" aria-selected="${i === 0}" data-tab="${id}">${label}</button>`).join("")}
    </nav>
    <div class="xl-body">
      <div class="xl-sheet" role="tabpanel" id="xl-sheet-inputs" aria-labelledby="xl-tab-inputs">${inputsTab}</div>
      <div class="xl-sheet" role="tabpanel" id="xl-sheet-optimizer" aria-labelledby="xl-tab-optimizer" hidden>${optimizerTab}</div>
      <div class="xl-sheet" role="tabpanel" id="xl-sheet-summary" aria-labelledby="xl-tab-summary" hidden>${summaryTab}</div>
      <div class="xl-sheet" role="tabpanel" id="xl-sheet-compare" aria-labelledby="xl-tab-compare" hidden>${compareTab}</div>
      <div class="xl-sheet" role="tabpanel" id="xl-sheet-method" aria-labelledby="xl-tab-method" hidden>${methodTab}</div>
    </div>`;

  const body = root.querySelector(".xl-body");

  /* ---------- rendering outputs ---------- */

  function setOut(key, text) {
    root.querySelectorAll(`[data-out="${key}"]`).forEach((el) => { el.textContent = text; });
  }
  function setHtml(key, html) {
    const el = root.querySelector(`[data-out-html="${key}"]`);
    if (el) el.innerHTML = html;
  }

  const govLabel = (g) => `<span class="xl-gov xl-gov-${g}">${g}</span>`;

  function render() {
    r = compute();

    // Inputs tab
    setOut("nm", fmt(s.T * NM_PER_LBIN, 1));
    setOut("Ltot", fmt(r.Ltot, 2));
    for (const m of MATS) {
      setOut("tau-" + m, fmt(tauY(m), 0));
      setOut("mpa-tau-" + m, fmt(tauY(m) * MPA_PER_PSI, 0));
      setOut("mpa-sy-" + m, fmt(s[m].sy * MPA_PER_PSI, 0));
      setOut("y-" + m, fmt(r.yoke[m], 3));
    }
    const b = r.base;
    setOut("b-ID", fmt(b.ID, 3));
    setOut("b-area", fmt(b.area, 4));
    setOut("b-Zp", fmt(b.Zp, 4));
    setOut("b-tau", fmt(b.tau, 0));
    setOut("b-cap", fmt(b.cap, 0));
    setOut("b-fos", fmt(b.fos, 2));
    setOut("b-mass", fmt(b.mass, 3));

    renderSweep();
    renderSummary();
    renderCompare();
    renderResults();
    drawChart();
  }

  function renderResults() {
    const st = r.best.st;
    const B = r.designs.B, cur = r.current;
    const d = B.mass / cur.mass - 1;
    setHtml("results", `
      <div><span class="xl-k">Steel optimum</span><span class="xl-v">${st ? fmt(st.OD, 2) + " in OD × " + fmt(st.t, 3) + " in wall" : "–"}</span></div>
      <div><span class="xl-k">All-steel shaft</span><span class="xl-v">${fmt(B.mass, 2)} lb <small>(${fmt(B.mass * KG_PER_LB, 2)} kg)</small></span></div>
      <div><span class="xl-k">vs current car</span><span class="xl-v">${pct(d)}</span></div>
      <div><span class="xl-k">Lightest / cheapest</span><span class="xl-v">${r.lightest ? "Design " + r.lightest : "–"} / ${r.cheapest ? "Design " + r.cheapest : "–"}</span></div>`);
  }

  function renderSweep() {
    root.querySelectorAll(".xl-seg-btn").forEach((btn) => {
      const on = btn.dataset.mat === optMat;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on);
    });
    const m = optMat;
    setHtml("lookup", [
      ["Shear yield", fmt(tauY(m), 0) + " psi"],
      ["E", fmt(s[m].E, 0) + " psi"],
      ["Poisson", fmt(s[m].nu, 3)],
      ["Density", fmt(s[m].rho, 4) + " lb/in³"],
      ["k buckling", fmt(kBuck(m), 0) + " psi"],
      ["Min wall", fmt(s[m].tmin, 3) + " in"],
    ].map(([k, v]) => `<span><b>${k}</b> ${v}</span>`).join(""));

    const best = r.best[m];
    // The workbook's two-colour scale on the mass column: green at the
    // lightest row, red at the heaviest, blended linearly in RGB like Excel.
    const masses = r.sweep[m].filter((q) => q.res).map((q) => q.res.mpi);
    const lo = Math.min(...masses), hi = Math.max(...masses);
    const massStyle = (v) => {
      const f = hi > lo ? (v - lo) / (hi - lo) : 0;
      const c = SCALE_LO.map((a, i) => Math.round(a + (SCALE_HI[i] - a) * f));
      return `background-color: rgb(${c.join(",")})`;
    };
    const rows = r.sweep[m].map(({ OD, res }) => {
      const isBest = best && res && OD === best.OD;
      const isBase = m === "al" && Math.abs(OD - s.baseOD) < 1e-9;
      const cls = isBest ? "is-best" : isBase ? "is-base" : "";
      const tag = isBest ? `<span class="xl-tag xl-tag-final">Lightest</span>` : isBase ? `<span class="xl-tag xl-tag-base">Current car OD</span>` : "";
      if (!res) return `<tr class="${cls}"><td>${fmt(OD, 2)}</td><td colspan="9" class="xl-na">Too small to carry the torque at this factor of safety</td><td>${tag}</td></tr>`;
      return `<tr class="${cls}">
        <td>${fmt(OD, 2)}</td><td>${fmt(res.tY, 4)}</td><td>${fmt(res.tB, 4)}</td><td class="xl-strong">${fmt(res.t, 4)}</td><td>${govLabel(res.gov)}</td>
        <td>${fmt(res.ID, 3)}</td><td>${fmt(res.area, 4)}</td><td class="xl-scale" style="${massStyle(res.mpi)}">${fmt(res.mpi, 4)}</td><td>${fmt(res.fosY, 2)}</td><td>${fmt(res.fosB, 2)}</td><td>${tag}</td>
      </tr>`;
    });
    setHtml("sweep", rows.join(""));
  }

  function renderSummary() {
    const rows = MATS.map((m) => {
      const x = r.best[m];
      if (!x) return `<tr><th scope="row"><i class="xl-swatch xl-swatch-${m}"></i>${MAT_NAME[m]}</th><td colspan="8" class="xl-na">No valid diameter in range</td></tr>`;
      return `<tr>
        <th scope="row"><i class="xl-swatch xl-swatch-${m}"></i>${MAT_NAME[m]}</th>
        <td class="xl-hl">${fmt(x.OD, 2)}</td><td class="xl-hl">${fmt(x.t, 3)}</td><td>${govLabel(x.gov)}</td>
        <td>${fmt(x.fosY, 2)}</td><td>${fmt(x.fosB, 2)}</td><td>${fmt(x.mpi, 4)}</td><td class="xl-hl">${fmt(x.full, 3)}</td><td>${signed(x.vsBase, 3)}</td>
      </tr>`;
    });
    rows.push(`<tr class="xl-ref">
      <th scope="row">Current aluminum tube (${fmt(s.baseOD, 3)} in, ${fmt(s.baseT, 3)} in)</th>
      <td>${fmt(s.baseOD, 2)}</td><td>${fmt(s.baseT, 3)}</td><td></td><td>${fmt(r.base.fos, 2)}</td><td></td><td></td><td>${fmt(r.base.mass, 3)}</td><td></td>
    </tr>`);
    setHtml("summary", rows.join(""));
  }

  function renderCompare() {
    for (const [key, t] of Object.entries(r.tubes)) {
      const p = "tube-" + key + "-";
      const res = t.res;
      setOut(p + "tY", res ? fmt(res.tY, 4) : "–");
      setOut(p + "tB", res ? fmt(res.tB, 4) : "–");
      setOut(p + "tMin", fmt(s[t.m].tmin, 3));
      setOut(p + "t", res ? fmt(res.t, 4) : "–");
      setOut(p + "gov", res ? res.gov.replace("min-wall", "min floor") : "too small");
      setOut(p + "area", res ? fmt(res.area, 4) : "–");
      setOut(p + "L", fmt(t.L, 2));
      setOut(p + "rho", fmt(s[t.m].rho, 4));
      setOut(p + "mass", fmt(t.mass, 3));
      setOut(p + "cost", money(t.cost));
    }

    for (const k of ["A", "B", "C"]) {
      const d = r.designs[k];
      setHtml("design-" + k, d.lines.map(([label, mass, cost]) =>
        `<tr><th scope="row">${label}</th><td>${fmt(mass, 3)} lb</td><td>${money(cost)}</td></tr>`).join("")
        + `<tr><th scope="row">Fabrication (welding + machining)</th><td></td><td>${money(d.fab)}</td></tr>`
        + `<tr class="xl-total"><th scope="row">Total</th><td>${fmt(d.mass, 3)} lb</td><td>${money(d.cost)}</td></tr>`);
    }

    const A = r.designs.A;
    setHtml("main", ["A", "B", "C"].map((k) => {
      const d = r.designs[k];
      return `<tr><th scope="row">${r.names[k]}</th><td>${fmt(d.mass, 3)}</td><td>${signed(d.mass - A.mass, 3)}</td><td>${pct(d.mass / A.mass - 1)}</td><td>${money(d.cost)}</td><td>${Number.isFinite(d.cost - A.cost) ? (d.cost - A.cost > 0 ? "+" : "") + money(d.cost - A.cost) : "–"}</td></tr>`;
    }).join(""));
    setHtml("verdict", `Lightest: <strong>${r.lightest ? r.names[r.lightest] : "–"}</strong> · Cheapest: <strong>${r.cheapest ? r.names[r.cheapest] : "–"}</strong>`);

    const cur = r.current;
    setHtml("current-note", `For reference: ${fmt(s.baseOD, 3)} in OD and ${fmt(s.baseT, 3)} in wall on both sections.`);
    setHtml("current", cur.lines.map(([label, mass]) => `<tr><th scope="row">${label}</th><td>${fmt(mass, 3)} lb</td></tr>`).join("")
      + `<tr class="xl-total"><th scope="row">Total</th><td>${fmt(cur.mass, 3)} lb</td></tr>`
      + `<tr><th scope="row">Estimated cost</th><td>${money(cur.cost)}</td></tr>`);
    const vs = [["Current car", cur]].concat(["A", "B", "C"].map((k) => [r.names[k], r.designs[k]]));
    setHtml("vs-current", vs.map(([n, d]) =>
      `<tr><th scope="row">${n}</th><td>${fmt(d.mass, 3)}</td><td>${signed(d.mass - cur.mass, 3)}</td><td>${pct(d.mass / cur.mass - 1)}</td><td>${money(d.cost)}</td></tr>`).join(""));
  }

  /* ---------- chart ---------- */

  // Drawn at the box's real pixel width (and redrawn when it changes) so
  // text and line weights stay the same size on any screen.
  const M = { t: 16, r: 20, b: 46, l: 60 };
  const X0 = 0.7, X1 = 2.4;
  let W = 760, H = 340, PW = 0, PH = 0, yMax = 0.16, yStep = 0.04;
  const sx = (v) => M.l + (v - X0) / (X1 - X0) * PW;
  const sy = (v) => M.t + PH - v / yMax * PH;

  // Tick step from 1, 2, 2.5, 5 x 10^n, giving about four intervals.
  function niceStep(span) {
    const raw = span / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= raw) return k * p;
    return 10 * p;
  }

  function drawChart() {
    const svg = root.querySelector("[data-chart-svg]");
    if (!svg) return;
    const w = svg.parentElement.clientWidth;
    if (!w) return; // hidden; the resize observer redraws once it shows
    W = w;
    H = Math.round(Math.min(380, Math.max(260, W * 0.42)));
    PW = W - M.l - M.r;
    PH = H - M.t - M.b;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", H);

    let mx = 0;
    for (const m of MATS) for (const { res } of r.sweep[m]) if (res) mx = Math.max(mx, res.mpi);
    yStep = niceStep(mx || 0.1);
    yMax = Math.ceil((mx || 0.1) / yStep - 1e-9) * yStep;
    const yDec = Math.max(0, -Math.floor(Math.log10(yStep) + 1e-9)) + (String(yStep).includes("25") ? 1 : 0);

    let g = "";
    // grid + y ticks
    const nTicks = Math.round(yMax / yStep);
    for (let i = 0; i <= nTicks; i++) {
      const v = i * yStep, y = sy(v);
      g += `<line class="xl-grid${i === 0 ? " xl-axis" : ""}" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/>`;
      g += `<text class="xl-tick" x="${M.l - 10}" y="${y + 4}" text-anchor="end">${fmt(v, yDec)}</text>`;
    }
    const xEvery = W < 520 ? 0.5 : 0.25;
    for (let v = 0.75; v <= 2.26; v += xEvery) {
      const x = sx(v);
      g += `<text class="xl-tick" x="${x}" y="${M.t + PH + 20}" text-anchor="middle">${fmt(v, 2)}</text>`;
    }
    g += `<text class="xl-axis-label" x="${M.l + PW / 2}" y="${H - 6}" text-anchor="middle">Outer diameter (in)</text>`;
    g += `<text class="xl-axis-label" transform="translate(16 ${M.t + PH / 2}) rotate(-90)" text-anchor="middle">Mass (lb/in)</text>`;

    // series lines
    for (const m of MATS) {
      let d = "", pen = false;
      for (const { OD, res } of r.sweep[m]) {
        if (!res || res.mpi > yMax) { pen = false; continue; }
        d += (pen ? "L" : "M") + sx(OD).toFixed(1) + " " + sy(res.mpi).toFixed(1);
        pen = true;
      }
      g += `<path class="xl-line xl-line-${m}" d="${d}"/>`;
    }

    // optimum markers + direct labels
    const labelOffset = { al: [-10, -12, "end"], st: [12, 20, "start"], ti: [0, 24, "middle"] };
    for (const m of MATS) {
      const b = r.best[m];
      if (!b) continue;
      const x = sx(b.OD), y = sy(b.mpi);
      const [dx, dy, anchor] = labelOffset[m];
      const text = W < 520 ? `${fmt(b.OD, 2)} in` : `${fmt(b.OD, 2)} in × ${fmt(b.t, 3)} in`;
      // Keep the label inside the plot: estimate its width and slide it in
      // from whichever edge it would cross.
      const tw = text.length * 6.6;
      let left = anchor === "end" ? x + dx - tw : anchor === "middle" ? x + dx - tw / 2 : x + dx;
      left = Math.min(Math.max(left, M.l + 4), W - M.r - tw);
      g += `<circle class="xl-dot xl-dot-${m}" cx="${x}" cy="${y}" r="5.5"/>`;
      g += `<text class="xl-dlabel" x="${left}" y="${y + dy}" text-anchor="start">${text}</text>`;
    }

    // hover layer
    g += `<line class="xl-cross" data-cross x1="0" x2="0" y1="${M.t}" y2="${M.t + PH}" visibility="hidden"/>`;
    g += MATS.map((m) => `<circle class="xl-hdot xl-dot-${m}" data-hdot="${m}" r="4.5" visibility="hidden"/>`).join("");
    g += `<rect class="xl-hit" x="${M.l}" y="${M.t}" width="${PW}" height="${PH}" data-hit/>`;
    svg.innerHTML = g;
    bindHover(svg);
  }

  function bindHover(svg) {
    const hit = svg.querySelector("[data-hit]");
    const cross = svg.querySelector("[data-cross]");
    const tip = root.querySelector("[data-chart-tip]");
    const box = root.querySelector(".xl-chart-box");

    const hide = () => {
      cross.setAttribute("visibility", "hidden");
      svg.querySelectorAll("[data-hdot]").forEach((d) => d.setAttribute("visibility", "hidden"));
      tip.hidden = true;
    };

    const move = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const vx = (clientX - rect.left) / rect.width * W;
      let od = X0 + (vx - M.l) / PW * (X1 - X0);
      od = Math.round(od * 100) / 100;
      const x = sx(od);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x);
      cross.setAttribute("visibility", "visible");
      let rows = "";
      for (const m of MATS) {
        const row = r.sweep[m].find((q) => Math.abs(q.OD - od) < 1e-9);
        const dot = svg.querySelector(`[data-hdot="${m}"]`);
        if (row && row.res && row.res.mpi <= yMax) {
          dot.setAttribute("cx", x); dot.setAttribute("cy", sy(row.res.mpi)); dot.setAttribute("visibility", "visible");
          rows += `<div class="xl-tip-row"><i class="xl-swatch xl-swatch-${m}"></i><span>${MAT_SHORT[m]}</span><b>${fmt(row.res.mpi, 4)}</b></div><small>${fmt(row.res.t, 3)} in wall, ${row.res.gov}</small>`;
        } else {
          dot.setAttribute("visibility", "hidden");
          rows += `<div class="xl-tip-row is-empty"><i class="xl-swatch xl-swatch-${m}"></i><span>${MAT_SHORT[m]}</span><b>–</b></div><small>${row && row.res ? "off chart" : "outside its sweep range"}</small>`;
        }
      }
      tip.innerHTML = `<p>OD ${fmt(od, 2)} in · mass (lb/in)</p>${rows}`;
      tip.hidden = false;
      const px = x / W * rect.width;
      const tw = tip.offsetWidth;
      tip.style.left = (px + 14 + tw > rect.width ? px - 14 - tw : px + 14) + "px";
    };

    hit.addEventListener("pointermove", (e) => move(e.clientX));
    hit.addEventListener("pointerdown", (e) => move(e.clientX));
    hit.addEventListener("pointerleave", hide);
    box.onmouseleave = hide;
  }

  /* ---------- events ---------- */

  body.addEventListener("input", (e) => {
    const el = e.target.closest(".xl-in");
    if (!el) return;
    const v = parseFloat(el.value);
    const ok = Number.isFinite(v);
    el.classList.toggle("is-invalid", !ok);
    if (!ok) return;
    setPath(el.dataset.path, v);
    syncInputs(el);
    render();
  });

  // The same value can appear in more than one place (none do today, but
  // keep any duplicates in step with the one being edited).
  function syncInputs(except) {
    root.querySelectorAll(".xl-in").forEach((el) => {
      if (el === except) return;
      const v = getPath(el.dataset.path);
      if (parseFloat(el.value) !== v) el.value = v;
      el.classList.remove("is-invalid");
    });
  }

  root.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) return showTab(tab.dataset.tab);
    const seg = e.target.closest("[data-mat]");
    if (seg) { optMat = seg.dataset.mat; renderSweep(); return; }
    const act = e.target.closest("[data-action]");
    if (!act) return;
    if (act.dataset.action === "reset") {
      s = structuredClone(DEFAULTS);
      syncInputs(null);
      render();
    } else if (act.dataset.action === "jump-best") {
      const row = root.querySelector(".xl-sweep tr.is-best");
      if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
    } else if (act.dataset.action === "use-optimum") {
      if (r.best.al) s.od.A = r.best.al.OD;
      if (r.best.st) { s.od.B = r.best.st.OD; s.od.S = r.best.st.OD; }
      if (r.best.ti) s.od.C = r.best.ti.OD;
      syncInputs(null);
      render();
    }
  });

  function showTab(id) {
    root.querySelectorAll(".xl-tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === id));
    root.querySelectorAll(".xl-sheet").forEach((p) => { p.hidden = p.id !== "xl-sheet-" + id; });
    body.scrollTop = 0;
  }

  root.querySelector(".xl-tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...root.querySelectorAll(".xl-tab")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    showTab(next.dataset.tab);
  });

  // Let a page link open the viewer straight onto one sheet.
  document.querySelectorAll("[data-optimizer-tab]").forEach((el) => {
    el.addEventListener("click", () => showTab(el.dataset.optimizerTab));
  });

  const chartBox = root.querySelector(".xl-chart-box");
  if (chartBox && "ResizeObserver" in window) {
    let lastW = 0;
    new ResizeObserver(() => {
      if (chartBox.clientWidth !== lastW && r) { lastW = chartBox.clientWidth; drawChart(); }
    }).observe(chartBox);
  }

  render();
})();
