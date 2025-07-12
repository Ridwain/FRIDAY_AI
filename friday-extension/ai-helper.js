export async function getAIResponse(messages) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer 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`
    },
    body: JSON.stringify({
      model: "llama3-8b-8192",
      messages: messages
    })
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "⚠️ No reply from AI.";
}
