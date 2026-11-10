export type OptimizationMode = 'adaptive' | 'off';
export type ReasoningStrategy = 'auto' | 'provider' | 'qwen3-adaptive';
export type ResponsePlan = { profile: 'code' | 'procedure' | 'explanation' | 'artifact' | 'answer'; scope: 'complete' | 'delta'; detailed: boolean; needsReasoning: boolean };

// Deterministic planning adds no inference call and never filters the request or history.
export function planResponse(request: string, hasHistory = false): ResponsePlan {
  const text = request.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const detailed = /\b(complet[oa]s?|integro|integra|exhaustiv[oa]|detallad[oa]|a fondo|profundidad|extens[oa]|sin omitir|full|entire|detailed)\b/.test(text);
  const profile: ResponsePlan['profile'] = /\b(codigo|typescript|javascript|python|html|css|sql|funcion|script|debug|bug|archivo|clase|code|function)\b|```/.test(text) ? 'code'
    : /\b(redacta|escribe un|escribe una|traduce|traduccion|carta|correo|ensayo|poema|translate|write a)\b/.test(text) ? 'artifact'
    : /\b(paso a paso|pasos|instalar|configurar|procedimiento|tutorial|instructions|step by step)\b/.test(text) ? 'procedure'
    : /\b(explica|explicame|por que|como funciona|diferencia|compara|explain|compare)\b/.test(text) ? 'explanation' : 'answer';
  const followup = hasHistory && /\b(ahora|ademas|tambien|agrega|anade|modifica|cambia|corrige|ajusta|eso|anterior|now|also|change|fix)\b/.test(text);
  const needsReasoning = request.length > 1500 || /\b(demuestra|demostracion|razona|razonamiento|piensa|calcula|matematica|ecuacion|depura|debug|concurrencia|vulnerabilidad|analiza|analisis|proof|reason|think|algorithm)\b/.test(text)
    || (detailed && profile === 'explanation');
  return { profile, scope: followup && !detailed ? 'delta' : 'complete', detailed, needsReasoning };
}

export function generationOptions(provider: { model: string; name?: string; baseUrl: string; reasoning?: ReasoningStrategy }, mode: OptimizationMode, plan: ResponsePlan) {
  const strategy = provider.reasoning ?? 'auto';
  const host = new URL(provider.baseUrl).hostname;
  const localQwen = ['localhost', '127.0.0.1', '[::1]'].includes(host) && /qwen3/i.test(`${provider.model} ${provider.name || ''}`);
  const compatible = strategy === 'qwen3-adaptive' || (strategy === 'auto' && localQwen);
  // Keep the provider's reasoning for complex tasks. Never limit generated tokens.
  return mode === 'adaptive' && compatible && !plan.needsReasoning
    ? { chat_template_kwargs: { enable_thinking: false } } : {};
}

export function responsePolicy(mode: OptimizationMode = 'adaptive', plan?: ResponsePlan): string {
  if (mode === 'off') return '';
  const base = '\n\nResponde directamente, sin preámbulos, repeticiones ni cierres de relleno. Conserva todos los requisitos, condiciones y pasos necesarios. No reduzcas el alcance ni la claridad para acortar.';
  if (!plan) return base;
  const strategies: Record<ResponsePlan['profile'], string> = {
    code: 'Código funcional y tipos válidos. Muestra el cambio localizado si basta; entrega el archivo completo cuando se pida, sin omisiones. Evita explicar en prosa lo que el código ya expresa.',
    artifact: 'Texto solicitado: entrega directamente la pieza final y respeta su extensión, formato y tono; evita comentarios sobre cómo la redactaste.',
    procedure: 'Procedimiento: incluye todos los pasos y prerrequisitos imprescindibles, ordenados y accionables. Menciona cada acción una sola vez.',
    explanation: 'Explicación: prioriza concepto, relación causal y conclusión útil; usa un ejemplo solo si aclara algo que el texto no explica por sí solo.',
    answer: 'Respuesta: contesta directamente y añade únicamente los datos o condiciones necesarios para comprenderla o actuar.'
  };
  return base + '\n' + strategies[plan.profile]
    + (plan.scope === 'delta' ? '\nContinuación: usa los hechos ya establecidos. Explica los cambios y las nuevas implicaciones sin volver a desarrollar lo que el usuario ya conoce. Si pide una recapitulación o un entregable completo, inclúyelo.' : '')
    + (plan.detailed ? '\nRespeta el detalle y la integridad pedidos; utiliza toda la extensión que haga falta.' : '');
}
