// modules/ai/voice/useVoiceAssistant.ts

"use client";

import { useState } from "react";
import { recordAndTranscribe } from "./recordAndTranscribe";
import { speak } from "./speak";

export function useVoiceAssistant() {
  const [listening, setListening] = useState(false);

  async function toggle() {
    try {
      setListening(true);

      // 1. Graba la voz y obtiene la transcripción
      const transcript = await recordAndTranscribe();

      // Si no se ha obtenido texto, salimos
      if (!transcript) return;

      // 2. Envía el mensaje al endpoint de IA
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: transcript,
        }),
      });

      if (!response.ok) {
        throw new Error("Error al consultar la IA");
      }

      const data = await response.json();

      // 3. Reproduce la respuesta por voz
      if (data?.answer) {
        await speak(data.answer);
      }
    } catch (error) {
      console.error("Error en el asistente de voz:", error);
    } finally {
      setListening(false);
    }
  }

  return {
    listening,
    toggle,
  };
}