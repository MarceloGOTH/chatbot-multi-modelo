import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { responsePolicy, planResponse, generationOptions } from '../public/response-policy.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const cases = option('--cases') ? JSON.parse(await readFile(path.resolve(option('--cases')), 'utf8')) : [
  { name: 'Explicación', prompt: 'Explica la diferencia entre autenticación y autorización con un ejemplo.' },
  { name: 'Código completo', prompt: 'Escribe una función TypeScript completa que agrupe objetos por una clave, con tipos genéricos y un ejemplo de uso.' },
  { name: 'Continuación', history: [{ role: 'user', content: 'Tengo un servidor Node.js para uso local.' }, { role: 'assistant', content: 'El servidor escucha en 127.0.0.1:3000. El cliente envía JSON con fetch y el servidor valida los campos.' }], prompt: 'Ahora explica qué cambia para acceder desde mi teléfono por Wi-Fi.' }
];
if (!Array.isArray(cases) || cases.length === 0 || cases.some(c => typeof c.name !== 'string' || typeof c.prompt !== 'string' || !c.prompt.trim() || (c.history !== undefined && (!Array.isArray(c.history) || c.history.some(m => !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string'))))) throw Error('Casos inválidos: usa una lista de { name, prompt, history? }.');

if (args.includes('--dry-run')) {
  console.table(cases.map(c => ({ caso: c.name, ...planResponse(c.prompt, !!c.history?.length) })));
  console.log('Simulación: no se llamó a ningún proveedor.');
  process.exit(0);
}
const dir = process.env.NEXO_DATA_DIR || path.join(root, 'data');
const db = JSON.parse(await readFile(path.join(dir, 'database.json'), 'utf8'));
const provider = db.providers.find(p => p.id === option('--provider'));
if (!provider) {
  console.log('Selecciona el proveedor con --provider ID:');
  console.table(db.providers.map(p => ({ id: p.id, nombre: p.name, modelo: p.model })));
  process.exit(1);
}
const reusePath = option('--baseline-report');
const prior = reusePath ? JSON.parse(await readFile(path.resolve(reusePath), 'utf8')) : undefined;
if (prior && (prior.model !== provider.model || prior.results.length !== cases.length || prior.results.some((r, i) => r.prompt !== cases[i].prompt || JSON.stringify(r.history || []) !== JSON.stringify(cases[i].history || [])))) throw Error('El informe previo no corresponde al mismo modelo y casos.');
console.log(`Comparación A/B: ${provider.name} · ${provider.model}. ${cases.length * (prior ? 1 : 2)} solicitudes, sin límite de salida impuesto por Nexo.${prior ? ' Reutiliza las respuestas originales del informe previo.' : ''}`);
const estimate = text => Math.ceil(Array.from(text).length / 3);
const results = [];
for (const [i, c] of cases.entries()) {
  console.log(`Caso ${i + 1}/${cases.length}: ${c.name}`);
  const plan = planResponse(c.prompt, !!c.history?.length);
  const variants = prior ? { off: prior.results[i].baseline } : {};
  // Alternate request order to reduce systematic warm-up bias. Not a statistical trial.
  for (const mode of prior ? ['adaptive'] : i % 2 ? ['adaptive', 'off'] : ['off', 'adaptive']) {
    const messages = [{ role: 'system', content: 'Responde en español con claridad.' + responsePolicy(mode, plan) }, ...(c.history || []), { role: 'user', content: c.prompt }];
    const started = performance.now();
    const response = await fetch(provider.baseUrl + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
      body: JSON.stringify({ model: provider.model, messages, stream: false, ...generationOptions(provider, mode, plan) }), signal: AbortSignal.timeout(180_000)
    });
    if (!response.ok) throw Error(`El proveedor respondió HTTP ${response.status}.`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw Error('El proveedor no devolvió texto para la comparación.');
    const completion = data.usage?.completion_tokens;
    const prompt = data.usage?.prompt_tokens;
    const estimated = !Number.isFinite(completion) || completion <= 0;
    variants[mode] = {
      text, completionTokens: estimated ? estimate(text) : completion,
      promptTokens: Number.isFinite(prompt) ? prompt : null, estimated,
      reasoningCharacters: (data.choices?.[0]?.message?.reasoning_content || data.choices?.[0]?.message?.reasoning || '').length,
      reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      generationOptions: generationOptions(provider, mode, plan),
      seconds: (performance.now() - started) / 1000, finishReason: data.choices?.[0]?.finish_reason
    };
  }
  const baseline = variants.off, optimized = variants.adaptive;
  const totalKnown = baseline.promptTokens !== null && optimized.promptTokens !== null && !baseline.estimated && !optimized.estimated;
  results.push({ name: c.name, prompt: c.prompt, history: c.history || [], plan, baseline, optimized,
    outputReductionPercent: 100 * (1 - optimized.completionTokens / baseline.completionTokens),
    totalReductionPercent: totalKnown ? 100 * (1 - (optimized.completionTokens + optimized.promptTokens) / (baseline.completionTokens + baseline.promptTokens)) : null,
    qualityReview: 'Pendiente: verificar cobertura, exactitud, código y requisitos en ambas respuestas. Menos tokens no prueba igual calidad.'
  });
  console.log(`  Salida: ${baseline.completionTokens} → ${optimized.completionTokens} tokens${baseline.estimated || optimized.estimated ? ' (estimados)' : ''}.`);
}
const reportDir = path.join(dir, 'evaluations');
await mkdir(reportDir, { recursive: true });
const filename = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(filename, JSON.stringify({ model: provider.model, date: new Date().toISOString(), reusedBaseline: reusePath || null, results }, null, 2), { mode: 0o600 });
console.table(results.map(r => ({ caso: r.name, original: r.baseline.completionTokens, optimizada: r.optimized.completionTokens,
  'reducción salida %': r.outputReductionPercent.toFixed(1), 'reducción total %': r.totalReductionPercent?.toFixed(1) ?? 'sin datos',
  conteo: r.baseline.estimated || r.optimized.estimated ? 'estimado' : 'proveedor', revisión: r.baseline.finishReason === 'length' || r.optimized.finishReason === 'length' ? 'salida truncada' : 'calidad pendiente'
})));
console.log(`Informe con ambas respuestas para revisión: ${filename}`);
console.log('Un porcentaje negativo indica mayor consumo. No se modifica ningún chat.');
