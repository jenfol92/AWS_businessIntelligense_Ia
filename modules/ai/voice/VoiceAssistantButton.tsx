// modules/ai/voice/VoiceAssistantButton.tsx

"use client";

import { useVoiceAssistant } from "./useVoiceAssistant";

export function VoiceAssistantButton() {
  const voice = useVoiceAssistant();

  return (
    <button onClick={voice.toggle}>
      {voice.listening ? "Escuchando..." : "Hablar con la IA"}
    </button>
  );
}