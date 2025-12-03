import { GoogleGenAI } from "@google/genai";
import { BacktestResult, Strategy } from "../types";

// Note: In a real deployment, the API key would be fetched safely. 
// For this demo structure, we assume it's available in env.
// If not, the UI will just show a placeholder or handle the error.

const getAIClient = () => {
  const apiKey = process.env.API_KEY || ''; 
  if (!apiKey) {
    console.warn("No API_KEY found in process.env");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeBacktest = async (strategy: Strategy, result: BacktestResult): Promise<string> => {
  const ai = getAIClient();
  if (!ai) return "AI Configuration Missing: Please set process.env.API_KEY to enable AI insights.";

  const prompt = `
    Analyze the following trading strategy backtest results.
    Strategy Name: ${strategy.name}
    Strategy Type: ${strategy.type}
    
    Performance Metrics:
    - CAGR: ${result.stats.cagr}%
    - Max Drawdown: ${result.stats.maxDrawdown}%
    - Sharpe Ratio: ${result.stats.sharpeRatio}
    - Total Return: ${result.stats.totalReturn}%
    - Win Rate: ${result.stats.winRate}%

    Provide a concise executive summary of the strategy's performance, potential risks based on the drawdown, and a suggestion for improvement.
    Keep it under 150 words.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Failed to retrieve AI analysis. Please check your network or API key.";
  }
};
