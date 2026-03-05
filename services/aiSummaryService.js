const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Generate a structured meeting summary using Gemini AI.
 * Returns formatted text with Key Points and Action Items.
 */
async function generateMeetingSummary(transcriptText, subject = "Meeting") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return null; // Gemini not configured
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
You are a professional meeting assistant. Summarize the following meeting transcript for "${subject}".

Transcript:
${transcriptText.substring(0, 4000)}

Respond in this exact format (use plain text, no markdown symbols like ** or ##):

Key Points:
• [point 1]
• [point 2]
• [point 3]

Action Items:
• [Person] → [Task]
• [Person] → [Task]

Keep it concise — max 5 bullets per section.
`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error("❌ Gemini error:", err.message);
    return null;
  }
}

module.exports = { generateMeetingSummary };
