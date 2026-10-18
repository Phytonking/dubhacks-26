/* Selldial console config. One source of truth: every screen reads these values. */
window.SELLDIAL_CONFIG = {
  ownerLimitCents: 150000,        // purchases above this need the account owner's YES by text
  line: "(206) 555-0142",         // the Selldial agent's phone number
  tenant: "T-Mobile demo",
  apiUrl: null,                   // set to e.g. "/api/console" once a backend serves the console snapshot
};
