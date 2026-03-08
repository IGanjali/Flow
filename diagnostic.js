import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

async function testKeys() {
  const geminiKey = process.env.GEMINI_API_KEY.trim();
  const elevenKey = process.env.ELEVENLABS_API_KEY.trim();

  console.log("Testing Gemini Key...");
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] })
    });
    const data = await res.json();
    console.log("Gemini Response:", data.candidates?.[0]?.content?.parts?.[0]?.text ? "SUCCESS" : "FAILED", JSON.stringify(data));
  } catch (e) { console.error("Gemini Error:", e.message); }

  console.log("\nTesting ElevenLabs Key...");
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": elevenKey }
    });
    const data = await res.json();
    console.log("ElevenLabs Response:", data.subscription ? "SUCCESS" : "FAILED", JSON.stringify(data));
  } catch (e) { console.error("ElevenLabs Error:", e.message); }
}

testKeys();
