const OpenAI = require("openai");
const logger = require("../utils/logger");

/**
 * Build an OpenAI-compatible client.
 * Priority: Kimi K2 (KIMI_API_KEY) → Gemini-compat (GEMINI_API_KEY via OpenAI SDK)
 * Falls back to Gemini's native SDK only if neither key is set.
 */
function getAIClient() {
  if (process.env.KIMI_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.KIMI_API_KEY,
        baseURL: "https://api.moonshot.ai/v1",
      }),
      model: "kimi-k2",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: "gpt-4o-mini",
    };
  }
  return null; // no key configured
}

/**
 * Call the AI with a single user prompt, return the response text.
 * Supports Kimi K2 / OpenAI.  Returns null on error.
 */
async function callAI(systemPrompt, userPrompt) {
  const cfg = getAIClient();
  if (!cfg) {
    // Last-resort: try Gemini native SDK if key present
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here") {
      try {
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const gModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const combined = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
        const result = await gModel.generateContent(combined);
        return result.response.text().trim();
      } catch (e) {
        logger.error("Gemini fallback error:", e);
        return null;
      }
    }
    logger.warn("No AI API key configured (KIMI_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)");
    return null;
  }

  try {
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });
    const completion = await cfg.client.chat.completions.create({
      model: cfg.model,
      messages,
      temperature: 0.3,
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    logger.error("AI call error:", err);
    return null;
  }
}

/**
 * Analyze a meeting transcript using Kimi K2 / OpenAI / Gemini.
 * Returns structured JSON: { keyPoints, decisions, tasks, sentiment, topContributors }
 */
async function analyzeMeeting(transcriptText, subject = "Meeting") {
  if (!process.env.KIMI_API_KEY && !process.env.OPENAI_API_KEY &&
      (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "your_gemini_api_key_here")) {
    return null;
  }

  const systemPrompt = "You are a professional meeting assistant specialising in extracting action items. Return ONLY valid JSON — no markdown, no code blocks.";
  const userPrompt = `Analyze this meeting transcript for "${subject}".

Transcript:
${transcriptText.substring(0, 4000)}

Return this exact JSON shape:
{
  "keyPoints": ["point 1", "point 2", "point 3"],
  "decisions": ["decision 1", "decision 2"],
  "tasks": [
    { "person": "Full Name", "task": "Specific task description", "deadline": "by Friday" },
    { "person": "Full Name", "task": "Specific task description", "deadline": "" }
  ],
  "sentiment": "positive",
  "topContributors": ["Name1", "Name2"]
}

Rules:
- Max 5 key points, max 3 decisions
- Extract ALL action items — phrases like "X will ...", "X should ...", "X needs to ..."
- Each task MUST have a real person's name (no pronouns)
- deadline: exact deadline if stated, empty string if none
- sentiment: positive | neutral | negative
- topContributors: up to 3 names who drove the most decisions`;

  try {
    const raw = (await callAI(systemPrompt, userPrompt) || "")
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(raw);
  } catch (err) {
    logger.error("AI analyze parse error:", err);
    return null;
  }
}

/**
 * Simple text summary for /ai-test endpoint.
 */
async function generateMeetingSummary(transcriptText, subject = "Meeting") {
  const data = await analyzeMeeting(transcriptText, subject);
  if (!data) return null;

  const lines = [];
  if (data.keyPoints?.length) {
    lines.push("Key Points:");
    data.keyPoints.forEach((p) => lines.push(`• ${p}`));
  }
  if (data.decisions?.length) {
    lines.push("");
    lines.push("Decisions Made:");
    data.decisions.forEach((d) => lines.push(`• ${d}`));
  }
  if (data.tasks?.length) {
    lines.push("");
    lines.push("Action Items:");
    data.tasks.forEach((t) => {
      const deadline = t.deadline ? ` (${t.deadline})` : "";
      lines.push(`• ${t.person} → ${t.task}${deadline}`);
    });
  }
  return lines.join("\n");
}

/**
 * Use Gemini to map a natural-language message to a bot command.
 * Returns { command, args, confidence, explanation } or null on failure.
 */
async function parseNaturalLanguageCommand(text) {
  try {
    const systemPrompt = "You are a command parser for a Microsoft Teams meeting bot in Telegram. Return ONLY valid JSON, no markdown.";
    const userPrompt = `Map this user message to ONE bot command.

Available commands:
/meet [Title date time duration] — create a Teams meeting
/next — next upcoming meeting
/today — all meetings today
/week — full week schedule
/upcoming — next 5 meetings
/tasks — view pending action items
/stats — meeting and task statistics
/history [n] — past meetings
/summary [name] — AI summary of a meeting
/ask [question] — AI Q&A over meeting history
/intelligence — advanced analytics
/recordings [name] — find meeting recording
/notes [name] — meeting notes
/remind [name] — tasks for a person
/search [keyword] — search tasks

User message: "${text.substring(0, 300)}"

Respond as JSON: {"command":"/tasks","args":"","confidence":0.9,"explanation":"user wants to see tasks"}
If no mapping: {"command":null,"confidence":0,"explanation":"unclear"}`;
    const rawText = await callAI(systemPrompt, userPrompt);
    if (!rawText) return null;
    const raw = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(raw);
  } catch (err) {
    logger.error("NL parse error:", err);
    return null;
  }
}

module.exports = { analyzeMeeting, generateMeetingSummary, parseNaturalLanguageCommand, callAI };

