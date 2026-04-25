# n8n Backend Workflows

This folder contains workflow templates for moving image-generation orchestration behind n8n.

## Workflows

- `workflows/img-prompt-optimize.json`
  - Webhook endpoint: `/webhook/img-prompt-optimize`
  - Purpose: normalize and expand user prompts for image generation.
- `workflows/img-generate-submit.json`
  - Webhook endpoint: `/webhook/img-generate-submit`
  - Purpose: call ASXS Responses API (`gpt-5.5` + `gpt-image-2`) and extract image payloads.
- `workflows/img-job-status.json`
  - Webhook endpoint: `/webhook/img-job-status`
  - Purpose: lightweight status endpoint contract (extensible for queue tracking).

## Credentials

These templates call `https://api.asxs.top/v1/responses` via HTTP Request nodes.
In n8n UI, bind your existing credential to each HTTP Request node:

1. Open workflow.
2. Select node `Call ASXS Responses`.
3. Choose your existing credential (for example `ASXS_MAIN_GPT55`).
4. Save and activate workflow.

## Import Order

1. Import `workflows/img-prompt-optimize.json`.
2. Import `workflows/img-generate-submit.json`.
3. Import `workflows/img-job-status.json`.
4. Bind credential on every `Call ASXS Responses` node.
5. Activate all 3 workflows.

## Runtime Notes

- Default template is **sync response** mode: image data is returned directly by `/webhook/img-generate-submit`.
- `/webhook/img-job-status` is a reserved contract endpoint for future async queue mode.
- Frontend default `n8nBaseUrl` is `/api-n8n` (Vite dev proxy to `http://127.0.0.1:5678`).
- Frontend `n8n` mode supports both:
  - direct image response (`images/base64`)
  - optional `jobId` + polling status endpoint.

## Webhook Contract

See `contracts/webhook-contract.md`.
