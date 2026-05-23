# DeepSeek Codex Proxy

Local Node.js proxy that lets Codex use DeepSeek V4 by exposing a Responses-compatible API on localhost and translating requests to DeepSeek's OpenAI-compatible Chat Completions API.

## Requirements

- Node.js 20+
- A DeepSeek API key

## Install

```bash
npm install
```

## Run

```bash
DEEPSEEK_API_KEY=... npm run dev
```

The proxy listens on `127.0.0.1:8787` by default.

You can check it in a browser at `http://127.0.0.1:8787/v1`, or from a terminal:

```bash
curl --noproxy '*' http://127.0.0.1:8787/v1
```

## Environment

```bash
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
PORT=8787
DEEPSEEK_DEFAULT_MODEL=deepseek-v4-pro
DEEPSEEK_THINKING=enabled
DEEPSEEK_REASONING_EFFORT=high
LOG_LEVEL=info
NO_PROXY=127.0.0.1,localhost,::1
no_proxy=127.0.0.1,localhost,::1
```

`DEEPSEEK_THINKING` must be `enabled` or `disabled`. `DEEPSEEK_REASONING_EFFORT` must be `high` or `max`.
Set `NO_PROXY`/`no_proxy` if your shell uses `http_proxy`, `https_proxy`, or `ALL_PROXY`; Codex and curl should connect to the local proxy directly.

## Codex Configuration

Add this provider to `~/.codex/config.toml`:

```toml
model = "deepseek-v4-pro"
model_provider = "deepseek-v4"

[model_providers.deepseek-v4]
name = "DeepSeek V4 via local proxy"
base_url = "http://127.0.0.1:8787/v1"
env_key = "DEEPSEEK_API_KEY"
wire_api = "responses"
```

Codex will send Responses API traffic to this proxy. The proxy forwards only the features DeepSeek Chat Completions can handle: text, function tools, and tool results. Built-in OpenAI tools such as web search and image generation are filtered out for v1.

## Endpoints

- `GET /healthz`: readiness check.
- `GET /v1`: endpoint index for browser and curl checks.
- `GET /v1/models`: Codex-compatible DeepSeek V4 model catalog.
- `POST /v1/responses`: Responses-compatible endpoint translated to DeepSeek `/chat/completions`.

## Development

```bash
npm test
npm run typecheck
npm run build
```

## Manual Acceptance

Start the proxy:

```bash
DEEPSEEK_API_KEY=... npm run dev
```

Then run Codex with the local provider:

```bash
codex exec \
  -c 'model="deepseek-v4-pro"' \
  -c 'model_provider="deepseek-v4"' \
  -c 'model_providers.deepseek-v4={name="DeepSeek V4 via local proxy", base_url="http://127.0.0.1:8787/v1", env_key="DEEPSEEK_API_KEY", wire_api="responses"}' \
  'Reply with ok only.'
```
