# Selldial

Selldial is a T-Mobile phone line, built at DubHacks 26, that customers can call or text (via Photon) to buy a phone or plan. It recommends what to buy, argues against its own sale when waiting is the better deal, and closes purchases through a Visa checkout the account owner controls. The LLM only handles the conversation: deterministic Python code makes every recommendation, guard rules gate every action, and a company-facing console shows every conversation, approval, handoff and audit entry. Run `make dev` and open http://localhost:8000.
