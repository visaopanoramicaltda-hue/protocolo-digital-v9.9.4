<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/aa583ef9-caa0-439e-9b69-941f25f45b11

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy to Cloud Run

**Prerequisites:** [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

### Option 1: Using Cloud Build (recommended)

```bash
gcloud builds submit --config cloudbuild.yaml
```

### Option 2: Direct deploy

```bash
gcloud run deploy protocolo-digital \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

> **Important:** The `--allow-unauthenticated` flag is required to allow public access. Without it, the service will return `Error: Forbidden`.
