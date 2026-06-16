'use strict';

const { OpenAI } = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function calcularLiquidacion(variables) {
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) {
    throw new Error('OPENAI_ASSISTANT_ID no configurado. Ejecuta: node scripts/setup-assistant.js');
  }

  // Crear thread
  const thread = await client.beta.threads.create();

  // Agregar mensaje con las variables
  await client.beta.threads.messages.create(thread.id, {
    role: 'user',
    content:
      `Calcula la liquidación laboral con los siguientes datos y responde ÚNICAMENTE con el JSON especificado:\n\n` +
      JSON.stringify(variables, null, 2),
  });

  // Ejecutar y esperar resultado (polling automático)
  const run = await client.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: assistantId,
    max_completion_tokens: 4096,
  });

  if (run.status !== 'completed') {
    throw new Error(`OpenAI run terminó con estado: ${run.status}`);
  }

  // Obtener respuesta
  const messages = await client.beta.threads.messages.list(thread.id, {
    order: 'desc',
    limit: 1,
  });

  const raw = messages.data[0]?.content[0]?.text?.value ?? '';

  // Extraer JSON (el assistant puede envolver en ```json ... ```)
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/```\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : raw;

  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    // Intento de extracción del primer objeto JSON en el texto
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
    throw new Error('La respuesta de OpenAI no es JSON válido.');
  }
}

module.exports = { calcularLiquidacion };
