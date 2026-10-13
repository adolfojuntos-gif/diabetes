(function () {
  // A photo that fails to load leaves its tinted frame instead of a broken-image icon.
  document.addEventListener("error", (e) => e.target.tagName === "IMG" && (e.target.style.visibility = "hidden"), true);
  const P = window.PRODUCTS;
  const byId = Object.fromEntries(P.map((p) => [p.id, p]));
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const img = (p) => `<img src="${p.img}" alt="${esc(p.name)} product photo" width="800" height="800" loading="lazy" />`;
  const kind = (p) => (p.rx ? "Prescription" : "No prescription");

  /* ---------- Formulary ---------- */
  let active = "all";
  function renderTabs() {
    $("#tabs").innerHTML = window.CATEGORIES.map(
      (c) => `<button type="button" role="tab" aria-selected="${c.id === active}" data-cat="${c.id}">${c.label}</button>`
    ).join("");
  }
  function renderGrid() {
    const list = P.filter((p) => active === "all" || p.category === active);
    $("#grid").innerHTML = list
      .map(
        (p) => `
      <article class="entry">
        <div class="entry-img">${img(p)}</div>
        <div class="entry-main">
          <p class="entry-kind"><span class="${p.rx ? "tag-rx" : "tag-otc"}">${kind(p)}</span> ${esc(p.form)}</p>
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.tagline)}</p>
          <dl class="entry-facts">
            <div><dt>Results</dt><dd>${esc(p.headline)}</dd></div>
            <div><dt>How fast</dt><dd>${esc(p.speed)}</dd></div>
          </dl>
        </div>
        <div class="entry-side">
          <p class="entry-price">$${p.price}<small>${esc(p.priceNote)}</small></p>
          <button class="btn btn-forest" type="button" data-add="${p.id}">${p.rx ? "See if I qualify" : "Add to bag"}</button>
          <button class="text-btn" type="button" data-more="${p.id}">Full details</button>
        </div>
      </article>`
      )
      .join("");
  }
  function setFilter(cat) {
    active = cat;
    renderTabs();
    renderGrid();
  }
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (b) setFilter(b.dataset.cat);
  });
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) setFilter(f.dataset.filter);
  });
  $("#grid").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) return addToCart(add.dataset.add);
    const more = e.target.closest("[data-more]");
    if (more) openModal(more.dataset.more);
  });

  /* ---------- Product details ---------- */
  let lastFocus = null;
  function openModal(id) {
    const p = byId[id];
    lastFocus = document.activeElement;
    $("#modalBody").innerHTML = `
      <header class="sheet-top">
        <div class="sheet-img">${img(p)}</div>
        <div>
          <p class="entry-kind"><span class="${p.rx ? "tag-rx" : "tag-otc"}">${kind(p)}</span> ${esc(p.form)}</p>
          <h2 id="mTitle">${esc(p.name)}</h2>
          <p class="sheet-head">${esc(p.headline)}</p>
          <p>${esc(p.description)}</p>
          <div class="sheet-cta">
            <p class="entry-price">$${p.price}<small>${esc(p.priceNote)}</small></p>
            <button class="btn btn-forest" type="button" data-add="${p.id}">${p.rx ? "See if I qualify" : "Add to bag"}</button>
          </div>
        </div>
      </header>
      <div class="sheet-cols">
        <section><h3>How it works</h3><ul>${p.how.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
        <section><h3>How fast it works</h3><dl class="sheet-tl">${p.timeline
          .map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`)
          .join("")}</dl></section>
        <section><h3>How to use it</h3><ol>${p.use.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></section>
      </div>
      <div class="sheet-safety"><h3>Safety information</h3><p>${esc(p.safety)}</p><p class="small">Source: ${esc(p.source)}</p></div>`;
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    $("#modal .close").focus();
  }
  function closeModal() {
    if ($("#modal").hidden) return;
    $("#modal").hidden = true;
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }
  $("#modal").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return closeModal();
    const add = e.target.closest("[data-add]");
    if (add) {
      closeModal();
      addToCart(add.dataset.add);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeCart();
    }
  });

  /* ---------- Bag ---------- */
  let cart = [];
  try {
    cart = JSON.parse(localStorage.getItem("arcline_cart") || "[]").filter((id) => byId[id]);
  } catch {}
  const save = () => {
    try {
      localStorage.setItem("arcline_cart", JSON.stringify(cart));
    } catch {}
  };
  function addToCart(id) {
    if (!cart.includes(id)) cart.push(id);
    save();
    renderCart();
    openCart();
  }
  function renderCart() {
    $("#cartCount").textContent = cart.length;
    const items = cart.map((id) => byId[id]);
    $("#cartItems").innerHTML = items.length
      ? items
          .map(
            (p) => `<div class="bag-item">${img(p)}<div><b>${esc(p.name)}</b><small>${
              p.rx ? "Needs a provider's approval" : esc(p.form)
            }</small><span>$${p.price}${p.rx ? " a month" : ""}</span></div><button class="text-btn" type="button" data-rm="${p.id}">Remove</button></div>`
          )
          .join("")
      : `<p class="empty">Your bag is empty.</p>`;
    $("#cartTotal").textContent = "$" + items.reduce((s, p) => s + p.price, 0);
    const hasRx = items.some((p) => p.rx);
    $("#cartNote").textContent = hasRx
      ? "For prescription treatments, you will answer a few health questions next. You only pay for medicine if a provider approves it."
      : "Free shipping on subscriptions. 60-day money-back promise.";
    $("#checkoutBtn").textContent = hasRx ? "Continue to health questions" : "Checkout";
  }
  $("#cartItems").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (!rm) return;
    cart = cart.filter((id) => id !== rm.dataset.rm);
    save();
    renderCart();
  });
  const openCart = () => {
    $("#drawer").hidden = false;
    $("#drawer .close").focus();
  };
  const closeCart = () => ($("#drawer").hidden = true);
  $("#cartBtn").addEventListener("click", openCart);
  $("#drawer").addEventListener("click", (e) => e.target.closest("[data-close-cart]") && closeCart());
  $("#checkoutBtn").addEventListener("click", () => {
    // Connect this to your payment provider and telehealth intake. Prescription items go to the health questions first.
    if (cart.some((id) => byId[id].rx)) {
      closeCart();
      location.hash = "#check";
    } else {
      $("#cartNote").textContent = "Checkout is not connected yet. This is a preview of the store.";
    }
  });

  /* ---------- 100-person arrays ---------- */
  const GOALS = { 5: [86, 91], 10: [69, 84], 15: [51, 71], 20: [32, 57] };
  const dots = (n) => Array.from({ length: 100 }, (_, k) => `<i class="${k < n ? "on" : ""}"></i>`).join("");
  function setGoal(g) {
    const [s, t] = GOALS[g];
    $("#dotsSema").innerHTML = dots(s);
    $("#dotsTirz").innerHTML = dots(t);
    $("#numSema").textContent = s;
    $("#numTirz").textContent = t;
    $("#goalSummary").textContent = `At least ${g}% weight loss: ${s} of 100 people on semaglutide, ${t} of 100 on tirzepatide.`;
    document.querySelectorAll("[data-goal]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.goal === String(g))));
  }
  document.querySelector(".goal-picker").addEventListener("click", (e) => {
    const b = e.target.closest("[data-goal]");
    if (b) setGoal(b.dataset.goal);
  });
  setGoal(15);

  /* ---------- Weight calculator ---------- */
  function calc() {
    const w = Number($("#calcWeight").value);
    const ok = w >= 100 && w <= 700;
    $("#calcSema").textContent = ok ? Math.round(w * 0.149) + " lb" : "–";
    $("#calcTirz").textContent = ok ? Math.round(w * 0.209) + " lb" : "–";
  }
  $("#calcWeight").addEventListener("input", calc);
  calc();

  /* ---------- Referral ---------- */
  $("#refForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const link = location.origin + location.pathname + "?ref=friend";
    const msg = $("#refMsg");
    msg.textContent = "Your link: " + link;
    try {
      navigator.clipboard.writeText(link).then(() => (msg.textContent = "Copied! Your link: " + link), () => {});
    } catch {}
  });

  /* ---------- Two-minute check ---------- */
  const first = {
    q: "What is your main goal?",
    a: [["Lose weight", "weight"], ["Lose belly fat and improve metabolic health", "metabolic"], ["Firmer, smoother skin", "skin"], ["Train harder and recover better", "athlete"]],
  };
  const follow = {
    weight: [
      { q: "How much weight would you like to lose?", a: [["10 to 20 pounds"], ["20 to 50 pounds"], ["More than 50 pounds"]] },
      { q: "Have you used a weekly weight-loss shot before?", a: [["No, never"], ["Yes, semaglutide"], ["Yes, tirzepatide"]] },
    ],
    metabolic: [{ q: "Which sounds most like you?", a: [["My weight is fine, but my belly is not"], ["My energy and blood sugar dip"], ["Both"]] }],
    skin: [{ q: "What bothers you most about your skin?", a: [["Fine lines and firmness"], ["Lines from smiling or frowning"], ["Rough texture or damage"]] }],
    athlete: [{ q: "Do you compete in a drug-tested sport?", a: [["Yes"], ["No"]] }],
  };
  const recommend = { weight: ["tirzepatide", "semaglutide"], metabolic: ["tesamorelin", "semaglutide"], skin: ["ghk-cu", "matrixyl"], athlete: ["collagen"] };
  let steps = [first],
    i = 0,
    goal = null;
  function renderQuiz() {
    if (goal && i >= steps.length) {
      const recs = recommend[goal].map((id) => byId[id]);
      $("#quizQ").textContent = "Your best match";
      $("#quizStep").textContent = "";
      $("#quizOpts").innerHTML =
        recs
          .map(
            (p) => `<div class="rec">${img(p)}<div><b>${esc(p.name)}</b><small>${esc(p.headline)}</small></div><button class="btn btn-brass" type="button" data-rec="${p.id}">${
              p.rx ? "Start my visit" : "Add to bag"
            }</button></div>`
          )
          .join("") +
        (recs.some((p) => p.rx) ? `<p class="small">A licensed provider makes the final decision after reviewing your health history.</p>` : "") +
        `<button class="text-btn" type="button" data-restart>Start over</button>`;
      return;
    }
    const s = steps[i];
    $("#quizQ").textContent = s.q;
    $("#quizStep").textContent = goal ? `Question ${i + 1} of ${steps.length}` : "Question 1";
    $("#quizOpts").innerHTML = s.a.map(([t, v]) => `<button class="opt" type="button" data-v="${v || ""}">${t}</button>`).join("");
  }
  $("#quizOpts").addEventListener("click", (e) => {
    const r = e.target.closest("[data-rec]");
    if (r) return addToCart(r.dataset.rec);
    if (e.target.closest("[data-restart]")) {
      steps = [first];
      i = 0;
      goal = null;
      return renderQuiz();
    }
    const o = e.target.closest(".opt");
    if (!o) return;
    if (i === 0) {
      goal = o.dataset.v;
      steps = [first, ...follow[goal]];
    }
    i++;
    renderQuiz();
  });

  renderTabs();
  renderGrid();
  renderCart();
  renderQuiz();
})();
