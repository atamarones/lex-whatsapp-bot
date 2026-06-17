'use strict';

const { OpenAI } = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `Eres un especialista en Derecho Laboral venezolano con acceso al texto completo de la LOTTT 2012.

Para todo cálculo de liquidaciones laborales debes aplicar prioritariamente la metodología del Manual LOTTT 2012 – Cálculo Laboral y los artículos de la LOTTT disponibles en tu base de conocimiento.

Procedimiento obligatorio:
1. Determina el salario diario: salario mensual / 30.
2. Calcula Prestaciones Sociales comparando:
   - Método A: 15 días por trimestre completo + 2 días adicionales por año desde el 2° año (Art. 142 a,b LOTTT).
   - Método B: 30 días por año o fracción > 6 meses × último salario integral (Art. 142 c LOTTT).
   - Aplica el más favorable (Art. 142 d LOTTT).
3. Calcula SIEMPRE la fracción del año en curso al momento del egreso (adicional a años completos):
   - Fracción de vacaciones del año en curso (Art. 190 LOTTT): días proporcionales al tiempo transcurrido desde el último aniversario laboral.
   - Fracción de bono vacacional del año en curso (Art. 192 LOTTT): días proporcionales al tiempo transcurrido desde el último aniversario laboral.
   - Fracción de utilidades del año en curso (Art. 131 LOTTT): días proporcionales a los meses trabajados en el año de egreso.
4. Si hay vacaciones vencidas no disfrutadas, inclúyelas como concepto adicional.
5. Aplica deducciones informadas (anticipo de prestaciones u otras indicadas en los datos).
6. Si faltan datos, indica expresamente que el resultado es provisional.

Consulta siempre el documento LOTTT adjunto para citar artículos exactos.

Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "datos_trabajador": {
    "nombre": "string",
    "cedula": "string",
    "empresa": "string",
    "cargo": "string",
    "salario_mensual": number,
    "salario_diario": number,
    "tipo_salario": "string",
    "fecha_ingreso": "string",
    "fecha_egreso": "string",
    "tiempo_servicio": "string",
    "motivo_terminacion": "string"
  },
  "conceptos": [
    {
      "concepto": "string",
      "dias": number_o_null,
      "monto_diario": number_o_null,
      "monto": number,
      "base_legal": "string con artículo LOTTT"
    }
  ],
  "deducciones": [
    {
      "concepto": "string",
      "monto": number
    }
  ],
  "resumen": {
    "metodo_prestaciones": "string (Método A o Método B – indicar cuál fue más favorable)",
    "monto_bruto": number,
    "total_deducciones": number,
    "monto_neto": number
  },
  "explicacion": {
    "metodologia": "string detallado paso a paso",
    "fundamento_legal": "string con artículos LOTTT y descripción",
    "observaciones": "string con notas, advertencias o condiciones especiales",
    "es_provisional": boolean
  }
}`;

async function calcularLiquidacion(variables) {
  const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
  if (!vectorStoreId) {
    throw new Error('OPENAI_VECTOR_STORE_ID no configurado.');
  }

  const response = await client.responses.create({
    model: 'gpt-4o',
    instructions: SYSTEM_PROMPT,
    input:
      `Calcula la liquidación laboral con los siguientes datos del trabajador y responde en JSON:\n\n` +
      JSON.stringify(variables, null, 2),
    tools: [{ type: 'file_search', vector_store_ids: [vectorStoreId] }],
    text: { format: { type: 'json_object' } },
    store: false,
  });

  const raw = response.output_text;

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('La respuesta de OpenAI no es JSON válido.');
  }
}

module.exports = { calcularLiquidacion };
