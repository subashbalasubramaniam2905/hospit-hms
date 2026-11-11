# WhatsApp setup

HospitOS sends patient messages (reminders, lab report ready, discharge, follow-ups) through Meta's **WhatsApp Cloud API**.
It's free to try with Meta's test number, and it costs nothing to keep installed while it's turned off.

Until WhatsApp is set up and turned on, messages are saved as **Queued** and nothing is sent. Messages queued before set-up are
never sent later, so turning it on doesn't message anyone by surprise.

## What you need from Meta (about 10 minutes, free)

1. Go to [developers.facebook.com](https://developers.facebook.com/), sign in with Facebook and choose **My Apps → Create app**.
   Pick **Business** (or "Other → Business"), give it a name such as *HospitOS*, then add the **WhatsApp** product.
2. Open **WhatsApp → API Setup**. Meta gives you a free **test number**. On that page, note:
   - **Phone number ID** (a long number, not the phone number itself)
   - **WhatsApp Business Account ID** (optional in HospitOS)
   - **Temporary access token** (works for 24 hours; see "A token that doesn't expire" below)
3. Under **To**, add up to 5 mobile numbers that may receive test messages (your own, a doctor's), and confirm each with the code
   WhatsApp sends. In test mode only these numbers receive messages.

## Put the details into HospitOS

Sign in as the super administrator → **Admin → Integrations → WhatsApp Business**.

| Field | What to enter |
| --- | --- |
| Phone number ID | From API Setup |
| Access token | The token from API Setup. Stored encrypted; never shown again |
| Template name | Leave **blank** for the first test (plain text). Later, the name of your approved template |
| Template language code | `en` (or `en_US`, `ta` …, as approved) |
| Template variables | `name,message` — what fills `{{1}}`, `{{2}}`… in the template body |
| Graph API version | `v21.0` unless Meta tells you otherwise |
| App secret | **App settings → Basic → App secret**. Needed for delivery receipts |
| Webhook verify token | Any phrase you make up, such as `hospitos-2026`. Needed for delivery receipts |

Press **Test connection**. It looks up your sender number and messages no one. The card turns **Connected**. Then turn the switch on.

Never paste tokens or secrets into chat or email. They go only into this screen (or the server's own settings).

## Send a test

1. Make sure the patient's mobile is one of your 5 test numbers.
2. **Organisation → Notifications → New message**, channel **WhatsApp**, send.
3. Within a few seconds the status moves from Queued to **Sent**, then **Delivered** and **Read** once receipts are on.

**Plain text vs templates.** WhatsApp only delivers plain text if the patient has messaged the hospital's number in the last
24 hours. For the first test, send "hi" from your phone to the test number first. For real use, create a **Utility** template in
**WhatsApp Manager → Message templates**, for example:

> Dear {{1}}, {{2}} – HospitOS Udumalpet

Once Meta approves it, enter its name in **Template name**. HospitOS fills `{{1}}` with the patient's name and `{{2}}` with the
message text. Meta's ready-made `hello_world` template takes no variables: to try it, set Template name `hello_world`,
language `en_US`, and clear Template variables.

## Delivery and read receipts (webhook)

In the Meta app go to **WhatsApp → Configuration → Webhook → Edit**:

- **Callback URL:** `https://<your-server>/api/webhooks/whatsapp` (for the online demo, the Render API address)
- **Verify token:** the same phrase as in HospitOS
- Then **Manage → subscribe to `messages`**

Meta needs a public HTTPS address, so receipts work on the online demo but not on a laptop-only setup. Sending still works locally.

## A token that doesn't expire

The temporary token stops after 24 hours. For a lasting one: **Meta Business Settings → Users → System users → Add** (Admin),
assign the app and the WhatsApp account, then **Generate token** with `whatsapp_business_messaging` and
`whatsapp_business_management`. Paste it into the Access token field.

## Going live with the hospital's own number

Verify the business in Meta Business Manager, add the hospital's number (one not used in the normal WhatsApp app), get templates
approved, and replace the Phone number ID and token. Nothing else changes. Meta charges per template message (utility messages
are roughly ₹0.12–0.15 each in India; check Meta's current rate card).

## How it works

- `POST /api/notifications/messages` saves the message. If WhatsApp is usable it is marked for delivery.
- A background job (every 5 s, `WHATSAPP_POLL_MS`) sends due messages. Rate limits and outages are retried after a minute,
  up to 3 tries. Permanent errors (for example "Recipient is not a WhatsApp user") mark the message **Failed** with Meta's reason.
- Ten-digit Indian mobiles get the 91 prefix automatically. Landlines fail without calling Meta.
- `GET/POST /api/webhooks/whatsapp` handles Meta's subscription check and signed receipts (HMAC-SHA256 with the app secret).
  Statuses only move forward: Sent → Delivered → Read.
