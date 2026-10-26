# gateway

Adds the header `x-pi-session` with the pi session id to every provider request that carries `x-gateway-key`. That header marks a provider that goes through agentgateway, so direct endpoints get no extra header.

The gateway stores the id as the log group and removes the header before the request goes to the provider. All requests of one session then share one group, also after a switch of model or provider.

## Changes

<!-- changelog:start -->
## 0.2.0 — 2026-10-26

- docs: AGENTS.md of each extension as rules, facts to README

[All changes](CHANGELOG.md)
<!-- changelog:end -->
