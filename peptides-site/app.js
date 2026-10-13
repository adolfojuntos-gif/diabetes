(function () {
  const P = window.PRODUCTS;
  const byId = Object.fromEntries(P.map((p) => [p.id, p]));
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const img = (p) => `<img src="${p.img}" alt="${esc(p.name)} product photo" width="800" height="800" loading="lazy" />`;
  const kind = (p) => (p.rx ? "Prescription · free online visit" : "No prescription needed");

  /* ---------- Treatments ---------- */
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
      <article class="card">
        <div class="card-img">${img(p)}</div>
        <div class="card-body">
          <p class="card-kind">${kind(p)}</p>
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.tagline)}</p>
          <dl class="card-facts">
            <div><dt>Results</dt><dd>${esc(p.headline)}</dd></div>
            <div><dt>How fast</dt><dd>${esc(p.speed)}</dd></div>
          </dl>
          <p class="card-price">$${p.price} <small>${esc(p.priceNote)}</small></p>
          <div class="card-actions">
            <button class="btn btn-primary" type="button" data-add="${p.id}">${p.rx ? "See if I qualify" : "Add to cart"}</button>
            <button class="btn btn-outline" type="button" data-more="${p.id}">Learn more</button>
          </div>
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
      <div class="m-top">
        <div class="m-img">${img(p)}</div>
        <div>
          <p class="card-kind">${kind(p)} · ${esc(p.form)}</p>
          <h2 id="mTitle">${esc(p.name)}</h2>
          <p class="m-head">${esc(p.headline)}</p>
          <p>${esc(p.description)}</p>
          <div class="m-cta">
            <p class="card-price">$${p.price} <small>${esc(p.priceNote)}</small></p>
            <button class="btn btn-primary" type="button" data-add="${p.id}">${p.rx ? "See if I qualify" : "Add to cart"}</button>
          </div>
        </div>
      </div>
      <div class="m-cols">
        <section><h3>How it works</h3><ul>${p.how.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
        <section><h3>How fast it works</h3><ol class="tl">${p.timeline
          .map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`)
          .join("")}</ol></section>
        <section><h3>How to use it</h3><ol>${p.use.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></section>
      </div>
      <div class="m-safety"><h3>Safety information</h3><p>${esc(p.safety)}</p><p class="footnote">Source: ${esc(p.source)}</p></div>`;
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    $("#modal .modal-x").focus();
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

  /* ---------- Cart ---------- */
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
            (p) => `<div class="ci">${img(p)}<div><b>${esc(p.name)}</b><small>${
              p.rx ? "Needs a provider's approval" : esc(p.form)
            }</small><span>$${p.price}${p.rx ? " a month" : ""}</span></div><button class="text-link" type="button" data-rm="${p.id}">Remove</button></div>`
          )
          .join("")
      : `<p class="empty">Your cart is empty.</p>`;
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
    $("#drawer .modal-x").focus();
  };
  const closeCart = () => ($("#drawer").hidden = true);
  $("#cartBtn").addEventListener("click", openCart);
  $("#drawer").addEventListener("click", (e) => e.target.closest("[data-close-cart]") && closeCart());
  $("#checkoutBtn").addEventListener("click", () => {
    // Connect this to your payment provider and telehealth intake. Prescription items go to the health questions first.
    if (cart.some((id) => byId[id].rx)) {
      closeCart();
      location.hash = "#quiz";
    } else {
      $("#cartNote").textContent = "Checkout is not connected yet. This is a preview of the store.";
    }
  });

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

  /* ---------- 2-minute check ---------- */
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
    const total = goal ? steps.length : 3;
    $("#quizBar").style.width = (i / total) * 100 + "%";
    if (goal && i >= steps.length) {
      const recs = recommend[goal].map((id) => byId[id]);
      $("#quizQ").textContent = "Your best match";
      $("#quizOpts").innerHTML =
        recs
          .map(
            (p) => `<div class="rec">${img(p)}<div><b>${esc(p.name)}</b><small>${esc(p.headline)}</small></div><button class="btn btn-primary" type="button" data-rec="${p.id}">${
              p.rx ? "Start my visit" : "Add to cart"
            }</button></div>`
          )
          .join("") +
        (recs.some((p) => p.rx) ? `<p class="footnote">A licensed provider makes the final decision after reviewing your health history.</p>` : "") +
        `<button class="text-link" type="button" data-restart>Start over</button>`;
      $("#quizBar").style.width = "100%";
      return;
    }
    const s = steps[i];
    $("#quizQ").textContent = s.q;
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
