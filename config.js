/* Research data sharing configuration (opt-in; nothing is sent unless the user turns sharing on).
   INGEST_KEY: ingest key sent as the X-Ingest-Key header. It is meant to sit in this static app; the server only accepts requests from the origin https://jonathanagronica.github.io. */
(function (root) {
  var cfg = {
    INGEST_URL: 'https://170-64-148-102.sslip.io/api/mistletoe/submit',
    INGEST_KEY: 'mm-f1e22c16ccf1fe6050906fae',
    ACCESS_STATUS_URL: 'https://170-64-148-102.sslip.io/api/mistletoe/access-status',
    ACCESS_URL: 'https://170-64-148-102.sslip.io/api/mistletoe/access-request',
    ACCESS_MAILTO: 'jonathan@agronicaag.com',
    APP_VERSION: 'v14'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = cfg; else root.MM_CONFIG = cfg;
})(typeof self !== 'undefined' ? self : this);
