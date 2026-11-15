"""Generates the salon n8n workflow JSON files."""
import json, os, sys, uuid

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

SQ_CRED = {"httpHeaderAuth": {"id": "REPLACE_SQUARE_CRED", "name": "Square API (Bearer token)"}}
TW_CRED = {"twilioApi": {"id": "REPLACE_TWILIO_CRED", "name": "Twilio"}}
GS_CRED = {"googleSheetsOAuth2Api": {"id": "REPLACE_SHEETS_CRED", "name": "Google Sheets"}}
CFG = "$('Config').first().json"


def nid():
    return str(uuid.uuid4())


class WF:
    def __init__(self, name):
        self.name, self.nodes, self.conn = name, [], {}

    def add(self, name, type_, ver, pos, params, **extra):
        n = {"parameters": params, "id": nid(), "name": name, "type": type_,
             "typeVersion": ver, "position": pos}
        n.update(extra)
        self.nodes.append(n)
        return name

    def link(self, a, b, out=0, kind="main"):
        outs = self.conn.setdefault(a, {}).setdefault(kind, [])
        while len(outs) <= out:
            outs.append([])
        outs[out].append({"node": b, "type": kind, "index": 0})

    def note(self, text, pos, w=520, h=300, color=7):
        self.add(f"Note {len(self.nodes)}", "n8n-nodes-base.stickyNote", 1, pos,
                 {"content": text, "width": w, "height": h, "color": color})

    def save(self, fname):
        names = {n["name"] for n in self.nodes}
        for a, kinds in self.conn.items():
            assert a in names, a
            for outs in kinds.values():
                for lst in outs:
                    for c in lst:
                        assert c["node"] in names, c["node"]
        wf = {"name": self.name, "nodes": self.nodes, "connections": self.conn,
              "active": False, "settings": {"executionOrder": "v1"}, "pinData": {},
              "meta": {"templateCredsSetupCompleted": False}}
        with open(os.path.join(OUT, fname), "w") as f:
            json.dump(wf, f, indent=2, ensure_ascii=False)


# ---------- node helpers ----------
def sq_headers():
    return {"parameters": [
        {"name": "Square-Version", "value": f"={{{{ {CFG}.squareVersion }}}}"},
        {"name": "Content-Type", "value": "application/json"}]}


def square(wf, name, pos, method, path_expr, body_expr=None, query=None, tool_desc=None, on_error=None):
    """path_expr is a JS expression (no braces) giving the path after the base URL."""
    p = {"method": method,
         "url": f"={{{{ {CFG}.squareBaseUrl + {path_expr} }}}}",
         "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
         "sendHeaders": True, "headerParameters": sq_headers()}
    if query:
        p["sendQuery"] = True
        p["queryParameters"] = {"parameters": [{"name": k, "value": v} for k, v in query]}
    if body_expr:
        p["sendBody"] = True
        p["specifyBody"] = "json"
        p["jsonBody"] = "={{ JSON.stringify(" + body_expr + ") }}"
    p["options"] = {}
    extra = {"credentials": SQ_CRED}
    if on_error:
        extra["onError"] = on_error
    if tool_desc:
        p["toolDescription"] = tool_desc
        return wf.add(name, "n8n-nodes-base.httpRequestTool", 4.2, pos, p, **extra)
    return wf.add(name, "n8n-nodes-base.httpRequest", 4.2, pos, p, **extra)


def code(wf, name, pos, js, per_item=False):
    p = {"jsCode": js}
    if per_item:
        p["mode"] = "runOnceForEachItem"
    return wf.add(name, "n8n-nodes-base.code", 2, pos, p)


def sms(wf, name, pos, to_expr, msg_expr):
    return wf.add(name, "n8n-nodes-base.twilio", 1, pos,
                  {"from": f"={{{{ {CFG}.salonPhone }}}}", "to": to_expr, "message": msg_expr, "options": {}},
                  credentials=TW_CRED, onError="continueRegularOutput")


def webhook(wf, name, pos, method, path, respond="responseNode", options=None):
    return wf.add(name, "n8n-nodes-base.webhook", 2, pos,
                  {"httpMethod": method, "path": path, "responseMode": respond, "options": options or {}},
                  webhookId=nid())


def respond(wf, name, pos, body, ctype="text/html; charset=utf-8"):
    return wf.add(name, "n8n-nodes-base.respondToWebhook", 1.1, pos,
                  {"respondWith": "text", "responseBody": body,
                   "options": {"responseHeaders": {"entries": [{"name": "Content-Type", "value": ctype}]}}})


def if_node(wf, name, pos, left, op_type, operation, right=None):
    cond = {"id": nid(), "leftValue": left, "operator": {"type": op_type, "operation": operation}}
    if right is None:
        cond["rightValue"] = ""
        cond["operator"]["singleValue"] = True
    else:
        cond["rightValue"] = right
    return wf.add(name, "n8n-nodes-base.if", 2, pos, {
        "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                       "conditions": [cond], "combinator": "and"},
        "options": {}})


def sheet(wf, name, pos, tab):
    return wf.add(name, "n8n-nodes-base.googleSheets", 4.5, pos, {
        "operation": "append",
        "documentId": {"__rl": True, "value": f"={{{{ {CFG}.googleSheetId }}}}", "mode": "id"},
        "sheetName": {"__rl": True, "value": tab, "mode": "name"},
        "columns": {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [], "schema": []},
        "options": {}}, credentials=GS_CRED, onError="continueRegularOutput")


# ---------- shared settings (each workflow gets a copy) ----------
SETTINGS_BASE = r"""
  // ---- Your business ----
  salonName: 'Your Salon Name',
  timezone: 'America/New_York',          // your salon's time zone
  salonPhone: '+15551234567',            // your Twilio texting number
  managerPhone: '+15557654321',          // who approves no-show / late-cancel fees

  // ---- Square ----
  // Sandbox for testing: https://connect.squareupsandbox.com   Live: https://connect.squareup.com
  squareBaseUrl: 'https://connect.squareupsandbox.com',
  squareVersion: '2025-01-23',           // Square API version header
  locationId: 'YOUR_SQUARE_LOCATION_ID',

  // ---- n8n ----
  n8nBaseUrl: 'https://YOUR-N8N-DOMAIN.com',   // the public address of your n8n
  linkSecret: 'CHANGE-ME-TO-A-LONG-RANDOM-PASSWORD', // same value in every workflow
"""

POLICY = r"""
  // ---- Cancellation policy ----
  lateCancelHours: 24,
  lateCancelFeeCents: 2500,   // $25.00
  noShowFeeCents: 4000,       // $40.00
  currency: 'USD',
  policyText: 'Free to cancel or reschedule up to 24 hours before. Cancelling with less than 24 hours notice costs $25. Missing the appointment without notice costs $40. Both are charged to the card you save with us.',
"""

STYLISTS = r"""
  // ---- Stylists (team_member_id comes from Square > Staff) ----
  stylists: [
    { name: 'Maria', team_member_id: 'TEAM_MEMBER_ID_MARIA', phone: '+15550000001' },
    { name: 'Ana',   team_member_id: 'TEAM_MEMBER_ID_ANA',   phone: '+15550000002' },
  ],
"""

SERVICES = r"""
  // ---- Services: EACH STYLIST HAS THEIR OWN TIME ----
  // In Square, make one service variation per speed (e.g. "Long Haircut 45 min" for Maria,
  // "Long Haircut 90 min" for Ana), same name and price for the client, and paste the IDs here.
  services: [
    { name: 'Long Haircut', price: '$65', options: [
      { stylist: 'Maria', minutes: 45, team_member_id: 'TEAM_MEMBER_ID_MARIA', service_variation_id: 'VARIATION_ID_LONG_CUT_45' },
      { stylist: 'Ana',   minutes: 90, team_member_id: 'TEAM_MEMBER_ID_ANA',   service_variation_id: 'VARIATION_ID_LONG_CUT_90' },
    ]},
    { name: 'Short Haircut', price: '$40', options: [
      { stylist: 'Maria', minutes: 30, team_member_id: 'TEAM_MEMBER_ID_MARIA', service_variation_id: 'VARIATION_ID_SHORT_CUT_30' },
      { stylist: 'Ana',   minutes: 45, team_member_id: 'TEAM_MEMBER_ID_ANA',   service_variation_id: 'VARIATION_ID_SHORT_CUT_45' },
    ]},
  ],
"""


def settings(*extra, tail="return [{ json: { ...SETTINGS, request: $input.first().json } }];"):
    return ("// ============ EDIT YOUR SETTINGS HERE ============\nconst SETTINGS = {"
            + SETTINGS_BASE + "".join(extra) + "};\n// =================================================\n\n" + tail)


PAGE_FN = r"""
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const page = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f4f1;color:#222;margin:0;padding:24px}main{max-width:440px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{font-size:22px;margin:0 0 8px}p{line-height:1.5}.policy{background:#faf6ef;border-radius:10px;padding:12px;font-size:14px}button{width:100%;padding:14px;border:0;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;margin-top:10px}.go{background:#222;color:#fff}.alt{background:#e9e6e1;color:#222}input[type=text]{width:100%;box-sizing:border-box;padding:12px;border:1px solid #ccc;border-radius:10px;font-size:16px;margin:6px 0}label{display:block;margin:12px 0;font-size:15px}#msg{color:#b00020}</style></head><body><main>${inner}</main></body></html>`;
"""

# =====================================================================
# 1. AI TEXT BOOKING ASSISTANT
# =====================================================================
wf = WF("1 - AI Text Booking Assistant (Square)")
wf.note("## 1. AI Text Booking Assistant\n\n**In simple words:** a customer texts the salon. The AI reads the text, looks at the real calendar in Square, offers open times, and books the one they pick.\n\n**Card rule:** the AI can only book if the customer has a card saved. If not, it texts them a secure link to save one first.\n\n**Edit:** open the **Config** node and fill in your salon details, stylists and services.",
        [-60, -380], w=640, h=300, color=4)
webhook(wf, "Customer Texts In", [0, 0], "POST", "salon-sms")
respond(wf, "Tell Twilio OK", [220, 0], "<Response></Response>", "text/xml")
code(wf, "Config", [440, 0], settings(POLICY, STYLISTS, SERVICES, tail=
"""const sms = $('Customer Texts In').first().json.body || {};
return [{ json: { ...SETTINGS, phone: sms.From, message: String(sms.Body || '').trim() } }];"""))
square(wf, "Find Customer by Phone", [660, 0], "POST", "'/v2/customers/search'",
       "{ limit: 1, query: { filter: { phone_number: { exact: $json.phone } } } }")
if_node(wf, "Already a Customer?", [880, 0], "={{ ($json.customers || []).length }}", "number", "gt", 0)
square(wf, "Create New Customer", [1100, 160], "POST", "'/v2/customers'",
       f"{{ idempotency_key: 'sms-' + {CFG}.phone, phone_number: {CFG}.phone, note: 'Created by the text booking assistant' }}")
code(wf, "Customer Info", [1320, 0], r"""const input = $input.first().json;
const c = input.customer || (input.customers || [])[0];
if (!c) throw new Error('Could not find or create the customer in Square: ' + JSON.stringify(input));
return [{ json: { customerId: c.id, customerName: [c.given_name, c.family_name].filter(Boolean).join(' ') } }];""")
square(wf, "Check Saved Card", [1540, 0], "GET", "'/v2/cards'",
       query=[("customer_id", "={{ $json.customerId }}")])
code(wf, "Prepare for AI", [1760, 0], r"""const cfg = $('Config').first().json;
const cust = $('Customer Info').first().json;
const cards = ($input.first().json.cards || []).filter((c) => c.enabled !== false);
const crypto = require('crypto');

// Secure link for saving a card (signed so nobody can change the customer id)
const sig = crypto.createHmac('sha256', cfg.linkSecret).update(cust.customerId).digest('hex').slice(0, 32);
const cardLink = `${cfg.n8nBaseUrl}/webhook/save-card?c=${encodeURIComponent(cust.customerId)}&s=${sig}`;

// Current time + UTC offset in the salon's time zone
const now = new Date();
const nowText = now.toLocaleString('en-US', { timeZone: cfg.timezone, dateStyle: 'full', timeStyle: 'short' });
const off = (now.toLocaleString('en-US', { timeZone: cfg.timezone, timeZoneName: 'longOffset' }).match(/GMT([+-]\d{2}:\d{2})/) || [])[1] || '+00:00';

const menu = cfg.services.map((s) => `- ${s.name} (${s.price}):\n` + s.options.map((o) =>
  `    ${o.stylist}: ${o.minutes} min -> team_member_id=${o.team_member_id}, service_variation_id=${o.service_variation_id}`).join('\n')).join('\n');

const hasCard = cards.length > 0;
const systemPrompt = `You are the friendly text-message booking assistant for ${cfg.salonName}.
Keep replies short (1-3 sentences), warm, plain text. No markdown.

TIME: Right now it is ${nowText} (${cfg.timezone}, UTC offset ${off}). Always use this time zone.
When you send times to tools, use ISO 8601 with the offset, like 2026-11-20T14:00:00${off}.

CUSTOMER: ${cust.customerName || 'name not known yet'}, phone ${cfg.phone}.
CARD ON FILE: ${hasCard ? 'YES (card ending ' + (cards[0].last_4 || '????') + ')' : 'NO'}.

SERVICES AND STYLISTS. Each stylist has their own time for each service.
Always use the service_variation_id that belongs to the chosen stylist:
${menu}

HOW TO BOOK
1. Find out: which service, which stylist (or "anyone"), and which day/time.
2. Use check_availability. Search a whole day: from 00:00 that day to 00:00 the next day (Square needs at least 24 hours). If that start is in the past, start from now.
   If the customer said "anyone", check each stylist who offers the service.
3. Offer at most 3 real times from the results. NEVER invent a time.
4. Repeat the details and get a clear YES, e.g. "Confirm Tue Nov 20 at 2:00 PM with Maria for a Long Haircut?"
5. CARD RULE: every booking needs a card on file. If CARD ON FILE is NO, do not book. Send this secure link and ask them to reply YES after saving the card: ${cardLink}
   Never ask for card numbers by text. If someone sends card numbers, tell them to delete the message and use the link.
6. After a clear YES (and card on file is YES), call book_appointment with the exact start_at, team_member_id, service_variation_id and service_variation_version from the check_availability results.
7. If booking fails because the time was taken, check availability again and offer the next open times.

POLICY (mention it once to new customers, and before any cancellation): ${cfg.policyText}

CANCEL OR RESCHEDULE: use list_my_bookings, confirm which booking, then cancel_booking.
If the appointment is less than ${cfg.lateCancelHours} hours away, remind them about the late-cancel fee before cancelling.
To reschedule: book the new time first, then cancel the old one.

If you are unsure, the customer is upset, or they ask something you cannot handle, tell them a team member will text them back, and end your reply with [HANDOFF].`;

return [{ json: { ...cust, hasCard, systemPrompt, message: cfg.message, phone: cfg.phone } }];""")

wf.add("AI Booking Assistant", "@n8n/n8n-nodes-langchain.agent", 1.7, [2000, 0], {
    "promptType": "define", "text": "={{ $json.message }}",
    "options": {"systemMessage": "={{ $json.systemPrompt }}", "maxIterations": 12}},
    onError="continueRegularOutput")
wf.add("Claude", "@n8n/n8n-nodes-langchain.lmChatAnthropic", 1.3, [1880, 260], {
    "model": {"__rl": True, "mode": "id", "value": "claude-haiku-5-5"}, "options": {"temperature": 0.3}},
    credentials={"anthropicApi": {"id": "REPLACE_ANTHROPIC_CRED", "name": "Anthropic"}})
wf.add("Conversation Memory", "@n8n/n8n-nodes-langchain.memoryBufferWindow", 1.3, [2020, 260], {
    "sessionIdType": "customKey", "sessionKey": f"={{{{ {CFG}.phone }}}}", "contextWindowLength": 20})

PREP = "$('Prepare for AI').first().json"
square(wf, "check_availability", [2160, 260], "POST", "'/v2/bookings/availability/search'",
       "{ query: { filter: { location_id: " + CFG + ".locationId,"
       " start_at_range: { start_at: $fromAI('range_start', 'Start of the search window, ISO 8601 with offset', 'string'),"
       " end_at: $fromAI('range_end', 'End of the search window, ISO 8601 with offset. Must be at least 24 hours after range_start', 'string') },"
       " segment_filters: [{ service_variation_id: $fromAI('service_variation_id', 'service_variation_id for the chosen stylist and service', 'string'),"
       " team_member_id_filter: { any: [ $fromAI('team_member_id', 'team_member_id of the stylist', 'string') ] } }] } } }",
       tool_desc="Find open appointment times in Square for ONE stylist and ONE service. Returns availabilities with start_at, team_member_id, service_variation_id and service_variation_version.")
square(wf, "book_appointment", [2300, 260], "POST",
       f"({PREP}.hasCard ? '/v2/bookings' : '/v2/BLOCKED-no-card-on-file-send-the-card-link')",
       "{ idempotency_key: " + PREP + ".customerId + '-' + $fromAI('booking_key', 'Copy the exact start_at value here again. Used to stop double bookings.', 'string'),"
       " booking: { location_id: " + CFG + ".locationId, customer_id: " + PREP + ".customerId,"
       " start_at: $fromAI('start_at', 'Exact start_at from check_availability', 'string'),"
       " customer_note: 'Booked by the text assistant',"
       " appointment_segments: [{ team_member_id: $fromAI('team_member_id', 'team_member_id from check_availability', 'string'),"
       " service_variation_id: $fromAI('service_variation_id', 'service_variation_id from check_availability', 'string'),"
       " service_variation_version: $fromAI('service_variation_version', 'service_variation_version number from check_availability', 'number') }] } }",
       tool_desc="Create the booking in Square. Only call after the customer clearly said YES. Only works when the customer has a card on file.")
square(wf, "list_my_bookings", [2440, 260], "GET", "'/v2/bookings'",
       query=[("customer_id", f"={{{{ {PREP}.customerId }}}}"),
              ("location_id", f"={{{{ {CFG}.locationId }}}}"),
              ("start_at_min", "={{ new Date().toISOString() }}"),
              ("limit", "20")],
       tool_desc="List this customer's upcoming bookings (id, version, start_at, status, stylist).")
square(wf, "cancel_booking", [2580, 260], "POST",
       "'/v2/bookings/' + $fromAI('booking_id', 'id of the booking to cancel, from list_my_bookings', 'string') + '/cancel'",
       "{ booking_version: $fromAI('booking_version', 'version number of the booking, from list_my_bookings', 'number') }",
       tool_desc="Cancel one of this customer's bookings. Only call after they confirmed which one.")

code(wf, "Clean Up Reply", [2340, 0], r"""const out = String($json.output || '').trim();
const handoff = out.includes('[HANDOFF]');
const reply = out.replace(/\[HANDOFF\]/g, '').trim() ||
  'Sorry, something went wrong on our side. A team member will text you shortly.';
return [{ json: { reply, handoff: handoff || !out } }];""")
sms(wf, "Text Reply to Customer", [2560, -80], f"={{{{ {CFG}.phone }}}}", "={{ $json.reply }}")
if_node(wf, "Needs a Human?", [2560, 100], "={{ $json.handoff }}", "boolean", "true")
sms(wf, "Text the Manager", [2780, 100], f"={{{{ {CFG}.managerPhone }}}}",
    f"=Customer {{{{ {CFG}.phone }}}} needs a person to text them back. Their last message: \"{{{{ {CFG}.message }}}}\"")

for a, b in [("Customer Texts In", "Tell Twilio OK"), ("Tell Twilio OK", "Config"),
             ("Config", "Find Customer by Phone"), ("Find Customer by Phone", "Already a Customer?"),
             ("Create New Customer", "Customer Info"), ("Customer Info", "Check Saved Card"),
             ("Check Saved Card", "Prepare for AI"), ("Prepare for AI", "AI Booking Assistant"),
             ("AI Booking Assistant", "Clean Up Reply"), ("Clean Up Reply", "Text Reply to Customer"),
             ("Clean Up Reply", "Needs a Human?")]:
    wf.link(a, b)
wf.link("Already a Customer?", "Customer Info", 0)
wf.link("Already a Customer?", "Create New Customer", 1)
wf.link("Needs a Human?", "Text the Manager", 0)
wf.link("Claude", "AI Booking Assistant", kind="ai_languageModel")
wf.link("Conversation Memory", "AI Booking Assistant", kind="ai_memory")
for t in ["check_availability", "book_appointment", "list_my_bookings", "cancel_booking"]:
    wf.link(t, "AI Booking Assistant", kind="ai_tool")
wf.save("1-ai-text-booking-assistant.json")

# =====================================================================
# 2. SAVE CARD PAGE
# =====================================================================
wf = WF("2 - Secure Save-Card Page (Square)")
wf.note("## 2. Secure Save-Card Page\n\n**In simple words:** this is the safe web page the customer opens from the text link. They type their card into **Square's own secure box** (the salon never sees the card number), tick **I agree to the policy**, and tap Save.\n\nSquare keeps the card. We keep a record of **when they agreed** in a Google Sheet (proof if someone disputes a fee).",
        [-60, -400], w=640, h=320, color=4)
webhook(wf, "Customer Opens Link", [0, 0], "GET", "save-card")
webhook(wf, "Customer Taps Save", [0, 200], "POST", "save-card-submit")
code(wf, "Config", [220, 100], settings(POLICY, r"""
  // ---- Card page ----
  squareApplicationId: 'YOUR_SQUARE_APPLICATION_ID',   // Square Developer > your app > Credentials
  googleSheetId: 'YOUR_GOOGLE_SHEET_ID',               // sheet with tabs "Consent" and "Fees"
"""))
if_node(wf, "Page or Save?", [440, 100], "={{ !!($json.request.body && $json.request.body.token) }}", "boolean", "true")
code(wf, "Build Card Page", [660, 0], PAGE_FN + r"""
const cfg = $('Config').first().json;
const q = cfg.request.query || {};
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', cfg.linkSecret).update(String(q.c || '')).digest('hex').slice(0, 32);
const valid = !!(q.c && q.s) && String(q.s).length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(String(q.s)), Buffer.from(expected));

if (!valid) {
  return [{ json: { html: page('Link not valid', '<h1>This link is not valid</h1><p>Please text us and we will send you a new one.</p>') } }];
}

const sdk = cfg.squareBaseUrl.includes('sandbox') ? 'https://sandbox.web.squarecdn.com/v1/square.js' : 'https://web.squarecdn.com/v1/square.js';
const data = JSON.stringify({ appId: cfg.squareApplicationId, locationId: cfg.locationId, c: q.c, s: q.s,
  postUrl: cfg.n8nBaseUrl + '/webhook/save-card-submit' }).replace(/</g, '\\u003c');

const html = page('Save your card', `
<h1>${esc(cfg.salonName)}</h1>
<p>Save a card to hold your appointment. <b>You are not charged now.</b></p>
<div class="policy"><b>Our policy:</b> ${esc(cfg.policyText)}</div>
<label>Name on card<input type="text" id="name" autocomplete="cc-name"></label>
<div id="card"></div>
<label><input type="checkbox" id="agree"> I agree to the cancellation policy above. Fees may be charged to this card.</label>
<button class="go" id="btn">Save card</button>
<p id="msg"></p>
<p style="font-size:12px;color:#777">Your card is stored securely by Square. ${esc(cfg.salonName)} never sees your full card number.</p>
<script src="${sdk}"></script>
<script>
const D = ${data};
(async () => {
  const msg = document.getElementById('msg'), btn = document.getElementById('btn');
  let payments, card;
  try {
    payments = Square.payments(D.appId, D.locationId);
    card = await payments.card();
    await card.attach('#card');
  } catch (e) { msg.textContent = 'The card form could not load. Please try again later.'; return; }
  btn.onclick = async () => {
    if (!document.getElementById('agree').checked) { msg.textContent = 'Please tick the box to agree to the policy.'; return; }
    btn.disabled = true; msg.textContent = 'Saving...';
    try {
      const name = document.getElementById('name').value;
      const r = await card.tokenize();
      if (r.status !== 'OK') throw new Error('Please check your card details.');
      let verificationToken;
      try { const v = await payments.verifyBuyer(r.token, { intent: 'STORE', billingContact: { givenName: name } }); verificationToken = v && v.token; } catch (e) {}
      const res = await fetch(D.postUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ c: D.c, s: D.s, token: r.token, verificationToken, consent: true, name }) });
      const out = await res.json();
      if (!out.ok) throw new Error(out.message || 'We could not save your card.');
      document.querySelector('main').innerHTML = '<h1>Card saved</h1><p>Go back to your texts and reply <b>YES</b> to confirm your booking.</p>';
    } catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
})();
</script>`);
return [{ json: { html } }];""")
respond(wf, "Show Card Page", [880, 0], "={{ $json.html }}")
code(wf, "Check Submission", [660, 200], r"""const cfg = $('Config').first().json;
const b = cfg.request.body || {};
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', cfg.linkSecret).update(String(b.c || '')).digest('hex').slice(0, 32);
const valid = !!(b.c && b.s && b.token) && String(b.s).length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(String(b.s)), Buffer.from(expected));
return [{ json: { ok: valid && b.consent === true, c: b.c, token: b.token, verificationToken: b.verificationToken || null, name: b.name || '' } }];""")
if_node(wf, "Valid and Agreed?", [880, 200], "={{ $json.ok }}", "boolean", "true")
square(wf, "Save Card in Square", [1100, 120], "POST", "'/v2/cards'",
       "{ idempotency_key: 'card-' + $json.c.slice(0, 20) + '-' + $json.token.slice(-16), source_id: $json.token,"
       " verification_token: $json.verificationToken || undefined,"
       " card: { customer_id: $json.c, cardholder_name: $json.name || undefined } }",
       on_error="continueErrorOutput")
square(wf, "Get Customer", [1320, 120], "GET", "'/v2/customers/' + $('Check Submission').first().json.c",
       on_error="continueRegularOutput")
code(wf, "Consent Record", [1540, 120], r"""const cfg = $('Config').first().json;
const card = $('Save Card in Square').first().json.card || {};
const c = $json.customer || {};
const h = cfg.request.headers || {};
return [{ json: {
  timestamp: new Date().toISOString(),
  customer_id: card.customer_id || '',
  customer_name: [c.given_name, c.family_name].filter(Boolean).join(' '),
  phone: c.phone_number || '',
  card: (card.card_brand || '') + ' ending ' + (card.last_4 || ''),
  agreed_policy: cfg.policyText,
  ip_address: h['x-forwarded-for'] || h['x-real-ip'] || '',
  device: h['user-agent'] || '',
} }];""")
sheet(wf, "Log Consent in Sheet", [1760, 120], "Consent")
sms(wf, "Text Customer: Card Saved", [1980, 120], "={{ $('Consent Record').first().json.phone }}",
    "=Thanks! Your card is saved with " + f"{{{{ {CFG}.salonName }}}}" + ". Reply YES to confirm your booking.")
respond(wf, "Reply: Saved", [2200, 120], "{\"ok\": true}", "application/json")
respond(wf, "Reply: Card Error", [1320, 320],
        "={{ JSON.stringify({ ok: false, message: 'Your card could not be saved. Please check the details or try another card.' }) }}",
        "application/json")
respond(wf, "Reply: Not Allowed", [1100, 320],
        "={{ JSON.stringify({ ok: false, message: 'Please tick the box to agree to the policy, or ask us for a new link.' }) }}",
        "application/json")
for a, b in [("Customer Opens Link", "Config"), ("Customer Taps Save", "Config"), ("Config", "Page or Save?"),
             ("Build Card Page", "Show Card Page"), ("Check Submission", "Valid and Agreed?"),
             ("Get Customer", "Consent Record"), ("Consent Record", "Log Consent in Sheet"),
             ("Log Consent in Sheet", "Text Customer: Card Saved"), ("Text Customer: Card Saved", "Reply: Saved")]:
    wf.link(a, b)
wf.link("Page or Save?", "Check Submission", 0)
wf.link("Page or Save?", "Build Card Page", 1)
wf.link("Valid and Agreed?", "Save Card in Square", 0)
wf.link("Valid and Agreed?", "Reply: Not Allowed", 1)
wf.link("Save Card in Square", "Get Customer", 0)
wf.link("Save Card in Square", "Reply: Card Error", 1)
wf.save("2-save-card-page.json")

# =====================================================================
# 3. REMINDERS
# =====================================================================
wf = WF("3 - Reminders and Follow-ups")
wf.note("## 3. Reminders and Follow-ups\n\n**In simple words:** every hour, n8n looks at the Square calendar and texts:\n- **2 days before:** \"See you Friday. Free to change until Thursday 2 PM.\"\n- **2 hours before:** \"See you soon!\"\n- **After the visit:** \"Thanks! Leave us a review?\"\n\nTip: turn OFF Square's own text reminders so clients don't get two.",
        [-60, -380], w=600, h=300, color=4)
wf.add("Every Hour", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0],
       {"rule": {"interval": [{"field": "hours", "hoursInterval": 1}]}})
code(wf, "Config", [220, 0], settings(POLICY, r"""
  reviewLink: 'https://g.page/r/YOUR-GOOGLE-REVIEW-LINK',
"""))
square(wf, "Get Upcoming Bookings", [440, 0], "GET", "'/v2/bookings'",
       query=[("location_id", f"={{{{ {CFG}.locationId }}}}"),
              ("start_at_min", "={{ new Date(Date.now() - 4 * 3600e3).toISOString() }}"),
              ("start_at_max", "={{ new Date(Date.now() + 50 * 3600e3).toISOString() }}"),
              ("limit", "100")])
code(wf, "Pick Who Gets a Text", [660, 0], r"""// Runs every hour, so each window is exactly 1 hour wide: everyone gets each text once.
const H = 3600e3, now = Date.now();
const out = [];
for (const b of $input.first().json.bookings || []) {
  if (b.status !== 'ACCEPTED' || !b.customer_id) continue;
  const diff = new Date(b.start_at).getTime() - now;
  let kind = null;
  if (diff >= 48 * H && diff < 49 * H) kind = 'two_days';
  else if (diff >= 2 * H && diff < 3 * H) kind = 'two_hours';
  else if (diff <= -2 * H && diff > -3 * H) kind = 'follow_up';
  if (kind) out.push({ json: { kind, bookingId: b.id, customerId: b.customer_id, startAt: b.start_at } });
}
return out;""")
square(wf, "Get Customer", [880, 0], "GET", "'/v2/customers/' + $json.customerId", on_error="continueRegularOutput")
code(wf, "Write the Text", [1100, 0], r"""const cfg = $('Config').first().json;
const r = $('Pick Who Gets a Text').item.json;
const c = $json.customer || {};
const first = c.given_name || 'there';
const fmt = (d, o) => new Date(d).toLocaleString('en-US', { timeZone: cfg.timezone, ...o });
const when = fmt(r.startAt, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const freeUntil = fmt(new Date(r.startAt).getTime() - cfg.lateCancelHours * 3600e3, { weekday: 'long', hour: 'numeric', minute: '2-digit' });
const texts = {
  two_days: `Hi ${first}! See you ${when} at ${cfg.salonName}. Need to change it? Reply to this text. Changes are free until ${freeUntil}.`,
  two_hours: `Hi ${first}, see you soon! Your appointment at ${cfg.salonName} is at ${fmt(r.startAt, { hour: 'numeric', minute: '2-digit' })}.`,
  follow_up: `Thanks for visiting ${cfg.salonName}, ${first}! If you loved your hair, a quick review means a lot: ${cfg.reviewLink}`,
};
return { json: { to: c.phone_number || '', body: texts[r.kind] } };""", per_item=True)
if_node(wf, "Has a Phone Number?", [1320, 0], "={{ $json.to }}", "string", "notEmpty")
sms(wf, "Send Text", [1540, 0], "={{ $json.to }}", "={{ $json.body }}")
for a, b in [("Every Hour", "Config"), ("Config", "Get Upcoming Bookings"),
             ("Get Upcoming Bookings", "Pick Who Gets a Text"), ("Pick Who Gets a Text", "Get Customer"),
             ("Get Customer", "Write the Text"), ("Write the Text", "Has a Phone Number?")]:
    wf.link(a, b)
wf.link("Has a Phone Number?", "Send Text", 0)
wf.save("3-reminders.json")

# =====================================================================
# 4. SQUARE EVENTS (new booking, cancellations, no-shows)
# =====================================================================
wf = WF("4 - Square Booking Events (new, cancel, no-show)")
wf.note("## 4. Square Booking Events\n\n**In simple words:** Square tells n8n every time a booking changes.\n- **New booking:** text the stylist.\n- **Cancelled on time:** text the stylist, no fee.\n- **Late cancel or no-show:** text the manager a link to **Charge** or **Waive** the fee. Nothing is charged automatically.\n\nNo-show = the stylist marks the appointment **No-show** in the Square app.",
        [-60, -400], w=620, h=320, color=4)
webhook(wf, "Square Sends an Update", [0, 0], "POST", "square-events", respond="onReceived",
        options={"rawBody": True})
code(wf, "Config", [220, 0], settings(POLICY, STYLISTS, r"""
  // From Square Developer > Webhooks > your subscription
  squareWebhookSignatureKey: 'YOUR_SQUARE_WEBHOOK_SIGNATURE_KEY',
  squareWebhookUrl: 'https://YOUR-N8N-DOMAIN.com/webhook/square-events', // must match Square exactly
""", tail="return [{ json: { ...SETTINGS, request: $input.first().json }, binary: $input.first().binary }];"))
code(wf, "Check Message Is From Square", [440, 0], r"""const cfg = $('Config').first().json;
const crypto = require('crypto');

// 1) Security: make sure this message really came from Square
let raw;
try { raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8'); }
catch (e) { raw = JSON.stringify(cfg.request.body); }
const got = String((cfg.request.headers || {})['x-square-hmacsha256-signature'] || '');
const expected = crypto.createHmac('sha256', cfg.squareWebhookSignatureKey).update(cfg.squareWebhookUrl + raw).digest('base64');
if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
  throw new Error('Signature check failed - this did not come from Square (or the signature key / URL in Config is wrong).');
}

// 2) Sort the update into: new booking, cancelled on time, late cancel, no-show
const event = JSON.parse(raw);
const b = event && event.data && event.data.object && event.data.object.booking;
if (!b) return [];
let kind = null;
if (event.type === 'booking.created') kind = 'new_booking';
else if (event.type === 'booking.updated') {
  if (b.status === 'NO_SHOW') kind = 'noshow';
  else if (b.status === 'CANCELLED_BY_CUSTOMER') {
    const hoursBefore = (new Date(b.start_at) - new Date(b.updated_at || event.created_at)) / 3600e3;
    kind = hoursBefore < cfg.lateCancelHours ? 'late' : 'cancelled';
  }
}
if (!kind) return [];

const tm = ((b.appointment_segments || [])[0] || {}).team_member_id;
const stylist = cfg.stylists.find((s) => s.team_member_id === tm) || {};
const when = new Date(b.start_at).toLocaleString('en-US', { timeZone: cfg.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
return [{ json: { kind, bookingId: b.id, customerId: b.customer_id, when, stylistName: stylist.name || 'a stylist', stylistPhone: stylist.phone || '' } }];""")
square(wf, "Get Customer", [660, 0], "GET", "'/v2/customers/' + $json.customerId", on_error="continueRegularOutput")


def rule(val, label):
    return {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
                           "conditions": [{"id": nid(), "leftValue": "={{ $('Check Message Is From Square').item.json.kind }}",
                                           "rightValue": val, "operator": {"type": "string", "operation": "equals"}}],
                           "combinator": "and"}, "renameOutput": True, "outputKey": label}


wf.add("What Happened?", "n8n-nodes-base.switch", 3.2, [880, 0], {"rules": {"values": [
    rule("new_booking", "New booking"), rule("cancelled", "Cancelled on time"),
    rule("late", "Late cancel"), rule("noshow", "No-show")]}, "options": {}})
EV = "$('Check Message Is From Square').item.json"
NAME = "{{ [$json.customer?.given_name, $json.customer?.family_name].filter(Boolean).join(' ') || 'A client' }}"
sms(wf, "Text Stylist: New Booking", [1120, -140], f"={{{{ {EV}.stylistPhone }}}}",
    f"=New booking: {NAME} on {{{{ {EV}.when }}}}.")
sms(wf, "Text Stylist: Cancelled", [1120, 20], f"={{{{ {EV}.stylistPhone }}}}",
    f"=Cancelled: {NAME} on {{{{ {EV}.when }}}}. That time is open again.")
code(wf, "Make Approve Link", [1120, 200], r"""const cfg = $('Config').first().json;
const ev = $('Check Message Is From Square').item.json;
const c = $json.customer || {};
const name = [c.given_name, c.family_name].filter(Boolean).join(' ') || 'A client';
const crypto = require('crypto');
const s = crypto.createHmac('sha256', cfg.linkSecret).update(ev.bookingId + '|' + ev.kind).digest('hex').slice(0, 32);
const link = `${cfg.n8nBaseUrl}/webhook/fee-decision?b=${encodeURIComponent(ev.bookingId)}&k=${ev.kind}&s=${s}`;
const fee = ev.kind === 'noshow' ? cfg.noShowFeeCents : cfg.lateCancelFeeCents;
const label = ev.kind === 'noshow' ? 'NO-SHOW' : 'LATE CANCEL';
return { json: { body: `${label}: ${name}, ${ev.when} with ${ev.stylistName}. Charge the $${(fee / 100).toFixed(2)} fee or waive it? Open: ${link}` } };""", per_item=True)
sms(wf, "Text Manager: Charge or Waive?", [1340, 200], f"={{{{ {CFG}.managerPhone }}}}", "={{ $json.body }}")
for a, b in [("Square Sends an Update", "Config"), ("Config", "Check Message Is From Square"),
             ("Check Message Is From Square", "Get Customer"), ("Get Customer", "What Happened?"),
             ("Make Approve Link", "Text Manager: Charge or Waive?")]:
    wf.link(a, b)
wf.link("What Happened?", "Text Stylist: New Booking", 0)
wf.link("What Happened?", "Text Stylist: Cancelled", 1)
wf.link("What Happened?", "Make Approve Link", 2)
wf.link("What Happened?", "Make Approve Link", 3)
wf.save("4-square-booking-events.json")

# =====================================================================
# 5. FEE DECISION (manager approves or waives)
# =====================================================================
wf = WF("5 - Manager Approves or Waives Fee")
wf.note("## 5. Manager Approves or Waives the Fee\n\n**In simple words:** the manager taps the link from the text. A page shows who, when and how much, with two buttons: **Charge** or **Waive**.\n- **Charge:** Square charges the saved card, the client gets a receipt text.\n- **Waive:** nothing is charged.\nEither way it is written in the **Fees** tab of the Google Sheet.\n\nThe link only opens a page. Money moves only when the manager presses **Charge**.",
        [-60, -440], w=640, h=340, color=4)
webhook(wf, "Manager Opens Link", [0, 0], "GET", "fee-decision")
webhook(wf, "Manager Presses a Button", [0, 200], "POST", "fee-decision-submit")
code(wf, "Config", [220, 100], settings(POLICY, r"""
  googleSheetId: 'YOUR_GOOGLE_SHEET_ID',   // sheet with tabs "Consent" and "Fees"
"""))
code(wf, "Check the Link", [440, 100], r"""const cfg = $('Config').first().json;
const r = cfg.request;
const p = { ...(r.query || {}), ...(r.body || {}) };
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', cfg.linkSecret).update(String(p.b) + '|' + String(p.k)).digest('hex').slice(0, 32);
const valid = !!(p.b && p.s) && ['late', 'noshow'].includes(p.k) && String(p.s).length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(String(p.s)), Buffer.from(expected));
return [{ json: {
  valid, b: p.b, k: p.k, s: p.s,
  action: (r.body && r.body.action) || '',
  reason: (r.body && r.body.reason) || '',
  feeCents: p.k === 'noshow' ? cfg.noShowFeeCents : cfg.lateCancelFeeCents,
  label: p.k === 'noshow' ? 'No-show' : 'Late cancellation',
} }];""")
if_node(wf, "Link OK?", [660, 100], "={{ $json.valid }}", "boolean", "true")
respond(wf, "Show: Bad Link", [880, 300], "<h1>This link is not valid.</h1>")
if_node(wf, "Button Pressed?", [880, 60], "={{ $json.action }}", "string", "notEmpty")
CHK = "$('Check the Link').first().json"
square(wf, "Get Booking", [1100, -100], "GET", f"'/v2/bookings/' + {CHK}.b")
square(wf, "Get Customer", [1320, -100], "GET", "'/v2/customers/' + $json.booking.customer_id", on_error="continueRegularOutput")
code(wf, "Build Decision Page", [1540, -100], PAGE_FN + r"""
const cfg = $('Config').first().json;
const v = $('Check the Link').first().json;
const bk = $('Get Booking').first().json.booking || {};
const c = $json.customer || {};
const name = [c.given_name, c.family_name].filter(Boolean).join(' ') || 'Client';
const when = new Date(bk.start_at).toLocaleString('en-US', { timeZone: cfg.timezone, dateStyle: 'medium', timeStyle: 'short' });
const amount = '$' + (v.feeCents / 100).toFixed(2);
const html = page('Fee decision', `
<h1>${esc(v.label)}</h1>
<p><b>${esc(name)}</b><br>${esc(when)}<br>Fee: <b>${esc(amount)}</b></p>
<form method="POST" action="${esc(cfg.n8nBaseUrl)}/webhook/fee-decision-submit">
  <input type="hidden" name="b" value="${esc(v.b)}"><input type="hidden" name="k" value="${esc(v.k)}"><input type="hidden" name="s" value="${esc(v.s)}">
  <label>Reason (if waiving)<input type="text" name="reason" placeholder="e.g. family emergency"></label>
  <button class="go" name="action" value="charge" onclick="return confirm('Charge ${esc(amount)} to the saved card?')">Charge ${esc(amount)}</button>
  <button class="alt" name="action" value="waive">Waive fee</button>
</form>`);
return [{ json: { html } }];""")
respond(wf, "Show Decision Page", [1760, -100], "={{ $json.html }}")
if_node(wf, "Charge?", [1100, 120], "={{ $json.action }}", "string", "equals", "charge")
square(wf, "Get Booking (charge)", [1320, 60], "GET", f"'/v2/bookings/' + {CHK}.b")
square(wf, "Find Saved Card", [1540, 60], "GET", "'/v2/cards'",
       query=[("customer_id", "={{ $json.booking.customer_id }}")])
code(wf, "Pick Card", [1760, 60], r"""const cards = ($input.first().json.cards || []).filter((c) => c.enabled !== false);
cards.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
const bk = $('Get Booking (charge)').first().json.booking || {};
return [{ json: { cardId: cards.length ? cards[0].id : '', customerId: bk.customer_id } }];""")
if_node(wf, "Has a Card?", [1980, 60], "={{ $json.cardId }}", "string", "notEmpty")
respond(wf, "Show: No Card", [2200, 220], "<h1>No saved card for this client.</h1><p>Nothing was charged.</p>")
square(wf, "Charge the Card", [2200, 0], "POST", "'/v2/payments'",
       "{ idempotency_key: 'fee-' + " + CHK + ".b + '-' + " + CHK + ".k, source_id: $json.cardId,"
       " customer_id: $json.customerId, location_id: " + CFG + ".locationId,"
       " amount_money: { amount: " + CHK + ".feeCents, currency: " + CFG + ".currency }, autocomplete: true,"
       " note: " + CHK + ".label + ' fee', reference_id: String(" + CHK + ".b).slice(0, 40) }",
       on_error="continueErrorOutput")
respond(wf, "Show: Charge Failed", [2420, 220],
        "<h1>The charge did not go through.</h1><p>The card may be declined or expired. Nothing was charged.</p>")
square(wf, "Get Customer (receipt)", [2420, 0], "GET", "'/v2/customers/' + $('Pick Card').first().json.customerId",
       on_error="continueRegularOutput")
sms(wf, "Text Client: Receipt", [2640, 0], "={{ $json.customer?.phone_number || '' }}",
    f"=Hi, a {{{{ {CHK}.label.toLowerCase() }}}} fee of ${{{{ ({CHK}.feeCents / 100).toFixed(2) }}}} was charged by {{{{ {CFG}.salonName }}}} under our policy. Questions? Just reply to this text.")
code(wf, "Fee Record", [2860, 120], r"""const v = $('Check the Link').first().json;
const charged = v.action === 'charge' && $('Charge the Card').isExecuted;
const pay = charged ? ($('Charge the Card').first().json.payment || {}) : {};
return [{ json: {
  timestamp: new Date().toISOString(),
  booking_id: v.b,
  type: v.label,
  decision: charged ? 'charged' : 'waived',
  amount: charged ? (v.feeCents / 100).toFixed(2) : '0.00',
  payment_id: pay.id || '',
  reason: v.reason,
} }];""")
sheet(wf, "Log in Fees Sheet", [3080, 120], "Fees")
respond(wf, "Show: Done", [3300, 120],
        "={{ $('Fee Record').first().json.decision === 'charged' ? '<h1>Charged.</h1><p>The client got a receipt text.</p>' : '<h1>Fee waived.</h1><p>Nothing was charged.</p>' }}")
for a, b in [("Manager Opens Link", "Config"), ("Manager Presses a Button", "Config"),
             ("Config", "Check the Link"), ("Check the Link", "Link OK?"),
             ("Get Booking", "Get Customer"), ("Get Customer", "Build Decision Page"),
             ("Build Decision Page", "Show Decision Page"), ("Get Booking (charge)", "Find Saved Card"),
             ("Find Saved Card", "Pick Card"), ("Pick Card", "Has a Card?"),
             ("Get Customer (receipt)", "Text Client: Receipt"), ("Text Client: Receipt", "Fee Record"),
             ("Fee Record", "Log in Fees Sheet"), ("Log in Fees Sheet", "Show: Done")]:
    wf.link(a, b)
wf.link("Link OK?", "Button Pressed?", 0)
wf.link("Link OK?", "Show: Bad Link", 1)
wf.link("Button Pressed?", "Charge?", 0)
wf.link("Button Pressed?", "Get Booking", 1)
wf.link("Charge?", "Get Booking (charge)", 0)
wf.link("Charge?", "Fee Record", 1)
wf.link("Has a Card?", "Charge the Card", 0)
wf.link("Has a Card?", "Show: No Card", 1)
wf.link("Charge the Card", "Get Customer (receipt)", 0)
wf.link("Charge the Card", "Show: Charge Failed", 1)
wf.save("5-fee-approve-or-waive.json")
print("ok")
