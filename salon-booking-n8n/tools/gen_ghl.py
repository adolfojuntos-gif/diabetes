"""GoHighLevel edition of the salon bridge. Reuses helpers + code blocks from gen.py."""
import json, os, sys, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_OUT = sys.argv[1]
os.makedirs(REAL_OUT, exist_ok=True)

# Load helpers (everything before workflow 1) from gen.py
src = open(os.path.join(HERE, "gen.py")).read()
head = src.split("# =====================================================================\n# 1. AI TEXT")[0]
sys.argv = [sys.argv[0], tempfile.mkdtemp()]
exec(head)
TW = sys.argv[1]
subprocess.run([sys.executable, os.path.join(HERE, "gen.py"), TW], check=True, capture_output=True)
OUT = REAL_OUT


def js_of(fname, node):
    wf_ = json.load(open(os.path.join(TW, fname)))
    return next(n for n in wf_["nodes"] if n["name"] == node)["parameters"]["jsCode"]


GHL_CRED = {"httpHeaderAuth": {"id": "REPLACE_GHL_CRED", "name": "GoHighLevel API (Bearer token)"}}
GHL_SETTINGS = r"""
  // ---- GoHighLevel ----
  ghlLocationId: 'YOUR_GHL_SUB_ACCOUNT_LOCATION_ID',   // Sub-account > Settings > Business Profile
"""


def ghl(wf, name, pos, method, path_expr, body_expr=None, version="2021-07-28", on_error="continueRegularOutput"):
    p = {"method": method,
         "url": "={{ 'https://services.leadconnectorhq.com' + " + path_expr + " }}",
         "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
         "sendHeaders": True, "headerParameters": {"parameters": [
             {"name": "Version", "value": version}, {"name": "Accept", "value": "application/json"}]}}
    if body_expr:
        p.update({"sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify(" + body_expr + ") }}"})
    p["options"] = {}
    return wf.add(name, "n8n-nodes-base.httpRequest", 4.2, pos, p, credentials=GHL_CRED, onError=on_error)


def ghl_sms(wf, name, pos, contact_expr, msg_expr):
    return ghl(wf, name, pos, "POST", "'/conversations/messages'",
               "{ type: 'SMS', contactId: " + contact_expr + ", message: " + msg_expr + " }", version="2021-04-15")


def ghl_upsert(wf, name, pos, src_node):
    """src_node outputs {phone, firstName, lastName, fields:{key:value}}"""
    S = f"$('{src_node}').item.json"
    return ghl(wf, name, pos, "POST", "'/contacts/upsert'",
               "{ locationId: " + CFG + ".ghlLocationId, phone: " + S + ".phone,"
               " firstName: " + S + ".firstName || undefined, lastName: " + S + ".lastName || undefined,"
               " customFields: Object.entries(" + S + ".fields || {}).map(([key, field_value]) => ({ key, field_value: String(field_value) })) }")


def ghl_tags(wf, name, pos, tags_expr, contact_expr="$json.contact.id"):
    return ghl(wf, name, pos, "POST", f"'/contacts/' + {contact_expr} + '/tags'", "{ tags: " + tags_expr + " }")


# =====================================================================
# 0. ONE-CLICK GHL SETUP
# =====================================================================
wf = WF("GHL 0 - One-Click Setup (fields + tags)")
wf.note("## GHL 0. One-Click Setup\n\n**In simple words:** run this once per salon. It creates every contact field and tag the other workflows use, so you don't have to type them in by hand.\n\nFill in **Config**, then press **Test workflow**. Fields or tags that already exist just show an error and are skipped.",
        [-60, -340], w=600, h=260, color=4)
wf.add("Run Once", "n8n-nodes-base.manualTrigger", 1, [0, 0], {})
code(wf, "Config", [220, 0], "const SETTINGS = {" + GHL_SETTINGS + r"""
  fields: [
    ['square_customer_id', 'TEXT'], ['square_booking_id', 'TEXT'], ['appt_time', 'TEXT'],
    ['appt_stylist', 'TEXT'], ['appt_service', 'TEXT'], ['booked_via', 'TEXT'],
    ['card_link', 'TEXT'], ['fee_link', 'TEXT'], ['fee_amount', 'TEXT'],
    ['no_show_count', 'NUMERICAL'], ['policy_agreed_at', 'TEXT'],
  ],
  tags: ['needs-human', 'human-takeover', 'needs-card', 'card-on-file', 'sq-booked', 'sq-remind-48h',
    'sq-remind-2h', 'sq-completed', 'sq-cancelled', 'sq-late-cancel', 'sq-no-show', 'fee-charged',
    'fee-waived', 'prepay-required', 'waitlist'],
};
return [{ json: SETTINGS }];""")
code(wf, "List Fields", [440, -100], "return $json.fields.map(([name, dataType]) => ({ json: { name, dataType } }));", )
code(wf, "List Tags", [440, 100], "return $json.tags.map((name) => ({ json: { name } }));")
ghl(wf, "Create Field", [660, -100], "POST", f"'/locations/' + {CFG}.ghlLocationId + '/customFields'",
    "{ name: $json.name, dataType: $json.dataType, model: 'contact' }")
ghl(wf, "Create Tag", [660, 100], "POST", f"'/locations/' + {CFG}.ghlLocationId + '/tags'", "{ name: $json.name }")
for a, b in [("Run Once", "Config"), ("Config", "List Fields"), ("Config", "List Tags"),
             ("List Fields", "Create Field"), ("List Tags", "Create Tag")]:
    wf.link(a, b)
wf.save("ghl-0-one-click-setup.json")

# =====================================================================
# 1. AI ASSISTANT (GHL edition)
# =====================================================================
wf = WF("GHL 1 - AI Text Booking Assistant")
wf.note("## GHL 1. AI Text Booking Assistant\n\n**In simple words:** a client texts the salon's GoHighLevel number. GoHighLevel passes the text here. The AI checks Square for real open times, books in Square, and answers **through GoHighLevel**, so the whole chat shows in your GoHighLevel inbox.\n\nIt adds the tag **needs-card** when it sends the card link, and **needs-human** when a person should step in.",
        [-60, -380], w=660, h=300, color=4)
webhook(wf, "Text from GoHighLevel", [0, 0], "POST", "ghl-sms", respond="onReceived")
code(wf, "Config", [220, 0], settings(POLICY, STYLISTS, SERVICES, GHL_SETTINGS, tail=r"""const p = $('Text from GoHighLevel').first().json.body || {};
const cd = p.customData || {};
const msg = cd.message || (p.message && p.message.body) || p.message || '';
const tags = String(cd.tags || p.tags || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
return [{ json: { ...SETTINGS,
  phone: cd.phone || p.phone,
  contactId: cd.contact_id || p.contact_id || p.contactId,
  firstName: p.first_name || '', lastName: p.last_name || '',
  message: String(msg).trim(), tags } }];"""))
if_node(wf, "Has a Message?", [440, 0], "={{ $json.message && $json.contactId }}", "string", "notEmpty")
square(wf, "Find Customer by Phone", [660, 0], "POST", "'/v2/customers/search'",
       "{ limit: 1, query: { filter: { phone_number: { exact: $json.phone } } } }")
if_node(wf, "Already a Customer?", [880, 0], "={{ ($json.customers || []).length }}", "number", "gt", 0)
square(wf, "Create New Customer", [1100, 160], "POST", "'/v2/customers'",
       f"{{ idempotency_key: 'ghl-' + {CFG}.contactId, phone_number: {CFG}.phone, given_name: {CFG}.firstName || undefined, family_name: {CFG}.lastName || undefined, reference_id: {CFG}.contactId, note: 'Created by the text booking assistant' }}")
code(wf, "Customer Info", [1320, 0], js_of("1-ai-text-booking-assistant.json", "Customer Info"))
square(wf, "Check Saved Card", [1540, 0], "GET", "'/v2/cards'", query=[("customer_id", "={{ $json.customerId }}")])
prep = js_of("1-ai-text-booking-assistant.json", "Prepare for AI")
prep = prep.replace("const hasCard = cards.length > 0;",
                    "const hasCard = cards.length > 0;\nconst prepay = (cfg.tags || []).includes('prepay-required');")
prep = prep.replace("If you are unsure, the customer is upset",
                    "${prepay ? 'IMPORTANT: this client has missed appointments before. Do NOT book. Find the time they want, then say a team member will confirm it with them, and end with [HANDOFF].\\n\\n' : ''}If you are unsure, the customer is upset")
prep = prep.replace("return [{ json: { ...cust, hasCard, systemPrompt, message: cfg.message, phone: cfg.phone } }];",
                    "return [{ json: { ...cust, hasCard, cardLink, systemPrompt, message: cfg.message, phone: cfg.phone, contactId: cfg.contactId } }];")
assert "prepay" in prep and "cardLink, systemPrompt" in prep
code(wf, "Prepare for AI", [1760, 0], prep)
ghl(wf, "Save Link in GoHighLevel", [1980, 0], "PUT", f"'/contacts/' + {CFG}.contactId",
    "{ customFields: [ { key: 'card_link', field_value: $json.cardLink }, { key: 'square_customer_id', field_value: $json.customerId } ] }")
PREP = "$('Prepare for AI').first().json"
wf.add("AI Booking Assistant", "@n8n/n8n-nodes-langchain.agent", 1.7, [2200, 0], {
    "promptType": "define", "text": f"={{{{ {PREP}.message }}}}",
    "options": {"systemMessage": f"={{{{ {PREP}.systemPrompt }}}}", "maxIterations": 12}},
    onError="continueRegularOutput")
wf.add("Claude", "@n8n/n8n-nodes-langchain.lmChatAnthropic", 1.3, [2080, 260], {
    "model": {"__rl": True, "mode": "id", "value": "claude-haiku-5-5"}, "options": {"temperature": 0.3}},
    credentials={"anthropicApi": {"id": "REPLACE_ANTHROPIC_CRED", "name": "Anthropic"}})
wf.add("Conversation Memory", "@n8n/n8n-nodes-langchain.memoryBufferWindow", 1.3, [2220, 260], {
    "sessionIdType": "customKey", "sessionKey": f"={{{{ {CFG}.contactId }}}}", "contextWindowLength": 20})
# reuse the four Square tools exactly as built
tw1 = json.load(open(os.path.join(TW, "1-ai-text-booking-assistant.json")))
for i, t in enumerate(["check_availability", "book_appointment", "list_my_bookings", "cancel_booking"]):
    n = json.loads(json.dumps(next(x for x in tw1["nodes"] if x["name"] == t)))
    n["position"] = [2360 + i * 140, 260]
    wf.nodes.append(n)
code(wf, "Clean Up Reply", [2540, 0], r"""const prep = $('Prepare for AI').first().json;
const out = String($json.output || '').trim();
const handoff = out.includes('[HANDOFF]') || !out;
const reply = out.replace(/\[HANDOFF\]/g, '').trim() ||
  'Sorry, something went wrong on our side. A team member will text you shortly.';
const tags = [];
if (handoff) tags.push('needs-human');
if (!prep.hasCard && reply.includes(prep.cardLink)) tags.push('needs-card');
return [{ json: { reply, tags } }];""")
ghl_sms(wf, "Reply Through GoHighLevel", [2760, -80], f"{CFG}.contactId", "$json.reply")
if_node(wf, "Any Tags to Add?", [2760, 100], "={{ $json.tags.length }}", "number", "gt", 0)
ghl_tags(wf, "Add Tags in GoHighLevel", [2980, 100], "$json.tags", f"{CFG}.contactId")
for a, b in [("Text from GoHighLevel", "Config"), ("Config", "Has a Message?"),
             ("Find Customer by Phone", "Already a Customer?"), ("Create New Customer", "Customer Info"),
             ("Customer Info", "Check Saved Card"), ("Check Saved Card", "Prepare for AI"),
             ("Prepare for AI", "Save Link in GoHighLevel"), ("Save Link in GoHighLevel", "AI Booking Assistant"),
             ("AI Booking Assistant", "Clean Up Reply"), ("Clean Up Reply", "Reply Through GoHighLevel"),
             ("Clean Up Reply", "Any Tags to Add?")]:
    wf.link(a, b)
wf.link("Has a Message?", "Find Customer by Phone", 0)
wf.link("Already a Customer?", "Customer Info", 0)
wf.link("Already a Customer?", "Create New Customer", 1)
wf.link("Any Tags to Add?", "Add Tags in GoHighLevel", 0)
wf.link("Claude", "AI Booking Assistant", kind="ai_languageModel")
wf.link("Conversation Memory", "AI Booking Assistant", kind="ai_memory")
for t in ["check_availability", "book_appointment", "list_my_bookings", "cancel_booking"]:
    wf.link(t, "AI Booking Assistant", kind="ai_tool")
wf.save("ghl-1-ai-text-booking-assistant.json")

# =====================================================================
# 2. SAVE CARD PAGE (GHL edition)
# =====================================================================
wf = WF("GHL 2 - Secure Save-Card Page")
wf.note("## GHL 2. Secure Save-Card Page\n\n**In simple words:** the safe page from the text link. The card goes into **Square's own secure box**. When it's saved, GoHighLevel gets the tag **card-on-file**, the time they agreed to the policy, and a note on the contact with the full record (proof if a fee is ever disputed).",
        [-60, -380], w=640, h=280, color=4)
webhook(wf, "Customer Opens Link", [0, 0], "GET", "save-card")
webhook(wf, "Customer Taps Save", [0, 200], "POST", "save-card-submit")
code(wf, "Config", [220, 100], settings(POLICY, GHL_SETTINGS, r"""
  squareApplicationId: 'YOUR_SQUARE_APPLICATION_ID',   // Square Developer > your app > Credentials
"""))
if_node(wf, "Page or Save?", [440, 100], "={{ !!($json.request.body && $json.request.body.token) }}", "boolean", "true")
code(wf, "Build Card Page", [660, 0], js_of("2-save-card-page.json", "Build Card Page"))
respond(wf, "Show Card Page", [880, 0], "={{ $json.html }}")
code(wf, "Check Submission", [660, 200], js_of("2-save-card-page.json", "Check Submission"))
if_node(wf, "Valid and Agreed?", [880, 200], "={{ $json.ok }}", "boolean", "true")
square(wf, "Save Card in Square", [1100, 120], "POST", "'/v2/cards'",
       "{ idempotency_key: 'card-' + $json.c.slice(0, 20) + '-' + $json.token.slice(-16), source_id: $json.token,"
       " verification_token: $json.verificationToken || undefined,"
       " card: { customer_id: $json.c, cardholder_name: $json.name || undefined } }",
       on_error="continueErrorOutput")
square(wf, "Get Square Customer", [1320, 120], "GET", "'/v2/customers/' + $('Check Submission').first().json.c",
       on_error="continueRegularOutput")
code(wf, "Consent Record", [1540, 120], r"""const cfg = $('Config').first().json;
const card = $('Save Card in Square').first().json.card || {};
const c = $json.customer || {};
const h = cfg.request.headers || {};
const when = new Date().toLocaleString('en-US', { timeZone: cfg.timezone, dateStyle: 'medium', timeStyle: 'short' });
const cardText = (card.card_brand || 'Card') + ' ending ' + (card.last_4 || '');
const note = [
  'CARD SAVED + POLICY AGREED',
  'When: ' + when + ' (' + new Date().toISOString() + ')',
  'Card: ' + cardText + ' (stored by Square)',
  'Square customer: ' + (card.customer_id || ''),
  'IP address: ' + (h['x-forwarded-for'] || h['x-real-ip'] || ''),
  'Device: ' + (h['user-agent'] || ''),
  'Policy they agreed to: ' + cfg.policyText,
].join('\n');
return [{ json: { phone: c.phone_number || '', firstName: c.given_name || '', lastName: c.family_name || '',
  fields: { policy_agreed_at: when, square_customer_id: card.customer_id || '' }, note } }];""")
ghl_upsert(wf, "Update Contact in GoHighLevel", [1760, 120], "Consent Record")
ghl_tags(wf, "Tag: card-on-file", [1980, 120], "['card-on-file']", "$('Update Contact in GoHighLevel').first().json.contact.id")
ghl(wf, "Add Consent Note", [2200, 120], "POST", "'/contacts/' + $('Update Contact in GoHighLevel').first().json.contact.id + '/notes'",
    "{ body: $('Consent Record').first().json.note }")
ghl_sms(wf, "Text: Card Saved", [2420, 120], "$('Update Contact in GoHighLevel').first().json.contact.id",
        f"'Thanks! Your card is saved with ' + {CFG}.salonName + '. Reply YES to confirm your booking.'")
respond(wf, "Reply: Saved", [2640, 120], "{\"ok\": true}", "application/json")
respond(wf, "Reply: Card Error", [1320, 320],
        "={{ JSON.stringify({ ok: false, message: 'Your card could not be saved. Please check the details or try another card.' }) }}",
        "application/json")
respond(wf, "Reply: Not Allowed", [1100, 320],
        "={{ JSON.stringify({ ok: false, message: 'Please tick the box to agree to the policy, or ask us for a new link.' }) }}",
        "application/json")
for a, b in [("Customer Opens Link", "Config"), ("Customer Taps Save", "Config"), ("Config", "Page or Save?"),
             ("Build Card Page", "Show Card Page"), ("Check Submission", "Valid and Agreed?"),
             ("Get Square Customer", "Consent Record"), ("Consent Record", "Update Contact in GoHighLevel"),
             ("Update Contact in GoHighLevel", "Tag: card-on-file"), ("Tag: card-on-file", "Add Consent Note"),
             ("Add Consent Note", "Text: Card Saved"), ("Text: Card Saved", "Reply: Saved")]:
    wf.link(a, b)
wf.link("Page or Save?", "Check Submission", 0)
wf.link("Page or Save?", "Build Card Page", 1)
wf.link("Valid and Agreed?", "Save Card in Square", 0)
wf.link("Valid and Agreed?", "Reply: Not Allowed", 1)
wf.link("Save Card in Square", "Get Square Customer", 0)
wf.link("Save Card in Square", "Reply: Card Error", 1)
wf.save("ghl-2-save-card-page.json")

# shared JS: build GHL contact update from a Square booking + customer
LOOKUP = r"""const cfg = $('Config').first().json;
const seg = (b) => ((b.appointment_segments || [])[0] || {});
const stylistName = (tm) => (cfg.stylists.find((s) => s.team_member_id === tm) || {}).name || '';
const serviceName = (vid) => { for (const s of cfg.services) for (const o of s.options) if (o.service_variation_id === vid) return s.name; return ''; };
const fmt = (d) => new Date(d).toLocaleString('en-US', { timeZone: cfg.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
"""

# =====================================================================
# 3. REMINDERS (GHL edition: tags instead of texts)
# =====================================================================
wf = WF("GHL 3 - Reminder Tags")
wf.note("## GHL 3. Reminder Tags\n\n**In simple words:** every hour, n8n looks at the Square calendar. When it's time for a reminder, it fills in the appointment details on the GoHighLevel contact and adds a tag:\n- **sq-remind-48h** (2 days before)\n- **sq-remind-2h** (2 hours before)\n- **sq-completed** (after the visit)\n\nGoHighLevel workflows send the actual texts. Square is always the truth, so moved bookings get the right reminder.",
        [-60, -400], w=640, h=320, color=4)
wf.add("Every Hour", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0], {"rule": {"interval": [{"field": "hours", "hoursInterval": 1}]}})
code(wf, "Config", [220, 0], settings(POLICY, STYLISTS, SERVICES, GHL_SETTINGS))
square(wf, "Get Upcoming Bookings", [440, 0], "GET", "'/v2/bookings'",
       query=[("location_id", f"={{{{ {CFG}.locationId }}}}"),
              ("start_at_min", "={{ new Date(Date.now() - 4 * 3600e3).toISOString() }}"),
              ("start_at_max", "={{ new Date(Date.now() + 50 * 3600e3).toISOString() }}"),
              ("limit", "100")])
pick = js_of("3-reminders.json", "Pick Who Gets a Text")
pick = pick.replace("out.push({ json: { kind, bookingId: b.id, customerId: b.customer_id, startAt: b.start_at } });",
                    "out.push({ json: { kind, booking: b, customerId: b.customer_id } });")
assert "booking: b" in pick
code(wf, "Pick Who Gets a Reminder", [660, 0], pick)
square(wf, "Get Square Customer", [880, 0], "GET", "'/v2/customers/' + $json.customerId", on_error="continueRegularOutput")
code(wf, "Contact Details", [1100, 0], LOOKUP + r"""const r = $('Pick Who Gets a Reminder').item.json;
const b = r.booking, c = $json.customer || {};
const tag = { two_days: 'sq-remind-48h', two_hours: 'sq-remind-2h', follow_up: 'sq-completed' }[r.kind];
return { json: { phone: c.phone_number || '', firstName: c.given_name || '', lastName: c.family_name || '', tag,
  fields: { square_customer_id: b.customer_id, square_booking_id: b.id, appt_time: fmt(b.start_at),
    appt_stylist: stylistName(seg(b).team_member_id), appt_service: serviceName(seg(b).service_variation_id) } } };""", per_item=True)
if_node(wf, "Has a Phone Number?", [1320, 0], "={{ $json.phone }}", "string", "notEmpty")
ghl_upsert(wf, "Update Contact in GoHighLevel", [1540, 0], "Contact Details")
ghl_tags(wf, "Add Reminder Tag", [1760, 0], "[ $('Contact Details').item.json.tag ]")
for a, b in [("Every Hour", "Config"), ("Config", "Get Upcoming Bookings"), ("Get Upcoming Bookings", "Pick Who Gets a Reminder"),
             ("Pick Who Gets a Reminder", "Get Square Customer"), ("Get Square Customer", "Contact Details"),
             ("Contact Details", "Has a Phone Number?"), ("Update Contact in GoHighLevel", "Add Reminder Tag")]:
    wf.link(a, b)
wf.link("Has a Phone Number?", "Update Contact in GoHighLevel", 0)
wf.save("ghl-3-reminder-tags.json")

# =====================================================================
# 4. SQUARE EVENTS (GHL edition)
# =====================================================================
wf = WF("GHL 4 - Square Booking Events to GoHighLevel")
wf.note("## GHL 4. Square Booking Events\n\n**In simple words:** Square tells n8n each time a booking changes. n8n updates the GoHighLevel contact and adds one tag:\n- **sq-booked** (new booking)\n- **sq-cancelled** (cancelled in time)\n- **sq-late-cancel** (cancelled less than 24h before)\n- **sq-no-show** (stylist marked No-show in Square)\n\nFor late cancels and no-shows it also fills in **fee_link** and **fee_amount** for the manager's text.",
        [-60, -420], w=640, h=340, color=4)
webhook(wf, "Square Sends an Update", [0, 0], "POST", "square-events", respond="onReceived", options={"rawBody": True})
code(wf, "Config", [220, 0], settings(POLICY, STYLISTS, SERVICES, GHL_SETTINGS, r"""
  squareWebhookSignatureKey: 'YOUR_SQUARE_WEBHOOK_SIGNATURE_KEY',
  squareWebhookUrl: 'https://YOUR-N8N-DOMAIN.com/webhook/square-events', // must match Square exactly
""", tail="return [{ json: { ...SETTINGS, request: $input.first().json }, binary: $input.first().binary }];"))
chk = js_of("4-square-booking-events.json", "Check Message Is From Square")
chk = chk[:chk.index("const tm = ")] + "return [{ json: { kind, booking: b, customerId: b.customer_id } }];"
code(wf, "Check Message Is From Square", [440, 0], chk)
square(wf, "Get Square Customer", [660, 0], "GET", "'/v2/customers/' + $json.customerId", on_error="continueRegularOutput")
code(wf, "Contact Details", [880, 0], LOOKUP + r"""const ev = $('Check Message Is From Square').item.json;
const b = ev.booking, c = $json.customer || {};
const tag = { new_booking: 'sq-booked', cancelled: 'sq-cancelled', late: 'sq-late-cancel', noshow: 'sq-no-show' }[ev.kind];
const fields = { square_customer_id: b.customer_id, square_booking_id: b.id, appt_time: fmt(b.start_at),
  appt_stylist: stylistName(seg(b).team_member_id), appt_service: serviceName(seg(b).service_variation_id) };
if (ev.kind === 'new_booking') fields.booked_via = b.source === 'API' ? 'ai' : (b.source === 'FIRST_PARTY_BUYER' ? 'square online' : 'front desk');
if (ev.kind === 'late' || ev.kind === 'noshow') {
  const crypto = require('crypto');
  const s = crypto.createHmac('sha256', cfg.linkSecret).update(b.id + '|' + ev.kind).digest('hex').slice(0, 32);
  fields.fee_link = `${cfg.n8nBaseUrl}/webhook/fee-decision?b=${encodeURIComponent(b.id)}&k=${ev.kind}&s=${s}`;
  fields.fee_amount = '$' + ((ev.kind === 'noshow' ? cfg.noShowFeeCents : cfg.lateCancelFeeCents) / 100).toFixed(2);
}
return { json: { phone: c.phone_number || '', firstName: c.given_name || '', lastName: c.family_name || '', tag, fields } };""", per_item=True)
if_node(wf, "Has a Phone Number?", [1100, 0], "={{ $json.phone }}", "string", "notEmpty")
ghl_upsert(wf, "Update Contact in GoHighLevel", [1320, 0], "Contact Details")
ghl_tags(wf, "Add Event Tag", [1540, 0], "[ $('Contact Details').item.json.tag ]")
for a, b in [("Square Sends an Update", "Config"), ("Config", "Check Message Is From Square"),
             ("Check Message Is From Square", "Get Square Customer"), ("Get Square Customer", "Contact Details"),
             ("Contact Details", "Has a Phone Number?"), ("Update Contact in GoHighLevel", "Add Event Tag")]:
    wf.link(a, b)
wf.link("Has a Phone Number?", "Update Contact in GoHighLevel", 0)
wf.save("ghl-4-square-events.json")

# =====================================================================
# 5. FEE DECISION (GHL edition)
# =====================================================================
wf = WF("GHL 5 - Manager Charges or Waives Fee")
wf.note("## GHL 5. Charge or Waive\n\n**In simple words:** the manager taps the fee link (sent by GoHighLevel). The page shows who, when and how much, with **Charge** and **Waive** buttons.\n- **Charge:** Square charges the saved card.\n- **Waive:** nothing is charged.\nThen n8n adds **fee-charged** or **fee-waived** in GoHighLevel (which sends the receipt text and moves the pipeline card) and writes a note on the contact.",
        [-60, -440], w=660, h=340, color=4)
webhook(wf, "Manager Opens Link", [0, 0], "GET", "fee-decision")
webhook(wf, "Manager Presses a Button", [0, 200], "POST", "fee-decision-submit")
code(wf, "Config", [220, 100], settings(POLICY, GHL_SETTINGS))
code(wf, "Check the Link", [440, 100], js_of("5-fee-approve-or-waive.json", "Check the Link"))
if_node(wf, "Link OK?", [660, 100], "={{ $json.valid }}", "boolean", "true")
respond(wf, "Show: Bad Link", [880, 300], "<h1>This link is not valid.</h1>")
CHK = "$('Check the Link').first().json"
square(wf, "Get Booking", [880, 100], "GET", f"'/v2/bookings/' + {CHK}.b")
square(wf, "Get Square Customer", [1100, 100], "GET", "'/v2/customers/' + $json.booking.customer_id", on_error="continueRegularOutput")
if_node(wf, "Button Pressed?", [1320, 100], f"={{{{ {CHK}.action }}}}", "string", "notEmpty")
code(wf, "Build Decision Page", [1540, 260], js_of("5-fee-approve-or-waive.json", "Build Decision Page"))
respond(wf, "Show Decision Page", [1760, 260], "={{ $json.html }}")
if_node(wf, "Charge?", [1540, 60], f"={{{{ {CHK}.action }}}}", "string", "equals", "charge")
square(wf, "Find Saved Card", [1760, 0], "GET", "'/v2/cards'",
       query=[("customer_id", "={{ $('Get Booking').first().json.booking.customer_id }}")])
code(wf, "Pick Card", [1980, 0], js_of("5-fee-approve-or-waive.json", "Pick Card").replace("Get Booking (charge)", "Get Booking"))
if_node(wf, "Has a Card?", [2200, 0], "={{ $json.cardId }}", "string", "notEmpty")
respond(wf, "Show: No Card", [2420, 160], "<h1>No saved card for this client.</h1><p>Nothing was charged.</p>")
square(wf, "Charge the Card", [2420, -40], "POST", "'/v2/payments'",
       "{ idempotency_key: 'fee-' + " + CHK + ".b + '-' + " + CHK + ".k, source_id: $json.cardId,"
       " customer_id: $json.customerId, location_id: " + CFG + ".locationId,"
       " amount_money: { amount: " + CHK + ".feeCents, currency: " + CFG + ".currency }, autocomplete: true,"
       " note: " + CHK + ".label + ' fee', reference_id: String(" + CHK + ".b).slice(0, 40) }",
       on_error="continueErrorOutput")
respond(wf, "Show: Charge Failed", [2640, 160],
        "<h1>The charge did not go through.</h1><p>The card may be declined or expired. Nothing was charged.</p>")
code(wf, "Fee Result", [2860, 60], r"""const cfg = $('Config').first().json;
const v = $('Check the Link').first().json;
const c = $('Get Square Customer').first().json.customer || {};
const charged = v.action === 'charge' && $('Charge the Card').isExecuted;
const pay = charged ? ($('Charge the Card').first().json.payment || {}) : {};
const amount = '$' + (v.feeCents / 100).toFixed(2);
const when = new Date().toLocaleString('en-US', { timeZone: cfg.timezone, dateStyle: 'medium', timeStyle: 'short' });
const note = charged
  ? `${v.label.toUpperCase()} FEE CHARGED: ${amount} on ${when}. Square payment ${pay.id || ''}. Booking ${v.b}.`
  : `${v.label.toUpperCase()} FEE WAIVED on ${when}. Reason: ${v.reason || 'none given'}. Booking ${v.b}.`;
return [{ json: { phone: c.phone_number || '', firstName: c.given_name || '', lastName: c.family_name || '',
  fields: { fee_amount: amount }, tag: charged ? 'fee-charged' : 'fee-waived', note, charged } }];""")
ghl_upsert(wf, "Update Contact in GoHighLevel", [3080, 60], "Fee Result")
ghl_tags(wf, "Add Fee Tag", [3300, 60], "[ $('Fee Result').first().json.tag ]",
         "$('Update Contact in GoHighLevel').first().json.contact.id")
ghl(wf, "Add Fee Note", [3520, 60], "POST", "'/contacts/' + $('Update Contact in GoHighLevel').first().json.contact.id + '/notes'",
    "{ body: $('Fee Result').first().json.note }")
respond(wf, "Show: Done", [3740, 60],
        "={{ $('Fee Result').first().json.charged ? '<h1>Charged.</h1><p>GoHighLevel will text the client a receipt.</p>' : '<h1>Fee waived.</h1><p>Nothing was charged.</p>' }}")
for a, b in [("Manager Opens Link", "Config"), ("Manager Presses a Button", "Config"), ("Config", "Check the Link"),
             ("Check the Link", "Link OK?"), ("Get Booking", "Get Square Customer"),
             ("Get Square Customer", "Button Pressed?"), ("Build Decision Page", "Show Decision Page"),
             ("Find Saved Card", "Pick Card"), ("Pick Card", "Has a Card?"),
             ("Fee Result", "Update Contact in GoHighLevel"), ("Update Contact in GoHighLevel", "Add Fee Tag"),
             ("Add Fee Tag", "Add Fee Note"), ("Add Fee Note", "Show: Done")]:
    wf.link(a, b)
wf.link("Link OK?", "Get Booking", 0)
wf.link("Link OK?", "Show: Bad Link", 1)
wf.link("Button Pressed?", "Charge?", 0)
wf.link("Button Pressed?", "Build Decision Page", 1)
wf.link("Charge?", "Find Saved Card", 0)
wf.link("Charge?", "Fee Result", 1)
wf.link("Has a Card?", "Charge the Card", 0)
wf.link("Has a Card?", "Show: No Card", 1)
wf.link("Charge the Card", "Fee Result", 0)
wf.link("Charge the Card", "Show: Charge Failed", 1)
wf.save("ghl-5-fee-charge-or-waive.json")
print("ok")
