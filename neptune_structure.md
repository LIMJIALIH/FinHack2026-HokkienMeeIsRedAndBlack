User node :User

~id
name
balance
ekyc_status
ekyc_level
hashed_phone
hashed_ic
risk_tier_current
summary_text_latest
summary_updated_at
summary_agent_version
created_at
updated_at
Transaction edge [:TRANSFERRED_TO] (User -> User)

~id (one edge per transaction)
tx_time
amount
currency
message_text
tx_note (optional)
channel
status (approved|warned|blocked|reversed)
finbert_score (latest)
emotion_score (latest)
risk_score_latest
risk_reason_codes
updated_at