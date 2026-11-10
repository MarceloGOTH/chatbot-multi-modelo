import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planResponse, responsePolicy, generationOptions } from '../public/response-policy.ts';

test('selecciona instrucciones según tarea sin convertir la brevedad en un límite', () => {
  const cases = [
    ['Escribe el archivo TypeScript completo, sin omitir funciones.', true, 'code', 'complete', true],
    ['Ahora corrige la función que acabamos de ver.', true, 'code', 'delta', false],
    ['Explica cómo funciona una cola.', false, 'explanation', 'complete', false],
    ['Configurar el servidor paso a paso.', false, 'procedure', 'complete', false],
    ['Redacta un ensayo detallado de 2000 palabras.', true, 'artifact', 'complete', true]
  ];
  for (const [text, history, profile, scope, detailed] of cases) {
    const plan = planResponse(text, history);
    assert.equal(plan.profile, profile);
    assert.equal(plan.scope, scope);
    assert.equal(plan.detailed, detailed);
    const policy = responsePolicy('adaptive', plan);
    assert.doesNotMatch(policy, /600|máximo de|max_tokens|presupuesto/);
    assert.match(policy, /No reduzcas el alcance/);
    if (detailed) assert.match(policy, /toda la extensión que haga falta/);
  }
  assert.equal(responsePolicy('off', planResponse('hola')), '');
});

test('Qwen local usa modo directo solo en tareas simples y respeta overrides', () => {
  const local = { model: 'qwen3', baseUrl: 'http://127.0.0.1:8000/v1' };
  const simple = planResponse('Explica autenticación con un ejemplo');
  const complex = planResponse('Demuestra este teorema matemático paso a paso');
  assert.deepEqual(generationOptions(local, 'adaptive', simple), { chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(generationOptions(local, 'adaptive', complex), {});
  assert.deepEqual(generationOptions(local, 'off', simple), {});
  assert.deepEqual(generationOptions({ ...local, reasoning: 'provider' }, 'adaptive', simple), {});
  assert.deepEqual(generationOptions({ ...local, baseUrl: 'https://example.com/v1' }, 'adaptive', simple), {});
  assert.deepEqual(generationOptions({ ...local, model: 'otro-modelo' }, 'adaptive', simple), {});
});
