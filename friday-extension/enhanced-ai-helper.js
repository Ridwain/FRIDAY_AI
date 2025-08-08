export async function getAIResponse(messages) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `` // Replace with your actual OpenAI API key
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 1000,
      temperature: 0.7
    })
  });  

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "⚠️ No reply from AI.";
}