'use strict';

/**
 * Script de configuración único.
 * Uso: node scripts/setup-assistant.js <ruta-al-pdf>
 * Resultado: imprime OPENAI_ASSISTANT_ID para agregar al .env
 */

require('dotenv').config();
const { OpenAI } = require('openai');
const fs   = require('fs');
const path = require('path');

const SYSTEM_PROMPT = `Eres un especialista en Derecho Laboral venezolano con acceso al texto completo de la LOTTT 2012.

Para todo cálculo de liquidaciones laborales debes aplicar prioritariamente la metodología del Manual LOTTT 2012 – Cálculo Laboral y los artículos de la LOTTT disponibles en tu base de conocimiento.

Procedimiento obligatorio:
1. Determina el salario diario: salario mensual / 30.
2. Calcula Prestaciones Sociales comparando:
   - Método A: 15 días por trimestre completo + 2 días adicionales por año desde el 2° año (Art. 142 a,b LOTTT).
   - Método B: 30 días por año o fracción > 6 meses × último salario integral (Art. 142 c LOTTT).
   - Aplica el más favorable (Art. 142 d LOTTT).
3. Calcula vacaciones pendientes (Art. 190 LOTTT), bono vacacional (Art. 192 LOTTT), utilidades (Art. 131 LOTTT).
4. Calcula intereses sobre prestaciones si hay datos (Art. 143 LOTTT).
5. Aplica deducciones: anticipo de prestaciones, FAOV (0.132%/mes), INCE (0.044%/mes).
6. Si faltan datos, indica expresamente que el resultado es provisional.

Consulta siempre el documento LOTTT adjunto para citar artículos exactos.

IMPORTANTE: Responde ÚNICAMENTE con un objeto JSON válido con esta estructura:
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

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Uso: node scripts/setup-assistant.js <ruta-al-pdf>');
    process.exit(1);
  }
  if (!fs.existsSync(pdfPath)) {
    console.error('Archivo no encontrado:', pdfPath);
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 1. Subir PDF
  console.log('📤 Subiendo PDF a OpenAI Files...');
  const file = await client.files.create({
    file: fs.createReadStream(pdfPath),
    purpose: 'assistants',
  });
  console.log(`   ✅ File ID: ${file.id}`);

  // 2. Crear vector store y adjuntar archivo
  console.log('📚 Creando Vector Store...');
  const vs = await client.vectorStores.create({
    name: 'LOTTT 2012 – Ley Orgánica del Trabajo',
    file_ids: [file.id],
  });
  console.log(`   ✅ Vector Store ID: ${vs.id}`);

  // 3. Esperar a que el archivo sea procesado
  console.log('⏳ Procesando documento (puede tardar 1-2 minutos)...');
  let vsState = vs;
  while (vsState.file_counts?.in_progress > 0 || vsState.status === 'in_progress') {
    await new Promise(r => setTimeout(r, 3000));
    vsState = await client.vectorStores.retrieve(vs.id);
    const counts = vsState.file_counts ?? {};
    process.stdout.write(`\r   Procesados: ${counts.completed ?? 0}/${counts.total ?? 1} archivos...`);
  }
  console.log('\n   ✅ Documento listo.');

  // 4. Crear assistant
  console.log('🤖 Creando Assistant...');
  const assistant = await client.beta.assistants.create({
    name: 'LexBot – Especialista LOTTT 2012',
    instructions: SYSTEM_PROMPT,
    model: 'gpt-4o',
    tools: [{ type: 'file_search' }],
    tool_resources: {
      file_search: { vector_store_ids: [vs.id] },
    },
  });
  console.log(`   ✅ Assistant ID: ${assistant.id}`);

  console.log('\n════════════════════════════════════════');
  console.log('✅ Setup completo. Agrega esto a tu .env y a las variables de Coolify:');
  console.log(`\nOPENAI_ASSISTANT_ID=${assistant.id}`);
  console.log('════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
