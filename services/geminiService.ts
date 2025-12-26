
import { GoogleGenAI } from "@google/genai";
import { BacktestResult, Strategy } from "../types";

// Analyze strategy performance using Gemini API
export const analyzeBacktest = async (strategy: Strategy, result: BacktestResult): Promise<string> => {
  // Always initialize right before making an API call per guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    Analyze this Triple Trend strategy performance:
    Strategy: ${strategy.name}
    CAGR: ${result.stats.cagr}%
    Max DD: ${result.stats.maxDrawdown}%
    Total Return: ${result.stats.totalReturn}%

    Provide a concise (under 100 words) summary of the risk/reward profile and a suggestion for improving the trend detection logic.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    // Directly access .text property per guidelines
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Failed to retrieve AI analysis.";
  }
};
