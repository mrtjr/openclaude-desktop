export function trimContextWindow(messages: any[], maxTokens: number = 80000): any[] {
  if (!messages || messages.length <= 6) return messages;

  let totalEstimatedTokens = 0;
  for (const msg of messages) {
    let contentStr = '';
    if (typeof msg.content === 'string') {
      contentStr = msg.content;
    } else if (Array.isArray(msg.content)) {
      contentStr = msg.content.map((c: any) => c.type === 'text' ? c.text : '').join(' ');
    }
    totalEstimatedTokens += Math.ceil(contentStr.length / 4);
    
    // Also add rough estimate for tool calls/results if they exist in the msg object
    if (msg.toolCalls) {
      totalEstimatedTokens += Math.ceil(JSON.stringify(msg.toolCalls).length / 4);
    }
    if (msg.toolResults) {
      totalEstimatedTokens += Math.ceil(JSON.stringify(msg.toolResults).length / 4);
    }
  }

  if (totalEstimatedTokens <= maxTokens) {
    return messages;
  }

  // Preserve the first message (index 0) and the last 5 messages
  const firstMessage = messages[0];
  const lastFiveMessages = messages.slice(-5);
  
  const removedCount = messages.length - 6;

  const compressionMessage = {
    role: 'system',
    content: `<context_compressed> ${removedCount} mensagens anteriores foram removidas desta requisição para economizar tokens e evitar limite de contexto. Use as ferramentas de RAG ou file system memory se precisar relembrar detalhes operacionais antigos. </context_compressed>`
  };

  return [firstMessage, compressionMessage, ...lastFiveMessages];
}
