const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Analyze a meeting transcript using Gemini.
 * Returns structured JSON: { keyPoints, decisions, tasks }
 */
async function analyzeMeeting(transcriptText, subject = "Meeting") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `You are a professional meeting assistant. Analyze this meeting transcript for "${subject}".

Transcript:
${transcriptText.substring(0, 4000)}

Return ONLY valid JSON (no markdown, no code blocks) in this exact format:
{
  "keyPoints": ["point 1", "point 2", "point 3"],
  "decisions": ["decision 1", "decision 2"],
  "tasks": [
    { "person": "Full Name", "task": "Specific task description", "deadline": "by Friday" },
    { "person": "Full Name", "task": "Specific task description", "deadline": "" }
  ]
}

Rules:
- Max 5 key points, max 3 decisions
- Extract ALL action items — each must have a real person's name
- If no deadline mentioned, leave deadline as empty string
- Use actual names from the transcript, not pronouns`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Gemini analyze error:", err.message);
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

module.exports = { analyzeMeeting, generateMeetingSummary };

