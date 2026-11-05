(() => {
  "use strict";

  const SESSION_KEY = "mlcp-session-v1";
  const PREFS_KEY = "mlcp-prefs-v1";
  const FONT_STEPS = [0.9, 1, 1.12, 1.25, 1.4];
  const GAUGE_LEN = 2 * Math.PI * 52;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const range = (n) => [...Array(n).keys()];
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const byId = Object.fromEntries(EXAM.questions.map((q) => [q.id, q]));
  const domainOf = (id) => EXAM.domains.find((d) => d.id === id);
  const fmtDate = (t) => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const fmtDuration = (ms) => {
    const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
    return `${m} min ${String(s).padStart(2, "0")} s`;
  };

  let state = null;
  let timerId = null;
  let unloading = false;
  let prefs = { font: 1, hc: false };

  // ---------- Persistance ----------
  const save = () => localStorage.setItem(SESSION_KEY, JSON.stringify(state));
  const loadSession = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  };
  const savePrefs = () => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));

  // ---------- Écrans ----------
  function show(name) {
    $$(".screen").forEach((s) => (s.hidden = s.id !== `screen-${name}`));
    document.body.dataset.screen = name;
    window.scrollTo(0, 0);
    const title = $(`#screen-${name} h1`);
    if (title && name !== "home") { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  }
  const inExam = () => state && !state.submitted && ["exam", "review"].includes(document.body.dataset.screen);

  // ---------- Notifications et dialogue ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
  }
  function confirmDialog(title, text, okLabel = "Confirmer") {
    const d = $("#modal");
    $("#modal-title").textContent = title;
    $("#modal-text").textContent = text;
    $("#modal-ok").textContent = okLabel;
    d.returnValue = "";
    d.showModal();
    return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true }));
  }

  // ---------- Préférences d'affichage ----------
  function applyPrefs() {
    document.documentElement.style.setProperty("--fs", FONT_STEPS[prefs.font]);
    document.body.classList.toggle("hc", prefs.hc);
    $$("[data-contrast]").forEach((b) => b.setAttribute("aria-pressed", String(prefs.hc)));
    $$('[data-font="-1"]').forEach((b) => (b.disabled = prefs.font === 0));
    $$('[data-font="1"]').forEach((b) => (b.disabled = prefs.font === FONT_STEPS.length - 1));
  }

  // ---------- Accueil ----------
  function renderHome() {
    const total = EXAM.questions.length;
    $("#domain-list").innerHTML = EXAM.domains.map((d, i) => {
      const n = EXAM.questions.filter((q) => q.domain === d.id).length;
      const w = Math.round((n / total) * 100);
      return `<article class="domain">
        <span class="domain-n" aria-hidden="true">${i + 1}</span>
        <div><h3>${esc(d.name)}</h3><p>${esc(d.desc)}</p></div>
        <div class="weight"><span>Pondération <b>${w} %</b> · ${n} questions</span>
          <div class="bar" role="img" aria-label="${w} % de l'examen"><span style="width:${w}%"></span></div></div>
      </article>`;
    }).join("");
    $("#fact-q").textContent = total;
    $("#fact-t").textContent = `${EXAM.durationMin} min`;
    $("#recap-q").textContent = total;
    $("#recap-t").textContent = `${EXAM.durationMin} minutes`;
    const s = loadSession();
    $("#last-result").hidden = !(s && s.submitted);
  }

  function renderSysCheck() {
    const checks = [
      ["Navigateur compatible", "fetch" in window && "HTMLDialogElement" in window],
      ["Enregistrement local", (() => { try { localStorage.setItem("_t", "1"); localStorage.removeItem("_t"); return true; } catch { return false; } })()],
      ["Connexion Internet", navigator.onLine],
      ["Résolution d'écran (≥ 1024 px conseillé)", window.innerWidth >= 1024]
    ];
    $("#sys-check").innerHTML = checks.map(([label, ok]) =>
      `<li><span>${label}</span><span class="${ok ? "ok" : "ko"}">${ok ? "✓ OK" : "⚠ À vérifier"}</span></li>`).join("");
  }

  // ---------- Inscription ----------
  function handleRegister(e) {
    e.preventDefault();
    const f = e.target.elements;
    const name = f.name.value.trim(), email = f.email.value.trim();
    const errors = {
      name: name.length < 3,
      email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      rules: !f.rules.checked
    };
    for (const [k, bad] of Object.entries(errors)) {
      $(`#e-${k}`).hidden = !bad;
      f[k].setAttribute("aria-invalid", String(bad));
    }
    const firstBad = Object.keys(errors).find((k) => errors[k]);
    if (firstBad) { f[firstBad].focus(); return; }
    startExam({ name, email, extraTime: f.extraTime.checked });
  }

  // ---------- Démarrage ----------
  function startExam(candidate) {
    const optOrder = {};
    for (const q of EXAM.questions) {
      if (q.type === "single" || q.type === "multi") optOrder[q.id] = shuffle(range(q.options.length));
      else if (q.type === "tf") optOrder[q.id] = [0, 1];
      else if (q.type === "order") {
        let p;
        do { p = shuffle(range(q.items.length)); } while (p.every((v, i) => v === i));
        optOrder[q.id] = p;
      } else if (q.type === "match") optOrder[q.id] = shuffle(range(q.pairs.length));
    }
    const minutes = EXAM.durationMin * (candidate.extraTime ? 1.25 : 1);
    const now = Date.now();
    state = {
      candidate,
      order: shuffle(EXAM.questions.map((q) => q.id)),
      optOrder,
      answers: {},
      flagged: [],
      current: 0,
      startedAt: now,
      endsAt: now + minutes * 60000,
      tabSwitches: 0,
      warned5: false,
      submitted: false
    };
    save();
    document.documentElement.requestFullscreen?.()?.catch(() => {});
    enterExam();
  }

  function enterExam() {
    $("#exam-candidate").textContent = `${state.candidate.name} · ${state.candidate.email}`;
    show("exam");
    renderQuestion();
    updateIntegrityBanner();
    clearInterval(timerId);
    tick();
    timerId = setInterval(tick, 1000);
  }

  // ---------- Chronomètre ----------
  function tick() {
    if (!state || state.submitted) return clearInterval(timerId);
    const left = Math.max(0, state.endsAt - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    $("#timer").textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    $("#timer-box").classList.toggle("warn", left < 5 * 60000);
    if (left < 5 * 60000 && left > 0 && !state.warned5) {
      state.warned5 = true;
      save();
      toast("Attention : il reste moins de 5 minutes.");
    }
    if (left === 0) submit(true);
  }

  // ---------- Réponses ----------
  function isAnswered(q, a = state.answers[q.id]) {
    if (a === undefined || a === null) return false;
    if (q.type === "multi") return a.length > 0;
    if (q.type === "match") return Object.keys(a).length === q.pairs.length;
    return true;
  }
  const answeredCount = () => EXAM.questions.filter((q) => isAnswered(q)).length;
  const isFlagged = (id) => state.flagged.includes(id);

  function setAnswer(id, value) {
    if (value === undefined) delete state.answers[id];
    else state.answers[id] = value;
    save();
    renderNav();
  }

  // ---------- Affichage d'une question ----------
  function renderQuestion(focusTitle = false) {
    const id = state.order[state.current], q = byId[id], a = state.answers[id];
    const dom = domainOf(q.domain);
    $("#q-meta").textContent = `Question ${state.current + 1} sur ${state.order.length} · ${dom.name}`;

    let html = "";
    if (q.context) html += `<div class="scenario"><strong>Étude de cas</strong><p>${esc(q.context)}</p></div>`;
    html += `<h2 id="q-text" class="q-text" tabindex="-1">${esc(q.text)}</h2>`;

    if (q.type === "single" || q.type === "tf" || q.type === "multi") {
      const multi = q.type === "multi";
      if (multi) html += `<p class="hint" id="q-hint">Choisissez ${q.answer.length} réponses.</p>`;
      html += `<fieldset class="options" aria-labelledby="q-text"${multi ? ' aria-describedby="q-hint"' : ""}>` +
        state.optOrder[id].map((oi, k) => {
          const checked = multi ? (a || []).includes(oi) : a === oi;
          return `<label class="option${multi ? " multi" : ""}${checked ? " selected" : ""}">
            <input type="${multi ? "checkbox" : "radio"}" name="opt" value="${oi}"${checked ? " checked" : ""}>
            <span class="key" aria-hidden="true">${String.fromCharCode(65 + k)}</span>
            <span>${esc(q.options[oi])}</span></label>`;
        }).join("") + `</fieldset>`;
    } else if (q.type === "order") {
      const cur = a || state.optOrder[id];
      html += `<p class="hint">Glissez-déposez les éléments ou utilisez les flèches ▲ ▼.</p>
        <ol class="order-list" aria-labelledby="q-text">` +
        cur.map((ii, pos) => `<li class="order-item" draggable="true" data-pos="${pos}">
          <span class="pos" aria-hidden="true">${pos + 1}</span>
          <span class="txt">${esc(q.items[ii])}</span>
          <span class="order-btns">
            <button type="button" class="icon-btn" data-move="-1" data-pos="${pos}" aria-label="Monter « ${esc(q.items[ii])} »"${pos === 0 ? " disabled" : ""}>▲</button>
            <button type="button" class="icon-btn" data-move="1" data-pos="${pos}" aria-label="Descendre « ${esc(q.items[ii])} »"${pos === cur.length - 1 ? " disabled" : ""}>▼</button>
          </span></li>`).join("") + `</ol>`;
      if (!a) html += `<button type="button" class="btn btn-ghost sm" id="keep-order">Valider cet ordre tel quel</button>`;
    } else if (q.type === "match") {
      html += `<p class="hint">Sélectionnez la correspondance de chaque élément.</p><div class="match">` +
        q.pairs.map(([left], li) => `<div class="match-row">
          <span class="match-left" id="ml-${li}">${esc(left)}</span>
          <select data-li="${li}" aria-labelledby="ml-${li}">
            <option value="">— Choisir —</option>
            ${state.optOrder[id].map((ri) => `<option value="${ri}"${a && a[li] === ri ? " selected" : ""}>${esc(q.pairs[ri][1])}</option>`).join("")}
          </select></div>`).join("") + `</div>`;
    }

    $("#q-body").innerHTML = html;
    const flagged = isFlagged(id);
    $("#btn-flag").setAttribute("aria-pressed", String(flagged));
    $("#btn-flag").textContent = flagged ? "⚑ Marquée pour révision" : "⚑ Marquer pour révision";
    $("#btn-prev").disabled = state.current === 0;
    $("#btn-next").textContent = state.current === state.order.length - 1 ? "Revue et soumission →" : "Suivante →";
    renderNav();
    if (focusTitle) $("#q-text").focus({ preventScroll: true });
  }

  function renderNav() {
    $("#nav-grid").innerHTML = state.order.map((id, i) => {
      const q = byId[id], ans = isAnswered(q), fl = isFlagged(id), cur = i === state.current;
      const label = `Question ${i + 1}, ${ans ? "répondue" : "non répondue"}${fl ? ", marquée" : ""}`;
      return `<button type="button" class="nav-btn${ans ? " answered" : ""}${fl ? " flagged" : ""}${cur ? " current" : ""}"
        data-goto="${i}" aria-label="${label}"${cur ? ' aria-current="step"' : ""}>${i + 1}</button>`;
    }).join("");
    const n = answeredCount(), total = state.order.length;
    $("#nav-summary").textContent = `${n} / ${total} répondues · ${state.flagged.length} marquée(s)`;
    $("#progress-fill").style.width = `${(n / total) * 100}%`;
  }

  function goTo(i) {
    if (i < 0) return;
    if (i >= state.order.length) return openReview();
    state.current = i;
    save();
    renderQuestion(true);
    window.scrollTo({ top: 0 });
  }

  function toggleFlag() {
    const id = state.order[state.current];
    state.flagged = isFlagged(id) ? state.flagged.filter((x) => x !== id) : [...state.flagged, id];
    save();
    renderQuestion();
  }

  // ---------- Interactions sur la question ----------
  function onOptionChange(e) {
    const input = e.target;
    const id = state.order[state.current], q = byId[id];
    if (input.name === "opt") {
      if (q.type === "multi") {
        let vals = $$("#q-body input:checked").map((i) => +i.value);
        if (vals.length > q.answer.length) {
          input.checked = false;
          vals = vals.filter((v) => v !== +input.value);
          const hint = $("#q-hint");
          hint.classList.add("err");
          hint.textContent = `Vous ne pouvez choisir que ${q.answer.length} réponses. Désélectionnez-en une d'abord.`;
        } else {
          $("#q-hint").classList.remove("err");
          $("#q-hint").textContent = `Choisissez ${q.answer.length} réponses.`;
        }
        setAnswer(id, vals.length ? vals : undefined);
      } else {
        setAnswer(id, +input.value);
      }
      $$("#q-body .option").forEach((l) => l.classList.toggle("selected", l.querySelector("input").checked));
    } else if (input.tagName === "SELECT") {
      const ans = { ...(state.answers[id] || {}) };
      if (input.value === "") delete ans[input.dataset.li];
      else ans[input.dataset.li] = +input.value;
      setAnswer(id, Object.keys(ans).length ? ans : undefined);
    }
  }

  function moveOrder(from, to, focusDir) {
    const id = state.order[state.current];
    const cur = [...(state.answers[id] || state.optOrder[id])];
    if (to < 0 || to >= cur.length) return;
    const [item] = cur.splice(from, 1);
    cur.splice(to, 0, item);
    setAnswer(id, cur);
    renderQuestion();
    if (focusDir) {
      const btn = $(`#q-body [data-move="${focusDir}"][data-pos="${to}"]`);
      (btn && !btn.disabled ? btn : $(`#q-body [data-move="${-focusDir}"][data-pos="${to}"]`))?.focus();
    }
  }

  function onBodyClick(e) {
    const mv = e.target.closest("[data-move]");
    if (mv) {
      const pos = +mv.dataset.pos, dir = +mv.dataset.move;
      return moveOrder(pos, pos + dir, dir);
    }
    if (e.target.id === "keep-order") {
      const id = state.order[state.current];
      setAnswer(id, [...state.optOrder[id]]);
      renderQuestion();
      toast("Ordre enregistré.");
    }
  }

  let dragFrom = null;
  function bindDrag() {
    const body = $("#q-body");
    body.addEventListener("dragstart", (e) => {
      const li = e.target.closest(".order-item");
      if (!li) return;
      dragFrom = +li.dataset.pos;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    body.addEventListener("dragover", (e) => {
      if (dragFrom !== null && e.target.closest(".order-item")) e.preventDefault();
    });
    body.addEventListener("drop", (e) => {
      const li = e.target.closest(".order-item");
      if (!li || dragFrom === null) return;
      e.preventDefault();
      const to = +li.dataset.pos;
      if (to !== dragFrom) moveOrder(dragFrom, to);
      dragFrom = null;
    });
    body.addEventListener("dragend", () => {
      dragFrom = null;
      $$(".order-item.dragging").forEach((el) => el.classList.remove("dragging"));
    });
  }

  // ---------- Revue ----------
  let reviewFilter = "all";
  function openReview() {
    show("review");
    renderReview();
  }
  function renderReview() {
    const total = state.order.length, n = answeredCount();
    $("#review-stats").innerHTML = `
      <div class="stat"><b>${total}</b><span>Questions</span></div>
      <div class="stat ok"><b>${n}</b><span>Répondues</span></div>
      <div class="stat warn"><b>${total - n}</b><span>Non répondues</span></div>
      <div class="stat flag"><b>${state.flagged.length}</b><span>Marquées</span></div>`;
    const items = state.order.map((id, i) => ({ id, i, q: byId[id] })).filter(({ id, q }) =>
      reviewFilter === "all" || (reviewFilter === "unanswered" && !isAnswered(q)) || (reviewFilter === "flagged" && isFlagged(id)));
    $("#review-list").innerHTML = items.length ? items.map(({ id, i, q }) => `<li>
      <button type="button" class="review-item" data-goto="${i}">
        <span class="n">${i + 1}</span><span class="t">${esc(q.text)}</span>
        ${isFlagged(id) ? '<span class="tag flag">Marquée</span>' : ""}
        ${isAnswered(q) ? '<span class="tag ok">Répondue</span>' : '<span class="tag warn">Non répondue</span>'}
      </button></li>`).join("") : `<li class="muted">Aucune question dans cette catégorie.</li>`;
  }

  async function confirmSubmit() {
    const missing = state.order.length - answeredCount();
    const text = missing
      ? `${missing} question(s) sans réponse seront comptées comme fausses. Une fois soumis, l'examen ne peut plus être modifié.`
      : "Toutes les questions ont une réponse. Une fois soumis, l'examen ne peut plus être modifié.";
    if (await confirmDialog("Soumettre l'examen ?", text, "Soumettre")) submit(false);
  }

  // ---------- Notation ----------
  function scoreOf(q, a) {
    if (a === undefined || a === null) return 0;
    switch (q.type) {
      case "single":
      case "tf": return a === q.answer ? 1 : 0;
      case "multi": return a.length === q.answer.length && q.answer.every((x) => a.includes(x)) ? 1 : 0;
      case "order": return a.every((v, i) => v === i) ? 1 : 0;
      case "match": return q.pairs.filter((_, i) => a[i] === i).length / q.pairs.length;
    }
    return 0;
  }

  function grade() {
    const perQ = {};
    const domains = EXAM.domains.map((d) => ({ id: d.id, name: d.name, earned: 0, total: 0 }));
    let earned = 0;
    for (const q of EXAM.questions) {
      const s = scoreOf(q, state.answers[q.id]);
      perQ[q.id] = s;
      earned += s;
      const d = domains.find((x) => x.id === q.domain);
      d.earned += s;
      d.total += 1;
    }
    const pct = earned / EXAM.questions.length;
    const scaled = Math.round(EXAM.minScore + pct * (EXAM.maxScore - EXAM.minScore));
    return {
      perQ,
      domains: domains.map((d) => ({ ...d, pct: d.earned / d.total })),
      pct,
      scaled,
      pass: scaled >= EXAM.passingScore,
      certId: `MLCP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    };
  }

  function submit(auto) {
    if (!state || state.submitted) return;
    clearInterval(timerId);
    $("#modal").open && $("#modal").close();
    state.submitted = true;
    state.submittedAt = Math.min(Date.now(), state.endsAt);
    state.auto = auto;
    state.result = grade();
    save();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    showResult();
    if (auto) toast("Temps écoulé : votre examen a été soumis automatiquement.");
  }

  // ---------- Résultats ----------
  function fmtGiven(q, a) {
    if (!isAnswered(q, a) && !(q.type === "match" && a)) return "<em>Sans réponse</em>";
    switch (q.type) {
      case "single": case "tf": return esc(q.options[a]);
      case "multi": return a.map((i) => esc(q.options[i])).join("<br>");
      case "order": return `<ol>${a.map((i) => `<li>${esc(q.items[i])}</li>`).join("")}</ol>`;
      case "match": return q.pairs.map((p, i) => `${esc(p[0])} → ${a[i] !== undefined ? esc(q.pairs[a[i]][1]) : "—"}`).join("<br>");
    }
  }
  function fmtCorrect(q) {
    switch (q.type) {
      case "single": case "tf": return esc(q.options[q.answer]);
      case "multi": return q.answer.map((i) => esc(q.options[i])).join("<br>");
      case "order": return `<ol>${q.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`;
      case "match": return q.pairs.map((p) => `${esc(p[0])} → ${esc(p[1])}`).join("<br>");
    }
  }

  let detailFilter = "all";
  function showResult() {
    const r = state.result;
    show("result");

    const gauge = $(".gauge");
    gauge.classList.toggle("pass", r.pass);
    gauge.classList.toggle("fail", !r.pass);
    const fill = $("#gauge-fill");
    fill.style.strokeDasharray = GAUGE_LEN;
    fill.style.strokeDashoffset = GAUGE_LEN;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.strokeDashoffset = GAUGE_LEN * (1 - (r.scaled - EXAM.minScore) / (EXAM.maxScore - EXAM.minScore));
    }));
    animateNumber($("#res-score"), r.scaled);
    $("#gauge-label").setAttribute("aria-label", `Score : ${r.scaled} sur 1000`);

    const badge = $("#res-badge");
    badge.className = `badge ${r.pass ? "pass" : "fail"}`;
    badge.textContent = r.pass ? "Réussi" : "Non réussi";
    $("#res-title").textContent = r.pass
      ? `Félicitations, ${state.candidate.name} !`
      : `Résultat de ${state.candidate.name}`;
    $("#res-msg").textContent = r.pass
      ? `Vous avez obtenu ${r.scaled} points, au-dessus du seuil de ${EXAM.passingScore}. Vous êtes certifié(e) MLCP.`
      : `Vous avez obtenu ${r.scaled} points. Le seuil de réussite est de ${EXAM.passingScore}. Consultez les domaines à renforcer ci-dessous.`;

    $("#res-meta").innerHTML = [
      ["Examen", `${EXAM.code}`],
      ["Date", fmtDate(state.submittedAt)],
      ["Durée utilisée", fmtDuration(state.submittedAt - state.startedAt)],
      ["Soumission", state.auto ? "Automatique (temps écoulé)" : "Par le candidat"],
      ["Sorties de fenêtre", String(state.tabSwitches)],
      ["Aménagement", state.candidate.extraTime ? "+25 % de temps" : "Aucun"]
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");

    $("#res-domains").innerHTML = r.domains.map((d) => {
      const p = Math.round(d.pct * 100), cls = p >= 70 ? "good" : p >= 50 ? "mid" : "low";
      return `<div class="rd-row ${cls}">
        <div class="rd-top"><span>${esc(d.name)}</span><b>${p} %</b></div>
        <div class="bar" role="img" aria-label="${esc(d.name)} : ${p} %"><span style="width:0" data-w="${p}"></span></div>
      </div>`;
    }).join("");
    requestAnimationFrame(() => requestAnimationFrame(() =>
      $$("#res-domains [data-w]").forEach((s) => (s.style.width = `${s.dataset.w}%`))));

    const vals = Object.values(r.perQ);
    const right = vals.filter((v) => v === 1).length;
    const partial = vals.filter((v) => v > 0 && v < 1).length;
    const unanswered = EXAM.questions.filter((q) => !isAnswered(q)).length;
    $("#res-summary").innerHTML = `
      <div class="stat ok"><b>${right}</b><span>Correctes</span></div>
      <div class="stat warn"><b>${partial}</b><span>Partielles</span></div>
      <div class="stat bad"><b>${vals.length - right - partial}</b><span>Incorrectes</span></div>
      <div class="stat"><b>${unanswered}</b><span>Sans réponse</span></div>`;

    const weak = r.domains.filter((d) => d.pct < 0.7);
    $("#res-reco").innerHTML = weak.length
      ? weak.map((d) => `<li><b>${esc(d.name)}</b> : révisez ${esc(domainOf(d.id).topics.join(", "))}.</li>`).join("")
      : "<li>Tous les domaines sont maîtrisés. Continuez à pratiquer sur des projets réels.</li>";
    if (!r.pass) $("#res-reco").insertAdjacentHTML("beforeend", "<li>Une nouvelle tentative est conseillée après une période de révision.</li>");

    $("#certificate-wrap").hidden = !r.pass;
    $("#btn-print-cert").hidden = !r.pass;
    if (r.pass) {
      const valid = new Date(state.submittedAt);
      valid.setFullYear(valid.getFullYear() + 3);
      $("#cert-name").textContent = state.candidate.name;
      $("#cert-score").textContent = `${r.scaled} / 1000`;
      $("#cert-date").textContent = fmtDate(state.submittedAt);
      $("#cert-valid").textContent = fmtDate(valid);
      $("#cert-id").textContent = r.certId;
    }

    detailFilter = "all";
    $$("[data-dfilter]").forEach((c) => c.classList.toggle("active", c.dataset.dfilter === "all"));
    renderDetails();
  }

  function renderDetails() {
    const r = state.result;
    $("#res-details").innerHTML = state.order.map((id, i) => {
      const q = byId[id], s = r.perQ[id];
      const cls = s === 1 ? "right" : s > 0 ? "partial" : "wrong";
      if (detailFilter === "wrong" && s === 1) return "";
      if (detailFilter === "right" && s !== 1) return "";
      const tag = s === 1 ? '<span class="tag ok">Correcte</span>'
        : s > 0 ? `<span class="tag warn">Partielle · ${Math.round(s * 100)} %</span>`
        : isAnswered(q) ? '<span class="tag bad">Incorrecte</span>' : '<span class="tag bad">Sans réponse</span>';
      return `<li class="detail ${cls}">
        <div class="detail-top"><span>Question ${i + 1} · ${esc(domainOf(q.domain).name)}</span>${tag}</div>
        ${q.context ? `<p class="muted small">${esc(q.context)}</p>` : ""}
        <h3>${esc(q.text)}</h3>
        <div class="detail-answers">
          <div><span class="lbl">Votre réponse</span>${fmtGiven(q, state.answers[id])}</div>
          <div><span class="lbl">Réponse attendue</span>${fmtCorrect(q)}</div>
        </div>
        <p class="explain">${esc(q.explanation)}</p>
      </li>`;
    }).join("") || `<li class="muted">Aucune question dans cette catégorie.</li>`;
  }

  function animateNumber(el, to) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = to; return; }
    const start = performance.now(), dur = 1200;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function printWith(cls) {
    if (cls) document.body.classList.add(cls);
    window.print();
    if (cls) document.body.classList.remove(cls);
  }

  async function retake() {
    if (!(await confirmDialog("Nouvelle tentative ?", "Le résultat actuel sera effacé de cet appareil. Pensez à imprimer votre rapport ou certificat avant.", "Recommencer"))) return;
    localStorage.removeItem(SESSION_KEY);
    state = null;
    $("#reg-form").reset();
    renderHome();
    renderSysCheck();
    show("register");
  }

  // ---------- Intégrité ----------
  function updateIntegrityBanner() {
    const b = $("#integrity-banner");
    b.hidden = !state.tabSwitches;
    b.textContent = `Avertissement : ${state.tabSwitches} sortie(s) de la fenêtre d'examen détectée(s). Ces incidents figurent dans votre rapport.`;
  }

  // ---------- Événements ----------
  function bind() {
    document.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]");
      if (go) {
        e.preventDefault();
        if (go.dataset.go === "register") renderSysCheck();
        if (go.dataset.go === "home") renderHome();
        show(go.dataset.go);
        return;
      }
      const nav = e.target.closest(".main-nav a");
      if (nav && document.body.dataset.screen !== "home") {
        e.preventDefault();
        show("home");
        $(nav.getAttribute("href")).scrollIntoView();
        return;
      }
      const goto = e.target.closest("[data-goto]");
      if (goto && state && !state.submitted) {
        if (document.body.dataset.screen === "review") show("exam");
        return goTo(+goto.dataset.goto);
      }
      const font = e.target.closest("[data-font]");
      if (font) {
        prefs.font = Math.max(0, Math.min(FONT_STEPS.length - 1, prefs.font + +font.dataset.font));
        savePrefs(); applyPrefs();
        return;
      }
      if (e.target.closest("[data-contrast]")) { prefs.hc = !prefs.hc; savePrefs(); applyPrefs(); return; }
      const rf = e.target.closest("[data-rfilter]");
      if (rf) {
        reviewFilter = rf.dataset.rfilter;
        $$("[data-rfilter]").forEach((c) => c.classList.toggle("active", c === rf));
        return renderReview();
      }
      const df = e.target.closest("[data-dfilter]");
      if (df) {
        detailFilter = df.dataset.dfilter;
        $$("[data-dfilter]").forEach((c) => c.classList.toggle("active", c === df));
        renderDetails();
      }
    });

    $("#reg-form").addEventListener("submit", handleRegister);
    $("#q-body").addEventListener("change", onOptionChange);
    $("#q-body").addEventListener("click", onBodyClick);
    bindDrag();
    $("#btn-prev").addEventListener("click", () => goTo(state.current - 1));
    $("#btn-next").addEventListener("click", () => goTo(state.current + 1));
    $("#btn-flag").addEventListener("click", toggleFlag);
    $("#btn-review").addEventListener("click", openReview);
    $("#btn-back-exam").addEventListener("click", () => { show("exam"); renderQuestion(true); });
    $("#btn-submit").addEventListener("click", confirmSubmit);
    $("#btn-print-report").addEventListener("click", () => printWith(null));
    $("#btn-print-cert").addEventListener("click", () => printWith("print-cert"));
    $("#btn-retake").addEventListener("click", retake);
    $("#btn-last-result").addEventListener("click", () => { state = loadSession(); showResult(); });

    document.addEventListener("keydown", (e) => {
      if (document.body.dataset.screen !== "exam" || !inExam() || $("#modal").open) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.target.matches("select, input[type=text], input[type=email]")) return;
      const k = e.key.toLowerCase();
      const onInput = e.target.matches("input, button");
      if (k === "n" || (k === "arrowright" && !onInput)) { e.preventDefault(); goTo(state.current + 1); }
      else if (k === "p" || (k === "arrowleft" && !onInput)) { e.preventDefault(); goTo(state.current - 1); }
      else if (k === "f") { e.preventDefault(); toggleFlag(); }
      else if (/^[a-e]$/.test(k)) {
        const input = $$("#q-body .option input")[k.charCodeAt(0) - 97];
        if (input) { e.preventDefault(); input.click(); input.focus(); }
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && inExam() && !unloading) {
        state.tabSwitches += 1;
        save();
        updateIntegrityBanner();
      }
    });
    for (const ev of ["copy", "cut", "paste", "contextmenu"]) {
      document.addEventListener(ev, (e) => {
        if (inExam()) { e.preventDefault(); toast("Cette action est désactivée pendant l'examen."); }
      });
    }
    // Un rechargement n'est pas une sortie de fenêtre : la session est restaurée.
    window.addEventListener("beforeunload", (e) => {
      if (!inExam()) return;
      e.preventDefault();
      unloading = true;
      setTimeout(() => (unloading = false), 1000);
    });
  }

  // ---------- Initialisation ----------
  function init() {
    try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; } catch { /* préférences par défaut */ }
    applyPrefs();
    renderHome();
    bind();
    const s = loadSession();
    if (s && !s.submitted) {
      state = s;
      if (Date.now() >= state.endsAt) {
        submit(true);
      } else {
        enterExam();
        toast("Session restaurée : le chronomètre a continué pendant votre absence.");
      }
    } else {
      show("home");
    }
  }

  init();
})();
