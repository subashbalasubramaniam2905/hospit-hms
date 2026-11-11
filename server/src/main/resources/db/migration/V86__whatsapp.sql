-- WhatsApp Cloud API: messages are sent by a background dispatcher and delivery receipts arrive by webhook.

alter table notification_msg
  add column to_address   text,                          -- the raw mobile or email the message goes to
  add column deliver      boolean not null default false, -- true when a provider was set up as it was queued; only these are sent
  add column provider_ref text,                          -- the provider's message id (WhatsApp wamid), matched by delivery receipts
  add column attempts     int not null default 0,
  add column updated_at   timestamptz;

update notification_msg set to_address = nullif(split_part(to_text, ' · ', 2), '');

create index notification_provider_ref_idx on notification_msg (provider_ref) where provider_ref is not null;
create index notification_outbox_idx on notification_msg (channel, id) where status = 'Queued' and deliver;

-- Fields marked optional do not stop the connection from counting as set up.
update integration set
  description = 'Send reminders, lab-ready and discharge messages through the WhatsApp Cloud API. Delivery and read receipts come back by webhook.',
  fields = '[
    {"key":"phone","label":"Phone number ID"},
    {"key":"token","label":"Access token","secret":true},
    {"key":"template","label":"Template name (blank sends plain text)","optional":true},
    {"key":"templateLang","label":"Template language code","optional":true},
    {"key":"templateVars","label":"Template variables, in order (name, message)","optional":true},
    {"key":"apiVersion","label":"Graph API version","optional":true},
    {"key":"waba","label":"WABA ID","optional":true},
    {"key":"appSecret","label":"App secret (checks webhook signatures)","secret":true,"optional":true},
    {"key":"verifyToken","label":"Webhook verify token","secret":true,"optional":true}
  ]',
  config = '{"templateLang":"en","templateVars":"name,message","apiVersion":"v21.0"}'::jsonb || config
where id = 'wa';
