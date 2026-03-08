import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listModels() {
  try {
    const models = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).listModels();
    console.log("Available Models:");
    console.log(JSON.stringify(models, null, 2));
  } catch (err) {

    console.error("Error listing models:", err.message);
  }
}

listModels();
