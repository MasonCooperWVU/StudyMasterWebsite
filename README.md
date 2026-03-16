# StudyStack — AI-Powered Study App

A static web app that turns your AI-generated class notes into interactive flashcards and quizzes.

---

## Project Structure

```
studyapp/
├── index.html                    ← Main app (single-file SPA)
├── env.js                        ← Env var injection (for Azure SWA)
├── staticwebapp.config.json      ← Azure Static Web App config
├── data/
│   ├── index.json                ← File manifest for local mode
│   └── {class-id}_{notes-id}_flashcards.json
│   └── {class-id}_{notes-id}_quiz.json
├── azure-function/
│   └── index.js                  ← Blob trigger function (updated)
└── sample-data/                  ← Example JSON files
```

---

## JSON File Naming Convention

Files must follow this pattern:
```
{class-id}_{notes-id}_flashcards.json
{class-id}_{notes-id}_quiz.json
```

Examples:
- `biology-101_cell-structure_flashcards.json`
- `history-202_world-war-ii_quiz.json`

IDs use lowercase letters, numbers, and hyphens only.

---

## Running Locally

### Option 1 — Simple (no build tool)

1. Place your JSON files in the `data/` folder
2. Update `data/index.json` to list your files
3. Serve from a local HTTP server (not file://) — e.g.:

```bash
# Python
python -m http.server 3000

# Node.js
npx serve .

# VS Code
Use the "Live Server" extension
```

4. Open http://localhost:3000

> **Note:** You must use an HTTP server, not open index.html directly as a file,
> because the app uses fetch() to load JSON files.

### Option 2 — Connect to Azure Blob locally

1. Start the dev server (above)
2. Click ⚙ **Settings** in the app
3. Switch to **Azure Blob** mode
4. Enter your Storage Account name, Container name, and SAS token
5. Click **Save & Reload**

Settings are persisted in localStorage so you don't have to re-enter them.

---

## Deploying to Azure Static Web Apps

### 1. Create the Static Web App

In Azure Portal or CLI:
```bash
az staticwebapp create \
  --name studystack \
  --resource-group myRG \
  --source https://github.com/yourrepo/studystack \
  --location "East US 2" \
  --branch main \
  --app-location "/" \
  --output-location "/"
```

### 2. Set Environment Variables

In Azure Portal → Static Web App → Configuration → Application settings:

| Name | Value |
|---|---|
| `VITE_BLOB_ACCOUNT` | your storage account name |
| `VITE_BLOB_CONTAINER` | your container name |
| `VITE_BLOB_SAS` | your SAS token (`?sv=2023-01-03&...`) |
| `VITE_BLOB_MANIFEST` | `index.json` (optional) |

### 3. Inject Env Vars (choose one approach)

**Option A — API endpoint (recommended for security)**

Create `/api/config/index.js`:
```javascript
module.exports = async function(context, req) {
  context.res = {
    body: {
      VITE_BLOB_ACCOUNT:    process.env.VITE_BLOB_ACCOUNT    || '',
      VITE_BLOB_CONTAINER:  process.env.VITE_BLOB_CONTAINER  || '',
      VITE_BLOB_SAS:        process.env.VITE_BLOB_SAS        || '',
      VITE_BLOB_MANIFEST:   process.env.VITE_BLOB_MANIFEST   || 'index.json',
    }
  };
};
```

Then in `index.html`, add before the main `<script>`:
```html
<script>
  fetch('/api/config').then(r=>r.json()).then(cfg => { window.__ENV__ = cfg; });
</script>
```

**Option B — Edit env.js manually**

Open `env.js` and fill in the values directly. Don't commit secrets to git.

---

## Azure Blob Storage Setup

### Container CORS (required for browser access)

In Azure Portal → Storage Account → Resource sharing (CORS):

| Allowed Origins | Allowed Methods | Allowed Headers | Exposed Headers | Max Age |
|---|---|---|---|---|
| `*` (or your SWA URL) | GET, HEAD, OPTIONS | * | * | 86400 |

### Generate a SAS Token

1. Portal → Storage Account → Shared access signature
2. Select: Blob service, Container + Object resource types, Read + List permissions
3. Set expiry (e.g. 1 year)
4. Generate and copy the SAS token string (starts with `?sv=`)

### Blob Index / Manifest

Upload an `index.json` to your container listing all study files:
```json
{
  "files": [
    "biology-101_cell-structure_flashcards.json",
    "biology-101_cell-structure_quiz.json"
  ]
}
```

This is much faster than listing blobs on every page load.

---

## Azure Function — Blob Trigger

See `azure-function/index.js` for the updated trigger that produces standardized JSON.

### Required App Settings for the Function

```
AZURE_OPENAI_ENDPOINT       = https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY        = your-key
AZURE_OPENAI_DEPLOYMENT     = gpt-4o
AZURE_SEARCH_ENDPOINT       = https://your-search.search.windows.net
AZURE_SEARCH_API_KEY        = your-search-admin-key
AZURE_SEARCH_INDEX_NAME     = your-index-name
AZURE_STORAGE_CONNECTION    = DefaultEndpointsProtocol=https;...
OUTPUT_CONTAINER_NAME       = studyjson
```

### Blob naming convention for uploads

Upload PDFs with this path format: `{class-id}/{notes-name}.pdf`

Examples:
- `biology-101/cell-structure-notes.pdf`
- `history-202/wwii-notes.pdf`

The function derives the class and notes IDs automatically from the path.

---

## JSON Schema Reference

### Flashcards
```json
{
  "schema_version": "1.0",
  "type": "flashcards",
  "metadata": {
    "class": "Biology 101",
    "class_id": "biology-101",
    "notes_set": "Cell Structure",
    "notes_id": "cell-structure",
    "source_file": "cell-structure-notes.pdf",
    "generated_at": "2024-01-15T10:30:00Z",
    "card_count": 15
  },
  "flashcards": [
    {
      "id": 1,
      "front": "Question or term",
      "back": "Full explanation or definition",
      "tags": ["topic1", "topic2"]
    }
  ]
}
```

### Quiz
```json
{
  "schema_version": "1.0",
  "type": "quiz",
  "metadata": {
    "class": "Biology 101",
    "class_id": "biology-101",
    "notes_set": "Cell Structure",
    "notes_id": "cell-structure",
    "source_file": "cell-structure-notes.pdf",
    "generated_at": "2024-01-15T10:30:00Z",
    "question_count": 12
  },
  "quiz": [
    {
      "id": 1,
      "question": "Question text",
      "type": "multiple_choice",
      "options": [
        { "letter": "A", "text": "Option A" },
        { "letter": "B", "text": "Option B" },
        { "letter": "C", "text": "Option C" },
        { "letter": "D", "text": "Option D" }
      ],
      "correct_answer": "B",
      "explanation": "Why this answer is correct",
      "tags": ["topic1"]
    }
  ]
}
```
