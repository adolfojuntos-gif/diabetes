(function () {
  const P = window.PRODUCTS;
  const byId = Object.fromEntries(P.map((p) => [p.id, p]));
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /* ---------- Product art: drawn per form so every product has an image ---------- */
  function art(p) {
    const c = p.color;
    const label = `<text x="60" y="${p.category === "athlete" ? 112 : 118}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="9" fill="#0b1530" letter-spacing=".5">${esc(p.name.split(" ")[0].toUpperCase())}</text>`;
    let body;
    if (p.form.includes("weekly")) {
      // injection pen
      body = `
        <rect x="48" y="20" width="24" height="150" rx="12" fill="#fff" stroke="#d5dbe8"/>
        <rect x="48" y="86" width="24" height="50" fill="${c}"/>
        <rect x="52" y="60" width="16" height="18" rx="3" fill="${c}" opacity=".25"/>
        <rect x="54" y="170" width="12" height="16" rx="3" fill="#9aa6bf"/>
        <circle cx="60" cy="28" r="6" fill="${c}"/>
        <text x="60" y="114" text-anchor="middle" transform="rotate(-90 60 114)" font-family="Inter" font-weight="800" font-size="${p.name.length > 10 ? 6 : 7.5}" fill="#fff" letter-spacing=".6">${esc(p.name.toUpperCase())}</text>`;
    } else if (p.form.includes("Daily injection")) {
      // vial
      body = `
        <rect x="44" y="30" width="32" height="14" rx="3" fill="${c}"/>
        <rect x="48" y="44" width="24" height="10" fill="#cfd6e4"/>
        <rect x="36" y="54" width="48" height="120" rx="10" fill="#eef3fb" stroke="#d5dbe8"/>
        <rect x="36" y="130" width="48" height="44" rx="10" fill="${c}" opacity=".18"/>
        <rect x="40" y="96" width="40" height="34" rx="3" fill="#fff"/>${label}`;
    } else if (p.form.includes("Topical")) {
      // dropper bottle
      body = `
        <rect x="52" y="14" width="16" height="30" rx="8" fill="#1c2237"/>
        <rect x="48" y="44" width="24" height="14" rx="2" fill="#c9a76a"/>
        <rect x="32" y="58" width="56" height="118" rx="14" fill="${c}"/>
        <rect x="32" y="58" width="56" height="118" rx="14" fill="url(#gl)"/>
        <rect x="38" y="100" width="44" height="34" rx="3" fill="#fff"/>${label}`;
    } else {
      // powder pouch
      body = `
        <path d="M24 40 L96 40 L102 176 Q60 186 18 176 Z" fill="${c}"/>
        <rect x="24" y="34" width="72" height="10" rx="2" fill="#0b1530" opacity=".85"/>
        <rect x="32" y="90" width="56" height="34" rx="3" fill="#fff"/>${label}`;
    }
    return `<svg viewBox="0 0 120 200" class="art" aria-hidden="true">
      <defs><linearGradient id="gl" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <ellipse cx="60" cy="190" rx="38" ry="6" fill="#0b1530" opacity=".12"/>${body}</svg>`;
  }

  /* ---------- Hero ---------- */
  $("#heroProducts").innerHTML = ["tirzepatide", "semaglutide", "ghk-cu"]
    .map((id, i) => `<div class="hp hp${i}">${art(byId[id])}</div>`)
    .join("");

  /* ---------- Shop ---------- */
  let active = "all";
  function renderTabs() {
    $("#tabs").innerHTML = window.CATEGORIES.map(
      (c) => `<button role="tab" aria-selected="${c.id === active}" data-cat="${c.id}">${c.label}</button>`
    ).join("");
  }
  function renderGrid() {
    const list = P.filter((p) => active === "all" || p.category === active);
    $("#grid").innerHTML = list
      .map(
        (p) => `
      <article class="card" data-id="${p.id}" tabindex="0" style="--c:${p.color}">
        <div class="card-art">${art(p)}<span class="badge">${esc(p.badge)}</span></div>
        <div class="card-body">
          <p class="card-kind">${p.rx ? "Prescription · online visit" : "No prescription needed"}</p>
          <h3>${esc(p.name)}</h3>
          <p class="card-tag">${esc(p.tagline)}</p>
          <p class="card-headline">${esc(p.headline)}</p>
          <div class="card-foot">
            <span class="card-price">$${p.price}<small>${esc(p.priceNote)}</small></span>
            <button class="btn btn-primary btn-sm" data-add="${p.id}">${p.rx ? "Start visit" : "Add to cart"}</button>
          </div>
          <button class="link" data-more="${p.id}">How it works & how to use →</button>
        </div>
      </article>`
      )
      .join("");
  }
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    active = b.dataset.cat;
    renderTabs();
    renderGrid();
  });
  $("#grid").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) return addToCart(add.dataset.add);
    const card = e.target.closest(".card");
    if (card) openModal(card.dataset.id);
  });
  $("#grid").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("card")) openModal(e.target.dataset.id);
  });

  /* ---------- Product modal ---------- */
  function openModal(id) {
    const p = byId[id];
    $("#modalBody").innerHTML = `
      <div class="m-top" style="--c:${p.color}">
        <div class="m-art">${art(p)}</div>
        <div>
          <p class="card-kind">${p.rx ? "Prescription · online visit" : "No prescription needed"} · ${esc(p.form)}</p>
          <h2 id="mTitle">${esc(p.name)}</h2>
          <p class="m-head">${esc(p.headline)}</p>
          <p>${esc(p.description)}</p>
          <div class="m-cta">
            <span class="card-price">$${p.price}<small>${esc(p.priceNote)}</small></span>
            <button class="btn btn-primary" data-add="${p.id}">${p.rx ? "See if I qualify" : "Add to cart"}</button>
          </div>
        </div>
      </div>
      <div class="m-cols">
        <section><h4>How it works</h4><ul>${p.how.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
        <section><h4>How fast it works</h4><ol class="tl">${p.timeline
          .map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`)
          .join("")}</ol></section>
        <section><h4>How to use</h4><ol class="use">${p.use.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></section>
      </div>
      <div class="m-safety"><h4>Important safety information</h4><p>${esc(p.safety)}</p><p class="fine">Evidence: ${esc(p.source)}</p></div>`;
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    $("#modal").hidden = true;
    document.body.style.overflow = "";
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
            (p) => `<div class="ci"><div class="ci-art">${art(p)}</div><div><b>${esc(p.name)}</b><small>${
              p.rx ? "Requires provider approval" : esc(p.form)
            }</small><span>$${p.price}${p.rx ? "/mo" : ""}</span></div><button class="link" data-rm="${p.id}">Remove</button></div>`
          )
          .join("")
      : `<p class="empty">Your cart is empty.</p>`;
    $("#cartTotal").textContent = "$" + items.reduce((s, p) => s + p.price, 0);
    const hasRx = items.some((p) => p.rx);
    $("#cartNote").textContent = hasRx
      ? "Prescription items: you'll complete a short health assessment. You're only charged for medication if a provider approves it."
      : "Free shipping on subscriptions. 60-day empty-bottle guarantee.";
    $("#checkoutBtn").textContent = hasRx ? "Continue to assessment" : "Checkout";
  }
  $("#cartItems").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (!rm) return;
    cart = cart.filter((id) => id !== rm.dataset.rm);
    save();
    renderCart();
  });
  const openCart = () => ($("#drawer").hidden = false);
  const closeCart = () => ($("#drawer").hidden = true);
  $("#cartBtn").addEventListener("click", openCart);
  $("#drawer").addEventListener("click", (e) => e.target.closest("[data-close-cart]") && closeCart());
  $("#checkoutBtn").addEventListener("click", () => {
    closeCart();
    // Wire this to Stripe Checkout / your telehealth intake. Rx items go through the assessment first.
    if (cart.some((id) => byId[id].rx)) location.hash = "#quiz";
    else alert("Checkout is not connected yet. Hook this button to your payment provider.");
  });

  /* ---------- Results chart ---------- */
  const bars = [
    { label: "Tirzepatide 15 mg", v: 20.9, c: "#a98bff" },
    { label: "Semaglutide 2.4 mg", v: 14.9, c: "#6f9bff" },
    { label: "Placebo", v: 3.1, c: "#5b6788" },
  ];
  $("#chart").innerHTML = bars
    .map(
      (b) => `<div class="bar"><span class="bar-label">${b.label}</span><div class="bar-track"><div class="bar-fill" style="--w:${
        (b.v / 22) * 100
      }%;--c:${b.c}"></div></div><strong>−${b.v}%</strong></div>`
    )
    .join("");
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.3 });
  io.observe($("#chart"));

  /* ---------- Member stories ----------
     Fill this array with REAL, consented member photos and quotes (put images in /img).
     Until it has entries, the page shows empty frames so nothing invented goes live. */
  const STORIES = [
    // { name: "Jamie R.", product: "Tirzepatide", months: 7, lost: "38 lb", before: "img/jamie-before.jpg", after: "img/jamie-after.jpg", quote: "…" },
  ];
  const slots = STORIES.length ? STORIES : [{ product: "Weight loss" }, { product: "Skin repair" }, { product: "Athletes" }];
  $("#stories").innerHTML = slots
    .map((s) =>
      s.before
        ? `<figure class="story"><div class="ba"><img src="${esc(s.before)}" alt="${esc(s.name)} before"/><img src="${esc(
            s.after
          )}" alt="${esc(s.name)} after"/></div><blockquote>“${esc(s.quote)}”</blockquote><figcaption><b>${esc(s.name)}</b> · ${esc(
            s.product
          )} · ${esc(s.lost)} in ${s.months} months</figcaption></figure>`
        : `<figure class="story story-empty"><div class="ba"><div>Before</div><div>After</div></div><figcaption>${esc(
            s.product
          )} · verified member photo goes here</figcaption></figure>`
    )
    .join("");

  /* ---------- Quiz ---------- */
  const Q = [
    { q: "What's your main goal?", a: [["Lose weight", "weight"], ["Lose belly fat / metabolic health", "metabolic"], ["Firmer, smoother skin", "skin"], ["Train harder, recover better", "athlete"]] },
  ];
  const follow = {
    weight: [
      { q: "How much would you like to lose?", a: [["10–20 lb"], ["20–50 lb"], ["50+ lb"]] },
      { q: "Have you tried a GLP-1 before?", a: [["No, never"], ["Yes, semaglutide"], ["Yes, tirzepatide"]] },
    ],
    metabolic: [{ q: "Which sounds most like you?", a: [["Weight is fine, belly isn't"], ["Energy & blood sugar dips"], ["Both"]] }],
    skin: [{ q: "Top skin concern?", a: [["Fine lines & firmness"], ["Expression lines"], ["Texture & repair"]] }],
    athlete: [{ q: "Do you compete in drug-tested sport?", a: [["Yes"], ["No"]] }],
  };
  const recommend = { weight: ["tirzepatide", "semaglutide"], metabolic: ["tesamorelin", "semaglutide"], skin: ["ghk-cu", "matrixyl"], athlete: ["collagen"] };
  let steps = Q.slice(),
    i = 0,
    goal = null;
  function renderQuiz() {
    const total = goal ? steps.length + 1 : 3;
    $("#quizBar").style.width = (i / total) * 100 + "%";
    if (i >= steps.length && goal) {
      const recs = recommend[goal].map((id) => byId[id]);
      $("#quizQ").textContent = "Your match";
      $("#quizOpts").innerHTML =
        recs
          .map(
            (p) => `<button class="rec" data-rec="${p.id}" style="--c:${p.color}"><span class="rec-art">${art(p)}</span><span><b>${esc(
              p.name
            )}</b><small>${esc(p.headline)}</small></span><span class="btn btn-primary btn-sm">${p.rx ? "Start visit" : "Add"}</span></button>`
          )
          .join("") +
        (recs.some((p) => p.rx)
          ? `<p class="fine">A licensed provider makes the final call after reviewing your full health history.</p>`
          : "") +
        `<button class="link" data-restart>Start over</button>`;
      $("#quizBar").style.width = "100%";
      return;
    }
    const s = steps[i];
    $("#quizQ").textContent = s.q;
    $("#quizOpts").innerHTML = s.a.map(([t, v]) => `<button class="opt" data-v="${v || ""}">${t}</button>`).join("");
  }
  $("#quizOpts").addEventListener("click", (e) => {
    const r = e.target.closest("[data-rec]");
    if (r) return addToCart(r.dataset.rec);
    if (e.target.closest("[data-restart]")) {
      steps = Q.slice();
      i = 0;
      goal = null;
      return renderQuiz();
    }
    const o = e.target.closest(".opt");
    if (!o) return;
    if (i === 0) {
      goal = o.dataset.v;
      steps = Q.concat(follow[goal]);
    }
    i++;
    renderQuiz();
  });

  renderTabs();
  renderGrid();
  renderCart();
  renderQuiz();
})();
