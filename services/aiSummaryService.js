const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("../utils/logger");

/**
 * Analyze a meeting transcript using Gemini.
 * Returns structured JSON: { keyPoints, decisions, tasks }
 */
async function analyzeMeeting(transcriptText, subject = "Meeting") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are a professional meeting assistant specialising in extracting action items. Analyze this meeting transcript for "${subject}".

Transcript:
${transcriptText.substring(0, 4000)}

Return ONLY valid JSON (no markdown, no code blocks) in this exact format:
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
- Extract ALL action items — phrases like "X will ...", "X should ...", "X needs to ...", "assign X to ..."
- Each task MUST have a real person's name from the transcript (no pronouns like "he/she/they")
- deadline: extract exact deadline if stated (e.g. "by Thursday", "March 15", "end of week"). Empty string if none.
- sentiment: overall meeting tone — one of: positive | neutral | negative
- topContributors: up to 3 names who spoke most or drove the most decisions`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(raw);
  } catch (err) {
    logger.error("Gemini analyze error:", err);
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") return null;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(
      `You are a command parser for a Microsoft Teams meeting bot in Telegram.
Map the user message to ONE bot command. Return ONLY valid JSON, no markdown.

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
If no mapping found: {"command":null,"confidence":0,"explanation":"unclear"}`
    );
    const raw = result.response.text().trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(raw);
  } catch (err) {
    logger.error("NL parse error:", err);
    return null;
  }
}

module.exports = { analyzeMeeting, generateMeetingSummary, parseNaturalLanguageCommand };

