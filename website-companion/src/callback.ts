import { relayGoogleCallback } from './bridge';
const relayed = relayGoogleCallback(window.location.href, window.opener);
const status = document.getElementById('callback-status');
if (status)
  status.textContent = relayed
    ? 'Returning to Powerly sign-in… You can close this window.'
    : 'Open Google sign-in from the Email Extractor extension.';
