/**
 * Azure Function - Blob Trigger
 * Processes uploaded PDF class notes → AI Search → GPT → Flashcards + Quiz JSON
 *
 * Trigger: Azure Blob Storage (new PDF uploaded)
 * Output:  Two JSON files written back to blob:
 *   {class-id}_{notes-id}_flashcards.json
 *   {class-id}_{notes-id}_quiz.json
 *
 * Required App Settings (Environment Variables):
 *   AZURE_OPENAI_ENDPOINT       - Your Azure OpenAI endpoint
 *   AZURE_OPENAI_API_KEY        - Your Azure OpenAI API key
 *   AZURE_OPENAI_DEPLOYMENT     - GPT deployment name (e.g. gpt-4o)
 *   AZURE_SEARCH_ENDPOINT       - Azure AI Search endpoint
 *   AZURE_SEARCH_API_KEY        - Azure AI Search admin key
 *   AZURE_SEARCH_INDEX_NAME     - Name of your search index
 *   AZURE_STORAGE_CONNECTION    - Blob storage connection string
 *   OUTPUT_CONTAINER_NAME       - Container to write JSON output files
 */

const { BlobServiceClient } = require("@azure/storage-blob");
const { SearchClient, AzureKeyCredential } = require("@azure/search-documents");

module.exports = async function (context, myBlob) {
  const blobName = context.bindingData.name; // e.g. "biology-101/cell-structure-notes.pdf"
  context.log(`Processing blob: ${blobName}`);

  // ── 1. Parse class and notes identifiers from the blob path ──────────────
  // Expected blob path format: {class-id}/{notes-set-name}.pdf
  // e.g. "biology-101/cell-structure-notes.pdf"
  const pathParts = blobName.split("/");
  const classId = pathParts.length > 1 ? pathParts[0] : "general";
  const fileName = pathParts[pathParts.length - 1];
  const notesId = fileName
    .replace(/\.pdf$/i, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  // ── 2. Query Azure AI Search for relevant content ────────────────────────
  const searchClient = new SearchClient(
    process.env.AZURE_SEARCH_ENDPOINT,
    process.env.AZURE_SEARCH_INDEX_NAME,
    new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY)
  );

  const searchResults = await searchClient.search("*", {
    filter: `source eq '${blobName}'`,
    top: 50,
    select: ["content", "page_number"],
  });

  let combinedContent = "";
  for await (const result of searchResults.results) {
    combinedContent += result.document.content + "\n\n";
  }

  if (!combinedContent.trim()) {
    context.log.warn(`No search results found for ${blobName}. Skipping.`);
    return;
  }

  // ── 3. Derive human-readable names from IDs ──────────────────────────────
  const className = classId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const notesSetName = notesId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const generatedAt = new Date().toISOString();

  // ── 4. Call GPT to generate BOTH flashcards and quiz in one shot ─────────
  const prompt = buildPrompt(
    combinedContent,
    className,
    classId,
    notesSetName,
    notesId,
    fileName,
    generatedAt
  );

  const gptResponse = await callAzureOpenAI(prompt);

  // ── 5. Parse and validate the two JSON outputs ───────────────────────────
  let flashcardsJson, quizJson;
  try {
    const parsed = JSON.parse(gptResponse);
    flashcardsJson = parsed.flashcards_file;
    quizJson = parsed.quiz_file;

    validateFlashcards(flashcardsJson);
    validateQuiz(quizJson);
  } catch (err) {
    context.log.error(`Failed to parse or validate GPT output: ${err.message}`);
    context.log.error(`Raw GPT response: ${gptResponse}`);
    throw err;
  }

  // ── 6. Write output JSON files to blob storage ───────────────────────────
  const blobServiceClient = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION
  );
  const containerClient = blobServiceClient.getContainerClient(
    process.env.OUTPUT_CONTAINER_NAME
  );

  const flashcardsFileName = `${classId}_${notesId}_flashcards.json`;
  const quizFileName = `${classId}_${notesId}_quiz.json`;

  await uploadJson(containerClient, flashcardsFileName, flashcardsJson, context);
  await uploadJson(containerClient, quizFileName, quizJson, context);

  context.log(`✅ Done. Wrote: ${flashcardsFileName} and ${quizFileName}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// GPT Prompt Builder
// ─────────────────────────────────────────────────────────────────────────────
function buildPrompt(content, className, classId, notesSetName, notesId, sourceFile, generatedAt) {
  return `You are an expert educator. Given the following class notes, generate study materials.

CLASS: ${className} (id: "${classId}")
NOTES SET: ${notesSetName} (id: "${notesId}")
SOURCE FILE: ${sourceFile}

NOTES CONTENT:
---
${content.substring(0, 12000)}
---

Generate BOTH a flashcards file AND a quiz file from these notes.
Return ONLY a single valid JSON object with NO markdown, NO code fences, NO extra text.

The response must follow this EXACT structure:

{
  "flashcards_file": {
    "schema_version": "1.0",
    "type": "flashcards",
    "metadata": {
      "class": "${className}",
      "class_id": "${classId}",
      "notes_set": "${notesSetName}",
      "notes_id": "${notesId}",
      "source_file": "${sourceFile}",
      "generated_at": "${generatedAt}",
      "card_count": <NUMBER>
    },
    "flashcards": [
      {
        "id": <NUMBER starting at 1>,
        "front": "<question or term>",
        "back": "<full explanation or definition>",
        "tags": ["<relevant topic tags>"]
      }
    ]
  },
  "quiz_file": {
    "schema_version": "1.0",
    "type": "quiz",
    "metadata": {
      "class": "${className}",
      "class_id": "${classId}",
      "notes_set": "${notesSetName}",
      "notes_id": "${notesId}",
      "source_file": "${sourceFile}",
      "generated_at": "${generatedAt}",
      "question_count": <NUMBER>
    },
    "quiz": [
      {
        "id": <NUMBER starting at 1>,
        "question": "<question text>",
        "type": "multiple_choice",
        "options": [
          { "letter": "A", "text": "<option text>" },
          { "letter": "B", "text": "<option text>" },
          { "letter": "C", "text": "<option text>" },
          { "letter": "D", "text": "<option text>" }
        ],
        "correct_answer": "<A, B, C, or D>",
        "explanation": "<why this answer is correct>",
        "tags": ["<relevant topic tags>"]
      }
    ]
  }
}

Rules:
- Generate 10-20 flashcards covering all key concepts
- Generate 10-15 quiz questions, each with exactly 4 options (A-D)
- card_count and question_count must match the actual array lengths
- All questions must be answerable from the provided notes
- Distractors (wrong answers) must be plausible but clearly incorrect
- Explanations must be informative and reference the notes content
- Return ONLY the JSON object, nothing else`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Azure OpenAI API Call
// ─────────────────────────────────────────────────────────────────────────────
async function callAzureOpenAI(prompt) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content:
            "You are an expert educator who creates precise, well-structured study materials. You always return valid JSON exactly as instructed.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 4000,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Azure OpenAI error ${response.status}: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────────────────────────────────────
function validateFlashcards(obj) {
  if (obj.type !== "flashcards") throw new Error("flashcards type mismatch");
  if (!obj.metadata?.class_id) throw new Error("flashcards missing metadata.class_id");
  if (!Array.isArray(obj.flashcards)) throw new Error("flashcards array missing");
  if (obj.flashcards.length === 0) throw new Error("flashcards array is empty");
  for (const card of obj.flashcards) {
    if (!card.front || !card.back) throw new Error(`Flashcard ${card.id} missing front or back`);
  }
  // Ensure card_count matches
  obj.metadata.card_count = obj.flashcards.length;
}

function validateQuiz(obj) {
  if (obj.type !== "quiz") throw new Error("quiz type mismatch");
  if (!obj.metadata?.class_id) throw new Error("quiz missing metadata.class_id");
  if (!Array.isArray(obj.quiz)) throw new Error("quiz array missing");
  if (obj.quiz.length === 0) throw new Error("quiz array is empty");
  for (const q of obj.quiz) {
    if (!q.question) throw new Error(`Question ${q.id} missing question text`);
    if (!Array.isArray(q.options) || q.options.length !== 4)
      throw new Error(`Question ${q.id} must have exactly 4 options`);
    if (!["A", "B", "C", "D"].includes(q.correct_answer))
      throw new Error(`Question ${q.id} correct_answer must be A, B, C, or D`);
  }
  // Ensure question_count matches
  obj.metadata.question_count = obj.quiz.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blob Upload Helper
// ─────────────────────────────────────────────────────────────────────────────
async function uploadJson(containerClient, fileName, data, context) {
  const blockBlobClient = containerClient.getBlockBlobClient(fileName);
  const content = JSON.stringify(data, null, 2);
  await blockBlobClient.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: "application/json" },
    overwrite: true,
  });
  context.log(`  → Uploaded: ${fileName}`);
}
