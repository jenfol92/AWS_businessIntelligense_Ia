// modules/ai/agent/businessAgent.ts

import { getProfitabilityTool } from "../tools/getProfitabilityTool";
import { getStockCoverageTool } from "../tools/getStockCoverageTool";

export async function runBusinessAgent({
  message,
  userId: _userId,
}: {
  message: string;
  userId?: string;
}) {
  if (message.includes("margen") || message.includes("rentabilidad")) {
    const data = await getProfitabilityTool();

    return {
      answer: `Estos son los productos con peor margen:`,
      data,
    };
  }

  if (message.includes("stock") || message.includes("pedir")) {
    const data = await getStockCoverageTool();

    return {
      answer: `Estos productos necesitan revisión de stock:`,
      data,
    };
  }

  return {
    answer: "No he encontrado una herramienta adecuada para esa pregunta.",
  };
}