"""Draw the Telnyx-edition n8n workflows as SVG (from the real JSON) and build the explainer page."""
import json, html, sys

D = "/home/user/diabetes/salon-booking-n8n/telnyx/"
OUT = sys.argv[1]

KIND = {
    "n8n-nodes-base.webhook": ("trigger", "IN"),
    "n8n-nodes-base.scheduleTrigger": ("trigger", "1h"),
    "n8n-nodes-base.code": ("code", "{ }"),
    "n8n-nodes-base.if": ("if", "?"),
    "n8n-nodes-base.noOp": ("code", "→"),
    "@n8n/n8n-nodes-langchain.agent": ("ai", "AI"),
    "@n8n/n8n-nodes-langchain.lmChatAnthropic": ("ai", "C"),
    "@n8n/n8n-nodes-langchain.memoryBufferWindow": ("ai", "M"),
}


def kind(n):
    t = n["type"]
    if t in KIND:
        return KIND[t]
    url = json.dumps(n["parameters"])
    if "telnyx" in url:
        return ("sms", "SMS")
    if t.endswith("Tool"):
        return ("tool", "SQ")
    return ("square", "SQ")


def draw(fname, steps):
    wf = json.load(open(D + fname))
    nodes = [n for n in wf["nodes"] if n["type"] != "n8n-nodes-base.stickyNote"]
    W, H = 150, 58
    xs = [n["position"][0] for n in nodes]; ys = [n["position"][1] for n in nodes]
    minx, miny = min(xs) - 30, min(ys) - 40
    sx = 0.78  # compress horizontally a bit
    pos = {n["name"]: ((n["position"][0] - minx) * sx + 20, n["position"][1] - miny + 20) for n in nodes}
    vw = max(p[0] for p in pos.values()) + W + 30
    vh = max(p[1] for p in pos.values()) + H + 50
    parts = []
    # edges
    for a, kinds in wf["connections"].items():
        for k, outs in kinds.items():
            for oi, lst in enumerate(outs):
                for c in lst:
                    if a not in pos or c["node"] not in pos:
                        continue
                    ax, ay = pos[a]; bx, by = pos[c["node"]]
                    if k == "main":
                        x1, y1 = ax + W, ay + H / 2 + (oi * 14 - 7 if len(outs) > 1 else 0)
                        x2, y2 = bx, by + H / 2
                        mx = (x1 + x2) / 2
                        d = f"M{x1:.0f},{y1:.0f} C{max(mx, x1 + 30):.0f},{y1:.0f} {min(mx, x2 - 30):.0f},{y2:.0f} {x2:.0f},{y2:.0f}"
                        cls = "edge"
                        label = ""
                        if len(outs) > 1:
                            label = "yes" if oi == 0 else "no"
                        parts.append(f'<path class="{cls}" d="{d}" marker-end="url(#arrow)"/>')
                        if label:
                            parts.append(f'<text class="elabel" x="{x1 + 8:.0f}" y="{y1 - 4:.0f}">{label}</text>')
                    else:
                        x1, y1 = ax + W / 2, ay
                        x2, y2 = bx + W / 2, by + H
                        parts.append(f'<path class="edge ai-edge" d="M{x1:.0f},{y1:.0f} C{x1:.0f},{y1 - 40:.0f} {x2:.0f},{y2 + 40:.0f} {x2:.0f},{y2:.0f}"/>')
    # nodes
    for n in nodes:
        x, y = pos[n["name"]]
        k, icon = kind(n)
        name = n["name"]
        words, lines, cur = name.split(), [], ""
        for w in words:
            if len(cur + " " + w) > 17 and cur:
                lines.append(cur); cur = w
            else:
                cur = (cur + " " + w).strip()
        lines.append(cur)
        lines = lines[:2]
        num = steps.get(name)
        parts.append(f'<g class="node {k}"><rect x="{x:.0f}" y="{y:.0f}" width="{W}" height="{H}" rx="10"/>'
                     f'<rect class="icon" x="{x + 8:.0f}" y="{y + 13:.0f}" width="32" height="32" rx="8"/>'
                     f'<text class="icontext" x="{x + 24:.0f}" y="{y + 33:.0f}">{html.escape(icon)}</text>')
        ty = y + H / 2 + (4 if len(lines) == 1 else -3)
        for i, ln in enumerate(lines):
            parts.append(f'<text class="nlabel" x="{x + 48:.0f}" y="{ty + i * 14:.0f}">{html.escape(ln)}</text>')
        if num:
            parts.append(f'<circle class="badge" cx="{x + W - 2:.0f}" cy="{y + 2:.0f}" r="11"/><text class="badgetext" x="{x + W - 2:.0f}" y="{y + 6:.0f}">{num}</text>')
        parts.append("</g>")
    return (f'<svg viewBox="0 0 {vw:.0f} {vh:.0f}" width="{vw:.0f}" height="{vh:.0f}" role="img" aria-label="{html.escape(wf["name"])}">'
            '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>'
            + "".join(parts) + "</svg>")


A_STEPS = {"Text Comes In (Telnyx)": 1, "Settings": 2, "Find Client in Square": 3, "Known Client?": 4,
           "Check Saved Card": 5, "Prepare the AI": 6, "AI Assistant": 7, "check_availability": 8,
           "Tidy the Reply": 9, "Text the Client": 10, "Needs a Person?": 11}
B_STEPS = {"Square Booking Changed": 1, "Every Hour": 2, "Settings": 3, "Check It's From Square": 4,
           "Get Upcoming Bookings": 5, "Who Needs a Reminder?": 6, "Get Client from Square": 7,
           "Write the Texts": 8, "Send Text": 9}
svgA = draw("salon-A-ai-text-assistant-telnyx.json", A_STEPS)
svgB = draw("salon-B-square-texts-telnyx.json", B_STEPS)

A_TEXT = [
    ("Text comes in", "A client texts the salon number. Telnyx passes the message to n8n."),
    ("Settings", "Your salon details: name, phones, stylists, services and how long each stylist takes."),
    ("Find client in Square", "Looks up the phone number to see if this person is already a client."),
    ("Known client?", "Yes: go check for a saved card. No: they're new."),
    ("Check saved card", "Does Square already have a card on file for them?"),
    ("Prepare the AI", "Writes the AI's instructions: today's date, the services, the rules, and whether this client can book by text."),
    ("AI assistant", "Claude reads the text and replies like a receptionist. It remembers the conversation."),
    ("Square tools", "The AI's four buttons: check open times, book, list my bookings, cancel. It only offers times Square says are free."),
    ("Tidy the reply", "Cleans up the answer and notices if a person needs to step in."),
    ("Text the client", "Sends the AI's answer back through Telnyx."),
    ("Needs a person?", "If yes, texts the manager and pauses the AI for that client for 12 hours."),
]
B_TEXT = [
    ("Square booking changed", "Square tells n8n right away when a booking is made, cancelled or marked no-show."),
    ("Every hour", "A clock that checks the calendar once an hour for reminders."),
    ("Settings", "The same salon details as the other workflow."),
    ("Check it's from Square", "Security check, then sorts it: new booking, cancelled, late cancel or no-show."),
    ("Get upcoming bookings", "Pulls the next two days of appointments from Square."),
    ("Who needs a reminder?", "Finds visits 2 days away, 2 hours away, or that just finished."),
    ("Get client from Square", "Gets the client's name and phone number."),
    ("Write the texts", "Writes the right message for the right person: client, stylist or manager."),
    ("Send text", "Sends each message through Telnyx."),
]


def steps_html(items):
    return "".join(f'<li><b>{html.escape(t)}</b><span>{html.escape(d)}</span></li>' for t, d in items)


PAGE = f"""<title>Salon Booking Autopilot</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600&display=swap">
<style>
/* Layout: one column; each workflow drawn like the n8n canvas (scrolls sideways on phones), numbered steps below it. */
:root {{
  --bg: #f7f5f8; --surface: #ffffff; --fg: #231c2b; --muted: #62586d; --line: #e3dde8;
  --accent: #7a3e8f; --accent-soft: #f1e6f5; --canvas: #f2f0f4; --dot: #ddd6e3;
  --c-trigger: #e8743b; --c-code: #6b6378; --c-if: #2f7d6d; --c-square: #2b2b2b; --c-sms: #1f6fd1; --c-ai: #7a3e8f; --c-tool: #8a8195;
  --display: "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif; --body: "Inter", system-ui, sans-serif;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg: #17131b; --surface: #221c28; --fg: #efe9f3; --muted: #a99db5; --line: #3a3043; --accent: #c99be0; --accent-soft: #33253d;
  --canvas: #1d1822; --dot: #2e2636; --c-code: #9a90a8; --c-square: #d9d4de; --c-tool: #8f86a0; color-scheme: dark; }} }}
:root[data-theme="dark"] {{
  --bg: #17131b; --surface: #221c28; --fg: #efe9f3; --muted: #a99db5; --line: #3a3043; --accent: #c99be0; --accent-soft: #33253d;
  --canvas: #1d1822; --dot: #2e2636; --c-code: #9a90a8; --c-square: #d9d4de; --c-tool: #8f86a0; color-scheme: dark; }}
* {{ box-sizing: border-box; }}
body {{ background: var(--bg); color: var(--fg); font-family: var(--body); font-size: 16px; line-height: 1.6;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 40px 64px; }}
.wrap {{ max-width: 1000px; margin: 0 auto; display: grid; gap: 52px; }}
h1, h2, h3 {{ font-family: var(--display); margin: 0; line-height: 1.15; text-wrap: balance; }}
h1 {{ font-size: clamp(32px, 6vw, 50px); font-weight: 800; letter-spacing: -0.02em; }}
h2 {{ font-size: clamp(23px, 3.4vw, 30px); font-weight: 800; }}
p {{ margin: 0; max-width: 68ch; }}
.eyebrow {{ font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }}
.lead {{ font-size: 19px; color: var(--muted); }}
header, section {{ display: grid; gap: 16px; }}
.trio {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }}
.trio > div {{ background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; display: grid; gap: 4px; min-width: 0; }}
.trio b {{ font-family: var(--display); font-size: 18px; }}
.trio span {{ color: var(--muted); font-size: 15px; }}
.canvas {{ overflow-x: auto; background-color: var(--canvas); background-image: radial-gradient(var(--dot) 1px, transparent 1px); background-size: 18px 18px;
  border: 1px solid var(--line); border-radius: 16px; padding: 10px; }}
.canvas svg {{ display: block; max-width: none; }}
.edge {{ fill: none; stroke: var(--muted); stroke-width: 1.6; opacity: .75; }}
.ai-edge {{ stroke: var(--c-ai); stroke-dasharray: 4 4; opacity: .8; }}
.arrowhead {{ fill: var(--muted); }}
.elabel {{ font: 600 10px var(--body); fill: var(--muted); }}
.node rect:first-child {{ fill: var(--surface); stroke: var(--line); stroke-width: 1.5; }}
.node .icon {{ fill: var(--c-code); }}
.trigger .icon {{ fill: var(--c-trigger); }} .if .icon {{ fill: var(--c-if); }} .square .icon {{ fill: var(--c-square); }}
.sms .icon {{ fill: var(--c-sms); }} .ai .icon {{ fill: var(--c-ai); }} .tool .icon {{ fill: var(--c-tool); }}
.trigger rect:first-child {{ stroke: var(--c-trigger); }} .ai rect:first-child {{ stroke: var(--c-ai); }}
.icontext {{ font: 700 11px var(--body); fill: var(--bg); text-anchor: middle; }}
.nlabel {{ font: 500 11.5px var(--body); fill: var(--fg); }}
.badge {{ fill: var(--accent); }} .badgetext {{ font: 700 11px var(--body); fill: var(--bg); text-anchor: middle; }}
.legend {{ display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px; color: var(--muted); }}
.legend i {{ display: inline-block; width: 12px; height: 12px; border-radius: 4px; vertical-align: -1px; margin-right: 6px; }}
.steps {{ list-style: none; margin: 0; padding: 0; counter-reset: s; display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 28px; }}
.steps li {{ counter-increment: s; display: grid; grid-template-columns: 30px 1fr; column-gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); min-width: 0; }}
.steps li::before {{ content: counter(s); grid-row: span 2; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: var(--bg); font: 700 12px var(--body); display: grid; place-items: center; margin-top: 2px; }}
.steps span {{ color: var(--muted); font-size: 15px; }}
.hint {{ font-size: 13px; color: var(--muted); }}
.chat {{ display: grid; gap: 8px; max-width: 420px; }}
.msg {{ padding: 9px 13px; border-radius: 16px; font-size: 14.5px; line-height: 1.4; max-width: 85%; }}
.in {{ justify-self: end; background: var(--accent); color: var(--bg); border-bottom-right-radius: 5px; }}
.out {{ justify-self: start; background: var(--accent-soft); color: var(--fg); border-bottom-left-radius: 5px; }}
@media (max-width: 760px) {{ .trio, .steps {{ grid-template-columns: 1fr; }} }}
</style>

<div class="wrap">
  <header>
    <div class="eyebrow">n8n + Square + Telnyx</div>
    <h1>Salon Booking Autopilot</h1>
    <p class="lead">Two n8n workflows. One answers client texts and books appointments. The other sends confirmations, reminders and staff alerts. Square keeps the calendar and the saved cards.</p>
  </header>

  <section>
    <h2>Who does what</h2>
    <div class="trio">
      <div><b>Square</b><span>The calendar, each stylist's own service times, saved cards, and no-show fees.</span></div>
      <div><b>Telnyx</b><span>The salon's texting number. Sends and receives every text.</span></div>
      <div><b>n8n</b><span>The brain in the middle. Runs the two workflows below, 24/7.</span></div>
    </div>
  </section>

  <section>
    <div class="eyebrow">Workflow A</div>
    <h2>The AI that answers texts</h2>
    <p>This is how it looks inside n8n. Each box is one step, and the arrows show the order. The purple dashed lines connect the AI to its brain, its memory and its Square tools.</p>
    <div class="canvas">{svgA}</div>
    <p class="hint">On a phone, swipe the drawing sideways to see all of it.</p>
    <ol class="steps">{steps_html(A_TEXT)}</ol>
  </section>

  <section>
    <div class="eyebrow">What the client sees</div>
    <h2>A real conversation</h2>
    <div class="chat">
      <div class="msg in">Hi! Anything Friday around 2 for a long haircut?</div>
      <div class="msg out">Hi Jo! Friday I have 1:45 or 2:30 with Maria, or 3:00 with Ana. Which works?</div>
      <div class="msg in">2:30 with Maria</div>
      <div class="msg out">Confirm Fri Nov 20, 2:30 PM with Maria for a Long Haircut?</div>
      <div class="msg in">Yes</div>
      <div class="msg out">You're booked! See you Friday at 2:30.</div>
    </div>
    <p class="hint">New clients get the Square booking link instead, so Square can save their card before the spot is held.</p>
  </section>

  <section>
    <div class="eyebrow">Workflow B</div>
    <h2>Confirmations, reminders and alerts</h2>
    <p>This one has two starting points: Square telling us something changed, and a clock that checks every hour. Both paths meet in the middle and end by sending texts.</p>
    <div class="canvas">{svgB}</div>
    <ol class="steps">{steps_html(B_TEXT)}</ol>
  </section>

  <section>
    <h2>Who gets which text</h2>
    <div class="trio">
      <div><b>Client</b><span>Booking confirmation, reminder 2 days before, reminder 2 hours before, thank-you with a review link.</span></div>
      <div><b>Stylist</b><span>New booking heads-up, and a note when a time opens up from a cancellation.</span></div>
      <div><b>Manager</b><span>Late cancels and no-shows (charge the fee in Square), and any client who asked for a person.</span></div>
    </div>
  </section>

  <section>
    <div class="legend">
      <span><i style="background:var(--c-trigger)"></i>Starts the workflow</span>
      <span><i style="background:var(--c-code)"></i>Settings / logic</span>
      <span><i style="background:var(--c-if)"></i>Yes / no decision</span>
      <span><i style="background:var(--c-square)"></i>Talks to Square</span>
      <span><i style="background:var(--c-sms)"></i>Sends a text (Telnyx)</span>
      <span><i style="background:var(--c-ai)"></i>AI</span>
    </div>
  </section>
</div>
"""
open(OUT, "w").write(PAGE)
print("written", len(PAGE))
