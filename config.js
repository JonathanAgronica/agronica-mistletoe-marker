/* Research data sharing configuration (opt-in; nothing is sent unless the user turns sharing on).
   INGEST_KEY: shared ingest key sent as the X-Ingest-Key header. Leave '' until Agronica issues one. */
(function (root) {
  var cfg = {
    INGEST_URL: 'https://170-64-148-102.sslip.io/api/mistletoe/submit',
    INGEST_KEY: '',
    ACCESS_URL: 'https://170-64-148-102.sslip.io/api/mistletoe/access-request',
    ACCESS_MAILTO: 'jonathan@agronicaag.com',
    APP_VERSION: 'v11'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = cfg; else root.MM_CONFIG = cfg;
})(typeof self !== 'undefined' ? self : this);
