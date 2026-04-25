# n8n Webhook Contract

This contract matches the frontend `n8n` backend mode in `src/App.tsx`.

## 1) Prompt Optimize

- Method: `POST`
- Path: `/webhook/img-prompt-optimize`

Request example:

```json
{
  "prompt": "电影感人像，雨夜霓虹，半身特写",
  "negativePrompt": "低清晰度，手指畸形",
  "mode": "text-to-image",
  "provider": "openai",
  "model": "gpt-5.5",
  "generation": {
    "resolution": "1024x1024",
    "style": "cinematic",
    "quality": "high",
    "aspectRatio": "1:1"
  }
}
```

Response example:

```json
{
  "ok": true,
  "optimizedPrompt": "...",
  "summary": "...",
  "raw": {}
}
```

Frontend extraction priority:
- `optimizedPrompt`
- `optimized_prompt`
- `prompt`
- `data.optimizedPrompt`
- `result.optimizedPrompt`

## 2) Image Generate Submit

- Method: `POST`
- Path: `/webhook/img-generate-submit`

Request example:

```json
{
  "requestId": "uuid",
  "mode": "image-to-image",
  "provider": "openai",
  "model": "gpt-5.5",
  "toolModel": "gpt-image-2",
  "prompt": "...",
  "promptRaw": "...",
  "negativePrompt": "...",
  "stream": true,
  "generation": {
    "resolution": "2048x2048",
    "aspectRatio": "1:1",
    "imageCount": 1,
    "quality": "high",
    "outputFormat": "png",
    "background": "auto",
    "style": "cinematic",
    "temperature": 0.7,
    "seed": null,
    "strength": 0.65
  },
  "source": {
    "type": "file-base64",
    "mimeType": "image/jpeg",
    "imageBase64": "...",
    "imageUrl": ""
  }
}
```

Response example (sync success):

```json
{
  "ok": true,
  "status": "completed",
  "imageCount": 1,
  "images": [
    {
      "src": "data:image/png;base64,...",
      "mimeType": "image/png"
    }
  ],
  "outputText": "...",
  "eventTypes": ["response.output_item.done"],
  "hasOutputItemDone": true
}
```

If no image was extracted, response should still return `ok: false` and include diagnostics:

```json
{
  "ok": false,
  "status": "no_image",
  "eventTypes": ["response.created", "response.completed"],
  "rawPreview": "..."
}
```

## 3) Job Status (optional async)

- Method: `POST`
- Path: `/webhook/img-job-status`

Request:

```json
{
  "jobId": "job_xxx"
}
```

Response:

```json
{
  "ok": false,
  "status": "not_configured",
  "jobId": "job_xxx",
  "message": "Default template is sync mode"
}
```

If you implement async queueing later, return one of:
- `status: pending`
- `status: running`
- `status: completed` with `images`
- `status: failed` with `message`

## Auth header

The frontend sends:
- `Authorization: Bearer <n8nAuthToken>` (if configured)
- `X-N8N-Token: <n8nAuthToken>` (if configured)
- plus optional custom headers from `extraHeaders`.
